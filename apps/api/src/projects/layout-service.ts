import {
  fail,
  id,
  digest,
  type Actor,
  type Database,
} from "@album/server-core";
import type { components } from "@album/contracts";
import {
  canonicalJson,
  templateVersions,
  applyCommand,
  type DocumentModel,
} from "@album/document";
import {
  prepareLayout,
  generateCandidates,
  createLayoutCommand,
  type LayoutInput,
  type LayoutPolicy,
} from "@album/layout";
import { createJob, type JobRepository, type JobLease } from "@album/jobs";
import type { RevisionService, RevisionAuthorization } from "./revisions";
type Dependencies = {
  db: Database;
  workspaces: RevisionAuthorization;
  revisions: RevisionService;
  jobs: JobRepository;
  release: () => Promise<{ releaseId: string; policy: LayoutPolicy }>;
};
type Frozen = {
  input: LayoutInput;
  policy: LayoutPolicy;
  saved: { doc: DocumentModel; resources: any };
  revisionId: string;
};
/** Rules-only C2 layout. All computation uses the accepted revision and published policy. */
export class CloudLayoutService {
  constructor(private deps?: Dependencies) {}
  private configured() {
    if (!this.deps) fail("CLOUD_LAYOUT_UNCONFIGURED", 503);
    return this.deps;
  }
  private async candidates(f: Frozen) {
    const prepared = await prepareLayout(f.input, f.policy);
    const template = templateVersions.find(
      (t) =>
        t.id === f.input.templateRef.id &&
        t.version === f.input.templateRef.version &&
        t.sha256 === f.input.templateRef.sha256,
    );
    if (!template) fail("TEMPLATE_UNAVAILABLE", 422);
    return generateCandidates(prepared, f.saved.doc, template, []);
  }
  async createCloudLayoutJob(
    actor: Actor,
    wid: string,
    projectId: string,
    input: components["schemas"]["LayoutJobCreate"],
    key: string,
  ) {
    if (
      !input ||
      !input.layoutSpec ||
      Object.keys(input).some((k) => k !== "layoutSpec") ||
      input.layoutSpec.projectId !== projectId
    )
      fail("INVALID_LAYOUT_SPEC", 422);
    const d = this.configured(),
      release = await d.release(),
      spec = input.layoutSpec as LayoutInput;
    let prepared;
    try {
      prepared = await prepareLayout(spec, release.policy);
    } catch {
      fail("INVALID_LAYOUT_SPEC", 422);
    }
    const saved = await d.revisions.load(
      actor,
      wid,
      projectId,
      spec.baseRevision,
    );
    for (const photo of spec.photos) {
      const asset = saved.resources.assets.find((a) => a.id === photo.assetId);
      if (
        !asset ||
        asset.width !== photo.width ||
        asset.height !== photo.height ||
        asset.status !== "ready"
      )
        fail("RESOURCE_VERSION_MISMATCH", 409);
    }
    return d.db.transaction(async (tx) => {
      await d.workspaces.authorize(actor, wid, "edit", tx);
      const revision = (
        await tx.query(
          "SELECT r.id,p.current_revision FROM project_revisions r JOIN projects p ON p.id=r.project_id AND p.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.project_id=$2 AND r.number=$3 FOR SHARE OF p",
          [wid, projectId, spec.baseRevision],
        )
      ).rows[0];
      if (!revision || Number(revision.current_revision) !== spec.baseRevision)
        fail("REVISION_CONFLICT", 409);
      const frozen: Frozen = {
          input: prepared.input,
          policy: prepared.policy,
          saved,
          revisionId: revision.id,
        },
        snapshotId = id();
      await tx.query(
        "INSERT INTO job_snapshots(id,workspace_id,kind,project_id,revision_id,config_release_id,schema_version,normalized_spec_hash,manifest_hash,manifest,entitlement_snapshot,warnings_acknowledged) VALUES($1,$2,'layout',$3,$4,$5,1,$6,$7,$8,'{}','[]')",
        [
          snapshotId,
          wid,
          projectId,
          revision.id,
          release.releaseId,
          prepared.inputHash,
          digest(canonicalJson(frozen)),
          JSON.stringify(frozen),
        ],
      );
      const job = await createJob(
        tx,
        {
          workspaceId: wid,
          kind: "layout",
          snapshotId,
          configReleaseId: release.releaseId,
          inputHash: prepared.inputHash,
          payload: prepared.input,
          createdBy: actor.userId,
        },
        key,
      );
      const refs = (
        await tx.query(
          "SELECT * FROM project_revision_resources WHERE revision_id=$1",
          [revision.id],
        )
      ).rows;
      for (const ref of refs)
        await tx.query(
          "INSERT INTO resource_pins(id,workspace_id,job_id,storage_workspace_id,storage_object_id,font_version_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
          [
            id(),
            wid,
            job.jobId,
            ref.storage_workspace_id,
            ref.storage_object_id,
            ref.font_version_id,
          ],
        );
      return job;
    });
  }
  async runCloudLayoutJob(lease: JobLease) {
    const d = this.configured();
    if (lease.job.kind !== "layout") fail("JOB_KIND_MISMATCH", 409);
    const frozen = await d.db.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT s.manifest FROM job_snapshots s JOIN jobs j ON j.snapshot_id=s.id AND j.workspace_id=s.workspace_id WHERE j.workspace_id=$1 AND j.id=$2",
            [lease.job.workspaceId, lease.job.jobId],
          )
        ).rows[0]?.manifest as Frozen,
    );
    if (!frozen) fail("NOT_FOUND", 404);
    const candidates = await this.candidates(frozen);
    return d.jobs.finishJob(
      lease,
      {
        state: candidates.length ? "succeeded" : "failed",
        result: {
          candidateCount: candidates.length,
          ...(!candidates.length
            ? { code: "LAYOUT_CONSTRAINTS_UNSATISFIED" }
            : {}),
        },
      },
      async (tx) => {
        for (const [index, candidate] of candidates.entries())
          await tx.query(
            "INSERT INTO layout_candidates(id,workspace_id,job_id,project_id,base_revision_id,candidate_index,seed,score,layout_hash,layout_json,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '7 days')",
            [
              id(),
              lease.job.workspaceId,
              lease.job.jobId,
              frozen.input.projectId,
              frozen.revisionId,
              index,
              candidate.seed,
              1,
              digest(canonicalJson(candidate)),
              JSON.stringify(candidate),
            ],
          );
        await tx.query(
          "UPDATE resource_pins SET released_at=clock_timestamp() WHERE workspace_id=$1 AND job_id=$2 AND released_at IS NULL",
          [lease.job.workspaceId, lease.job.jobId],
        );
      },
    );
  }
  async listCandidates(actor: Actor, wid: string, jobId: string) {
    const d = this.configured();
    return d.db.transaction(async (tx) => {
      await d.workspaces.authorize(actor, wid, "read", tx);
      const job = (
        await tx.query(
          "SELECT state FROM jobs WHERE workspace_id=$1 AND id=$2",
          [wid, jobId],
        )
      ).rows[0];
      if (!job) fail("NOT_FOUND", 404);
      if (job.state !== "succeeded") return [];
      const rows = (
        await tx.query(
          "SELECT c.*,s.manifest FROM layout_candidates c JOIN jobs j ON j.id=c.job_id AND j.workspace_id=c.workspace_id JOIN job_snapshots s ON s.id=j.snapshot_id WHERE c.workspace_id=$1 AND c.job_id=$2 AND c.expires_at>now() ORDER BY candidate_index",
          [wid, jobId],
        )
      ).rows;
      return rows.map((row) => {
        const c = row.layout_json;
        return {
          id: row.id,
          jobId,
          baseRevision: c.baseRevision,
          seed: c.seed,
          document: { ...row.manifest.saved.doc, spreads: c.spreads },
          score: Number(row.score),
          constraintChecks: [],
          expiresAt: new Date(row.expires_at).toISOString(),
        };
      });
    });
  }
  async applyCloudLayout(
    actor: Actor,
    wid: string,
    projectId: string,
    candidateId: string,
    expectedRevision: number,
    key: string,
  ) {
    const d = this.configured();
    const row = await d.db.transaction(async (tx) => {
      await d.workspaces.authorize(actor, wid, "edit", tx);
      return (
        await tx.query(
          "SELECT c.*,s.manifest FROM layout_candidates c JOIN jobs j ON j.id=c.job_id AND j.workspace_id=c.workspace_id JOIN job_snapshots s ON s.id=j.snapshot_id WHERE c.workspace_id=$1 AND c.project_id=$2 AND c.id=$3 AND c.expires_at>now() AND j.state='succeeded'",
          [wid, projectId, candidateId],
        )
      ).rows[0];
    });
    if (!row) fail("NOT_FOUND", 404);
    if (expectedRevision !== row.layout_json.baseRevision)
      fail("REVISION_CONFLICT", 409);
    const frozen = row.manifest as Frozen,
      candidates = await this.candidates(frozen),
      candidate = candidates[row.candidate_index];
    if (!candidate || digest(canonicalJson(candidate)) !== row.layout_hash)
      fail("LAYOUT_INTEGRITY_FAILED", 409);
    const next = applyCommand(
      frozen.saved.doc,
      createLayoutCommand(frozen.input, candidate, frozen.saved.doc),
    );
    return d.revisions.saveLayoutRevision(
      actor,
      wid,
      next,
      expectedRevision,
      frozen.saved.resources,
      key,
    );
  }
}
