import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { Queue } from "bullmq";
import { createDatabase, digest, id, type Actor } from "@album/server-core";
import type { components } from "../../contracts/src/api";
import {
  createJob,
  JobRepository,
  BullMqScheduler,
  OutboxDispatcher,
  type ExecutionPolicy,
  type JobLease,
  type JobRecord,
  type CreateJobInput,
} from "./index";

const enabled =
  !!process.env.C3_TEST_DATABASE_URL && !!process.env.C4_TEST_REDIS_URL;
describe.skipIf(!enabled)(
  "durable jobs with disposable PostgreSQL and Redis",
  () => {
    let db: ReturnType<typeof createDatabase>;
    let admin: Pool;
    let databaseName: string;
    let queue: Queue;
    let repository: JobRepository;
    let dispatcher: OutboxDispatcher;
    let policy: ExecutionPolicy;
    let user: string;
    let wid: string;
    let release: string;
    let actor: Actor;
    const clock = () => new Date().toISOString();
    const tx = <T>(work: (tx: PoolClient) => Promise<T>) =>
      db.database.transaction(work);
    const rows = async (sql: string, args: unknown[] = []) =>
      tx(async (client) => (await client.query(sql, args)).rows);
    async function workspace(kind: "personal" | "platform" = "personal") {
      const workspaceId = id();
      await rows(
        "INSERT INTO workspaces(id,owner_user_id,kind,name) VALUES($1,$2,$3,'Test')",
        [workspaceId, user, kind],
      );
      await rows(
        "INSERT INTO workspace_members(id,workspace_id,user_id,role) VALUES($1,$2,$3,'owner')",
        [id(), workspaceId, user],
      );
      return workspaceId;
    }
    async function input(
      workspaceId = wid,
      kind: components["schemas"]["Job"]["kind"] = "layout",
    ) {
      const snapshotId = id();
      await rows(
        `INSERT INTO job_snapshots(id,workspace_id,kind,config_release_id,schema_version,normalized_spec_hash,manifest_hash,manifest,entitlement_snapshot,warnings_acknowledged) VALUES($1,$2,$5,$3,1,$4,$4,'{}','{}','[]')`,
        [snapshotId, workspaceId, release, digest("input"), kind],
      );
      return {
        workspaceId,
        kind,
        configReleaseId: release,
        inputHash: digest("input"),
        payload: { revision: 1 },
        createdBy: user,
        snapshotId,
      };
    }
    const create = async (workspaceId = wid) => {
      const value = await input(workspaceId);
      return tx((client) => createJob(client, value, id()));
    };
    async function expire(lease: JobLease) {
      await rows(
        "UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
        [lease.job.jobId],
      );
    }
    async function makeDue(jobId: string) {
      await rows(
        "UPDATE jobs SET next_attempt_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
        [jobId],
      );
    }
    beforeAll(async () => {
      const source = new URL(process.env.C3_TEST_DATABASE_URL!);
      const redis = new URL(process.env.C4_TEST_REDIS_URL!);
      if (
        ![source.hostname, redis.hostname].every((host) =>
          ["localhost", "127.0.0.1"].includes(host),
        ) ||
        !source.pathname.includes("test")
      )
        throw Error("DISPOSABLE_LOCAL_SERVICES_REQUIRED");
      admin = new Pool({ connectionString: source.toString() });
      databaseName = "c4_jobs_test_" + id().replaceAll("-", "");
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      source.pathname = "/" + databaseName;
      db = createDatabase({ connectionString: source.toString() });
      await db.pool.query(
        await readFile(
          new URL(
            "../../../docs/release-v1.0/database/001_initial.up.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      queue = new Queue("jobs-test-" + id(), {
        connection: {
          host: redis.hostname,
          port: Number(redis.port),
          ...(redis.password
            ? { password: decodeURIComponent(redis.password) }
            : {}),
        },
      });
      await queue.waitUntilReady();
    }, 30000);
    beforeEach(async () => {
      await queue.obliterate({ force: true });
      await rows("TRUNCATE users CASCADE");
      user = id();
      release = id();
      await rows("INSERT INTO users(id,display_name) VALUES($1,'Test')", [
        user,
      ]);
      wid = await workspace();
      await rows(
        "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',1,1,$2,'{}',$3)",
        [release, digest("config"), user],
      );
      actor = {
        userId: user,
        sessionId: id(),
        client: "web",
        platformPermissions: [],
      };
      await rows(
        "INSERT INTO auth_sessions(id,user_id,client_kind,refresh_hash,csrf_hash,expires_at) VALUES($1,$2,'web',$3,$4,clock_timestamp()+interval '1 hour')",
        [actor.sessionId, user, digest(id()), digest(id())],
      );
      policy = {
        deployment: { global: 10, workspace: 10 },
        release: { global: 10, workspace: 10 },
        entitlement: { global: 10, workspace: 10 },
        leaseSeconds: 30,
        maxAttempts: 4,
        retryBackoffSeconds: [10, 30, 90],
      };
      repository = new JobRepository(db.database, async () => policy);
      dispatcher = new OutboxDispatcher(
        db.database,
        new BullMqScheduler(queue),
        repository,
      );
    });
    afterAll(async () => {
      await queue?.obliterate({ force: true });
      await queue?.close();
      await db?.close();
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
        await admin.end();
      }
    });

    it("commits trusted creator, frozen snapshot, job and outbox in the caller transaction", async () => {
      const value = await input();
      const creator = id();
      await rows("INSERT INTO users(id,display_name) VALUES($1,'Designer')", [
        creator,
      ]);
      value.createdBy = creator;
      await expect(
        tx(async (client) => {
          await createJob(client, value, "rollback");
          throw Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await rows("SELECT id FROM jobs")).toHaveLength(0);
      expect(await rows("SELECT id FROM outbox")).toHaveLength(0);
      const job = await tx((client) => createJob(client, value, "accepted"));
      expect(job).toMatchObject({
        state: "queued",
        fence: 0,
        attempt: 0,
        configReleaseId: release,
      });
      expect(
        (
          await rows("SELECT created_by,snapshot_id FROM jobs WHERE id=$1", [
            job.jobId,
          ])
        )[0],
      ).toEqual({ created_by: creator, snapshot_id: value.snapshotId });
      expect(
        await rows(
          "SELECT id FROM outbox WHERE aggregate_id=$1 AND event_type='job.ready'",
          [job.jobId],
        ),
      ).toHaveLength(1);
    });
    it("serializes concurrent idempotency and rejects changed payload for seven days", async () => {
      const value = await input();
      const jobs = await Promise.all(
        Array.from({ length: 8 }, () =>
          tx((client) => createJob(client, value, "same-key")),
        ),
      );
      expect(new Set(jobs.map((job) => job.jobId)).size).toBe(1);
      expect(await rows("SELECT id FROM jobs")).toHaveLength(1);
      await expect(
        tx((client) =>
          createJob(client, { ...value, payload: { revision: 2 } }, "same-key"),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const record = (await rows("SELECT * FROM idempotency_keys"))[0];
      expect(
        new Date(record.expires_at).getTime() -
          new Date(record.created_at).getTime(),
      ).toBeGreaterThanOrEqual(7 * 86400000);
      expect(record.workspace_id).toBe(wid);
      expect(record.principal_scope).toBe("workspace");
    });
    it("rejects snapshots with mismatched workspace, kind, release or input hash", async () => {
      const value = await input();
      for (const change of [
        { workspaceId: await workspace() },
        { kind: "config_test" as const },
        { configReleaseId: id() },
        { inputHash: digest("other") },
      ])
        await expect(
          tx((client) => createJob(client, { ...value, ...change }, id())),
        ).rejects.toThrow("JOB_SNAPSHOT_MISMATCH");
      expect(await rows("SELECT id FROM jobs")).toHaveLength(0);
    });
    it("rebuilds Redis solely from committed database jobs and deduplicates dispatch", async () => {
      const job = await create();
      expect(await dispatcher.dispatchOutbox(100)).toBeGreaterThanOrEqual(1);
      await dispatcher.dispatchOutbox(100);
      expect(await queue.getWaitingCount()).toBe(1);
      expect((await queue.getWaiting())[0].data).toEqual({
        jobId: job.jobId,
        mode: "execute",
      });
      await queue.obliterate({ force: true });
      expect(await dispatcher.dispatchOutbox(100)).toBe(1);
      expect(await queue.getWaitingCount()).toBe(1);
    });
    it("retains database dispatch intent after a Redis failure", async () => {
      const job = await create();
      const broken = new OutboxDispatcher(
        db.database,
        {
          schedule: async () => {
            throw Error("password=secret URL");
          },
        },
        repository,
      );
      expect(await broken.dispatchOutbox(100)).toBe(0);
      const event = (
        await rows("SELECT * FROM outbox WHERE aggregate_id=$1", [job.jobId])
      )[0];
      expect(event.sent_at).toBeNull();
      expect(event.claimed_by).toBeNull();
      expect(event.last_error_code).toBe("SCHEDULER_UNAVAILABLE");
      expect(JSON.stringify(event)).not.toContain("password");
      expect(await dispatcher.dispatchOutbox(100)).toBe(1);
    });
    it("round-robins workspaces even across repeated single-item dispatch calls", async () => {
      for (let index = 0; index < 6; index++) await create();
      const other = await workspace();
      const otherJob = await create(other);
      const seen: string[] = [];
      const fair = new OutboxDispatcher(
        db.database,
        {
          schedule: async (jobId) => {
            seen.push(jobId);
          },
        },
        repository,
      );
      await fair.dispatchOutbox(1);
      await fair.dispatchOutbox(1);
      expect(seen.indexOf(otherJob.jobId)).toBe(1);
      expect(seen.indexOf(otherJob.jobId)).toBeLessThan(6);
    });
    it("dispatches a second workspace before draining a large workspace in one batch", async () => {
      for (let index = 0; index < 6; index++) await create();
      const otherJob = await create(await workspace());
      const seen: string[] = [];
      await new OutboxDispatcher(
        db.database,
        {
          schedule: async (jobId) => {
            seen.push(jobId);
          },
        },
        repository,
      ).dispatchOutbox(100);
      expect(seen.indexOf(otherJob.jobId)).toBeLessThan(6);
    });
    it("rejects workspace keys already used by another operation", async () => {
      const value = await input();
      await rows(
        "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,expires_at) VALUES($1,$2,'workspace','cross-operation',$3,'order.create','completed',200,'{}',now()+interval '7 days')",
        [id(), wid, digest("order")],
      );
      await expect(
        tx((client) => createJob(client, value, "cross-operation")),
      ).rejects.toMatchObject({ status: 409 });
      expect(await rows("SELECT id FROM jobs")).toHaveLength(0);
    });
    it("atomically limits claims by the strictest deployment/release/entitlement policy", async () => {
      policy.entitlement.workspace = 1;
      policy.release.global = 2;
      const a = await create();
      const b = await create();
      const other = await workspace();
      const c = await create(other);
      const leases = await Promise.all(
        [a, b, c].map((job) => repository.claimJob(job.jobId, id(), clock())),
      );
      expect(leases.filter(Boolean)).toHaveLength(2);
      expect(
        leases.filter((lease) => lease?.job.workspaceId === wid),
      ).toHaveLength(1);
      policy.deployment.global = 1;
      expect(
        await repository.claimJob(
          (await create(await workspace())).jobId,
          id(),
          clock(),
        ),
      ).toBeNull();
    });
    it("allows one concurrent claim and records queue delay, heartbeat and sanitized attempts", async () => {
      const job = await create();
      const leases = await Promise.all(
        Array.from({ length: 5 }, () =>
          repository.claimJob(job.jobId, id(), clock()),
        ),
      );
      expect(leases.filter(Boolean)).toHaveLength(1);
      const lease = leases.find(Boolean)!;
      expect(lease.job).toMatchObject({
        state: "running",
        fence: 1,
        attempt: 1,
      });
      await repository.renewLease(lease, "2099-01-01T00:00:00Z");
      const events = await rows(
        "SELECT event_type,payload FROM outbox WHERE aggregate_id=$1",
        [job.jobId],
      );
      expect(
        events.find((row) => row.event_type === "job.claimed")?.payload
          .queueDelayMs,
      ).toBeGreaterThanOrEqual(0);
      expect(
        events.find((row) => row.event_type === "job.heartbeat")?.payload
          .heartbeatAt,
      ).toBeTruthy();
      expect(
        new Date(
          (
            await rows("SELECT lease_expires_at FROM jobs WHERE id=$1", [
              job.jobId,
            ])
          )[0].lease_expires_at,
        ).getTime() - Date.now(),
      ).toBeLessThanOrEqual(31000);
    });
    it("rejects expired owners and fences before running a terminal transaction callback", async () => {
      const job = await create();
      const old = (await repository.claimJob(job.jobId, "old", clock()))!;
      await expire(old);
      let writes = 0;
      expect(
        await repository.finishJob(
          old,
          { state: "succeeded", result: { artifact: "late" } },
          async () => {
            writes++;
          },
        ),
      ).toBe(false);
      await expect(repository.renewLease(old, clock())).rejects.toThrow(
        "JOB_LEASE_LOST",
      );
      await repository.recoverExpiredJobs(100);
      await makeDue(job.jobId);
      const current = (await repository.claimJob(job.jobId, "new", clock()))!;
      expect(current.fence).toBe(2);
      expect(
        await repository.finishJob(
          old,
          { state: "succeeded", result: {} },
          async () => {
            writes++;
          },
        ),
      ).toBe(false);
      expect(writes).toBe(0);
      expect(
        await repository.finishJob(
          current,
          { state: "succeeded", result: { artifact: "complete" } },
          async (client) => {
            writes++;
            await client.query(
              "INSERT INTO outbox(id,event_key,aggregate_kind,aggregate_id,event_type,payload) VALUES($1,$1,'test',$2,'test.commit','{}')",
              [id(), job.jobId],
            );
          },
        ),
      ).toBe(true);
      expect(writes).toBe(1);
      expect(
        await rows(
          "SELECT id FROM outbox WHERE event_type='job.terminal' AND aggregate_id=$1",
          [job.jobId],
        ),
      ).toHaveLength(1);
    });
    it("rolls back output/ledger hook and terminal state together on callback failure", async () => {
      const job = await create();
      const lease = (await repository.claimJob(job.jobId, id(), clock()))!;
      await expect(
        repository.finishJob(
          lease,
          { state: "succeeded", result: {} },
          async (client) => {
            await client.query(
              "INSERT INTO outbox(id,event_key,aggregate_kind,aggregate_id,event_type,payload) VALUES($1,$1,'test',$2,'must.rollback','{}')",
              [id(), job.jobId],
            );
            throw Error("ledger failed");
          },
        ),
      ).rejects.toThrow("ledger failed");
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
          .state,
      ).toBe("running");
      expect(
        await rows("SELECT id FROM outbox WHERE event_type='must.rollback'"),
      ).toHaveLength(0);
    });
    it("rolls back a terminal callback if its lease expires during that transaction", async () => {
      const job = await create();
      const lease = (await repository.claimJob(job.jobId, id(), clock()))!;
      await expect(
        repository.finishJob(
          lease,
          { state: "succeeded", result: {} },
          async (client) => {
            await client.query(
              "UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
              [job.jobId],
            );
          },
        ),
      ).rejects.toThrow("JOB_LEASE_LOST");
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
          .state,
      ).toBe("running");
    });
    it("uses an acquisition token so the same worker identity cannot revive its lost confirmation lease", async () => {
      const job = await create();
      const old = (await repository.claimJob(
        job.jobId,
        "same-worker",
        clock(),
      ))!;
      await repository.markSubmission(old, "submitting", "stable-request");
      await repository.failAttempt(old, {
        code: "NETWORK_TIMEOUT",
        retryable: true,
        definite: false,
      });
      await expire(old);
      await repository.recoverExpiredJobs(100);
      const next = (await repository.claimJob(
        job.jobId,
        "same-worker",
        clock(),
      ))!;
      expect(next.leaseOwner).not.toBe(old.leaseOwner);
      expect(
        await repository.finishJob(old, { state: "succeeded", result: {} }),
      ).toBe(false);
      expect(
        await repository.markSubmission(old, "accepted", "stable-request"),
      ).toBe(false);
      expect(
        await repository.failAttempt(old, {
          code: "UPSTREAM_TEMPORARY",
          retryable: true,
          definite: true,
        }),
      ).toBe(false);
      await expect(repository.renewLease(old, clock())).rejects.toThrow(
        "JOB_LEASE_LOST",
      );
    });
    it("does not retry an unclassified error even when a caller marks it retryable", async () => {
      const job = await create();
      const lease = (await repository.claimJob(job.jobId, id(), clock()))!;
      await repository.failAttempt(lease, {
        code: "password=private exception",
        retryable: true,
        definite: true,
      });
      expect(
        (
          await rows("SELECT state,error_code FROM jobs WHERE id=$1", [
            job.jobId,
          ])
        )[0],
      ).toEqual({ state: "failed", error_code: "JOB_FAILED" });
      expect(
        JSON.stringify(
          await rows("SELECT error_code FROM job_attempts WHERE job_id=$1", [
            job.jobId,
          ]),
        ),
      ).not.toContain("private");
    });
    it("cancels queued jobs atomically and rechecks live workspace permission", async () => {
      const job = await create();
      await expect(
        repository.requestCancel({ ...actor, userId: id() }, wid, job.jobId),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        repository.requestCancel(actor, await workspace(), job.jobId),
      ).rejects.toMatchObject({ status: 404 });
      await rows(
        "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",
        [wid],
      );
      await expect(
        repository.requestCancel(actor, wid, job.jobId),
      ).rejects.toMatchObject({ status: 403 });
      await rows(
        "UPDATE workspace_members SET role='designer' WHERE workspace_id=$1",
        [wid],
      );
      expect(
        (await repository.requestCancel(actor, wid, job.jobId)).state,
      ).toBe("cancelled");
      expect(await repository.claimJob(job.jobId, id(), clock())).toBeNull();
      expect(await dispatcher.dispatchOutbox(100)).toBe(0);
    });
    it.each([
      ["config_test", "platform.config.test"],
      ["reconciliation", "platform.ops.reconcile"],
      ["backup_restore_drill", "platform.ops.backup.verify"],
      ["storage_migration", "platform.storage.migrate"],
      ["privacy_export", "platform.ops.jobs.manage"],
    ] as const)(
      "requires the corresponding platform permission for %s independently of ordinary membership",
      async (kind, permission) => {
        const platform = await workspace("platform");
        const value = await input(platform, kind);
        const job = await tx((client) => createJob(client, value, id()));
        await expect(
          repository.requestCancel(actor, platform, job.jobId),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          repository.requestCancel(
            { ...actor, platformPermissions: ["platform.ops.jobs.read"] },
            platform,
            job.jobId,
          ),
        ).rejects.toMatchObject({ status: 403 });
        expect(
          (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
            .state,
        ).toBe("queued");
        expect(
          await rows(
            "SELECT id FROM outbox WHERE aggregate_id=$1 AND event_type='job.terminal'",
            [job.jobId],
          ),
        ).toHaveLength(0);
        await rows("DELETE FROM workspace_members WHERE workspace_id=$1", [
          platform,
        ]);
        const operator = { ...actor, platformPermissions: [permission] };
        expect(
          (await repository.requestCancel(operator, platform, job.jobId)).state,
        ).toBe("cancelled");
        await expect(
          repository.requestCancel(actor, platform, job.jobId),
        ).rejects.toMatchObject({ status: 403 });
      },
    );
    it.each(["revoked-session", "suspended-user"])(
      "rejects platform cancellation with a %s despite matching platform permission",
      async (mode) => {
        const platform = await workspace("platform");
        const job = await tx(async (client) =>
          createJob(client, await input(platform, "config_test"), id()),
        );
        if (mode === "revoked-session")
          await rows(
            "UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
            [actor.sessionId],
          );
        else
          await rows("UPDATE users SET status='suspended' WHERE id=$1", [user]);
        await expect(
          repository.requestCancel(
            { ...actor, platformPermissions: ["platform.config.test"] },
            platform,
            job.jobId,
          ),
        ).rejects.toMatchObject({ status: 404 });
        expect(
          (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
            .state,
        ).toBe("queued");
      },
    );
    it.each(["asset_analysis", "deletion"] as const)(
      "accepts authoritative %s jobs through the shared typed creation API",
      async (kind) => {
        expectTypeOf<JobRecord["kind"]>().toEqualTypeOf<
          components["schemas"]["Job"]["kind"]
        >();
        const value: CreateJobInput = await input(wid, kind);
        const job = await tx((client) => createJob(client, value, id()));
        expect(job.kind).toBe(kind);
        expect(
          (await repository.claimJob(job.jobId, id(), clock()))?.job.kind,
        ).toBe(kind);
      },
    );
    it("permits exactly one terminal event under concurrent cancellation and success", async () => {
      const job = await create();
      const lease = (await repository.claimJob(job.jobId, id(), clock()))!;
      const [, success] = await Promise.all([
        repository.requestCancel(actor, wid, job.jobId),
        repository.finishJob(lease, { state: "succeeded", result: {} }),
      ]);
      if (!success)
        expect(
          await repository.finishJob(lease, { state: "cancelled", result: {} }),
        ).toBe(true);
      expect(
        await rows(
          "SELECT id FROM outbox WHERE event_type='job.terminal' AND aggregate_id=$1",
          [job.jobId],
        ),
      ).toHaveLength(1);
      expect(
        await repository.finishJob(lease, { state: "failed", result: {} }),
      ).toBe(false);
    });
    it("retries only definite retryable failures at 10/30/90 seconds and then stops", async () => {
      const job = await create();
      for (const [index, delay] of [10, 30, 90].entries()) {
        const lease = (await repository.claimJob(job.jobId, id(), clock()))!;
        expect(lease.job.attempt).toBe(index + 1);
        expect(
          await repository.failAttempt(lease, {
            code: "UPSTREAM_TEMPORARY",
            retryable: true,
            definite: true,
          }),
        ).toBe(true);
        const record = (
          await rows("SELECT state,next_attempt_at FROM jobs WHERE id=$1", [
            job.jobId,
          ])
        )[0];
        expect(record.state).toBe("retry_wait");
        expect(
          new Date(record.next_attempt_at).getTime() - Date.now(),
        ).toBeGreaterThan((delay - 1) * 1000);
        expect(
          await repository.claimJob(job.jobId, id(), "2099-01-01T00:00:00Z"),
        ).toBeNull();
        await makeDue(job.jobId);
      }
      const final = (await repository.claimJob(job.jobId, id(), clock()))!;
      await repository.failAttempt(final, {
        code: "UPSTREAM_TEMPORARY",
        retryable: true,
        definite: true,
      });
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
          .state,
      ).toBe("failed");
      expect(
        await rows("SELECT id FROM job_attempts WHERE job_id=$1", [job.jobId]),
      ).toHaveLength(4);
    });
    it("does not blindly retry OOM and persists only resource guidance", async () => {
      const job = await create();
      const lease = (await repository.claimJob(job.jobId, id(), clock()))!;
      await repository.failAttempt(lease, {
        code: "OOM",
        retryable: true,
        definite: true,
      });
      expect(
        (
          await rows("SELECT state,error_code FROM jobs WHERE id=$1", [
            job.jobId,
          ])
        )[0],
      ).toEqual({ state: "failed", error_code: "RESOURCE_EXHAUSTED" });
      expect(
        JSON.stringify(
          await rows(
            "SELECT payload FROM outbox WHERE aggregate_id=$1 AND event_type='job.terminal'",
            [job.jobId],
          ),
        ),
      ).toContain("reduce_resolution_or_split");
    });
    it("persists submission intent before calling upstream and preserves unknown payments for confirmation", async () => {
      const job = await create();
      const old = (await repository.claimJob(job.jobId, "old", clock()))!;
      expect(
        await repository.markSubmission(old, "submitting", "stable-request"),
      ).toBe(true);
      expect(
        await repository.failAttempt(old, {
          code: "NETWORK_TIMEOUT",
          retryable: true,
          definite: false,
        }),
      ).toBe(true);
      expect(
        (
          await rows(
            "SELECT state,stage,provider_submission_state FROM jobs WHERE id=$1",
            [job.jobId],
          )
        )[0],
      ).toEqual({
        state: "running",
        stage: "confirming_upstream",
        provider_submission_state: "unknown",
      });
      await expire(old);
      await repository.recoverExpiredJobs(100);
      expect(await dispatcher.dispatchOutbox(100)).toBe(1);
      expect((await queue.getWaiting())[0].data.mode).toBe("confirm");
      const next = (await repository.claimJob(
        job.jobId,
        "confirmer",
        clock(),
      ))!;
      expect(next.fence).toBe(old.fence);
      expect(next.job.attempt).toBe(1);
      expect(
        await repository.markSubmission(next, "submitting", "other-request"),
      ).toBe(false);
      expect(
        await repository.finishJob(old, { state: "succeeded", result: {} }),
      ).toBe(false);
      expect(
        await repository.finishJob(next, { state: "succeeded", result: {} }),
      ).toBe(true);
    });
    it.each(["submitting", "accepted", "unknown"] as const)(
      "keeps %s original requests in confirmation after a definite confirmation transport error",
      async (submission) => {
        const job = await create();
        let lease = (await repository.claimJob(
          job.jobId,
          "submitter",
          clock(),
        ))!;
        await repository.markSubmission(
          lease,
          "submitting",
          "original-request",
        );
        if (submission === "accepted")
          await repository.markSubmission(
            lease,
            "accepted",
            "original-request",
          );
        if (submission === "unknown") {
          await repository.failAttempt(lease, {
            code: "NETWORK_TIMEOUT",
            retryable: true,
            definite: false,
          });
          await expire(lease);
          await repository.recoverExpiredJobs(100);
          lease = (await repository.claimJob(job.jobId, "confirmer", clock()))!;
        }
        await repository.failAttempt(lease, {
          code: "UPSTREAM_TEMPORARY",
          retryable: true,
          definite: true,
        });
        expect(
          (
            await rows(
              "SELECT state,stage,provider_submission_state,provider_request_id,next_attempt_at FROM jobs WHERE id=$1",
              [job.jobId],
            )
          )[0],
        ).toEqual({
          state: "running",
          stage: "confirming_upstream",
          provider_submission_state: "unknown",
          provider_request_id: "original-request",
          next_attempt_at: null,
        });
        expect(
          (
            await rows(
              "SELECT provider_request_id,submission_state FROM job_attempts WHERE job_id=$1",
              [job.jobId],
            )
          )[0],
        ).toEqual({
          provider_request_id: "original-request",
          submission_state: "unknown",
        });
        await expire(lease);
        await dispatcher.dispatchOutbox(100);
        expect((await queue.getWaiting())[0].data.mode).toBe("confirm");
        const confirmation = (await repository.claimJob(
          job.jobId,
          "next-confirmer",
          clock(),
        ))!;
        expect(confirmation.job.attempt).toBe(1);
        expect(confirmation.fence).toBe(1);
        expect(
          await repository.markSubmission(
            confirmation,
            "submitting",
            "new-request",
          ),
        ).toBe(false);
        expect(
          await rows("SELECT id FROM job_attempts WHERE job_id=$1", [
            job.jobId,
          ]),
        ).toHaveLength(1);
      },
    );
    it("does not terminalize a cancelled paid request because its confirmation query failed", async () => {
      const job = await create();
      const lease = (await repository.claimJob(job.jobId, id(), clock()))!;
      let terminalHooks = 0;
      repository = new JobRepository(
        db.database,
        async () => policy,
        async () => {
          terminalHooks++;
        },
      );
      await repository.markSubmission(lease, "submitting", "original-request");
      await repository.requestCancel(actor, wid, job.jobId);
      await repository.failAttempt(lease, {
        code: "UPSTREAM_TEMPORARY",
        retryable: true,
        definite: true,
      });
      expect(
        (
          await rows(
            "SELECT state,provider_submission_state,provider_request_id FROM jobs WHERE id=$1",
            [job.jobId],
          )
        )[0],
      ).toEqual({
        state: "cancel_requested",
        provider_submission_state: "unknown",
        provider_request_id: "original-request",
      });
      expect(terminalHooks).toBe(0);
    });
  },
);
