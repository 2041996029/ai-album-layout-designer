import {
  digest,
  fail,
  id,
  runIdempotent,
  type Actor,
  type Database,
} from "@album/server-core";
import type { components } from "@album/contracts";
import type { AuthService } from "../auth/identity";
import type { ReauthService } from "../auth/reauthentication";
import type { Environment, RequestContext } from "../config/types";
import { audit, requireReason, requireRoles } from "../config/secrets";
import { sqlPage } from "../commerce/pagination";
import { shanghaiBudgetDate } from "./budget";
import type { PoolClient } from "pg";
type S = components["schemas"];
type Query = { limit?: number; cursor?: string };
const budgetDto = (r: any, day: string): S["AiBudget"] => ({
  id: r.id,
  accountBillingId: r.account_billing_id,
  providerName: r.provider_name,
  environment: r.environment,
  dailyBudgetFen: Number(r.daily_budget_fen),
  reservedFen: Number(r.reserved_fen ?? 0),
  spentFen: Number(r.spent_fen ?? 0),
  state: r.state,
  revision: Number(r.revision),
  budgetDate: day,
});
const priceDto = (r: any): S["AiCostRule"] => ({
  id: r.id,
  name: r.parameters.name ?? r.rule_key,
  version: Number(r.version),
  creditsPerImage: Number(r.credit_cost),
  estimatedProviderCostFen: Number(r.estimated_cost_fen),
  maxCostFen: Number(r.max_cost_fen),
  createdAt: new Date(r.created_at).toISOString(),
});
const money = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) fail("AI_COST_INVALID", 422);
};
export class AiFinanceService {
  constructor(
    private db: Database,
    private auth: AuthService,
    private reauth: Pick<ReauthService, "verifyFresh">,
    private environment: Environment,
    private now: () => Date = () => new Date(),
  ) {}
  private day() {
    return shanghaiBudgetDate(this.now().toISOString());
  }
  private async account(tx: PoolClient, accountId: string, day: string) {
    return (
      await tx.query(
        "SELECT a.*,b.reserved_fen,b.spent_fen FROM ai_billing_accounts a LEFT JOIN budget_days b ON b.billing_account_id=a.id AND b.budget_date=$3 WHERE a.id=$1 AND a.environment=$2",
        [accountId, this.environment, day],
      )
    ).rows[0];
  }
  async listBudgets(actor: Actor, query: Query) {
    const day = this.day();
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["finance"]);
      const page = await sqlPage(
        tx,
        { actor, query },
        "ai-budgets",
        "SELECT a.*,b.reserved_fen,b.spent_fen FROM ai_billing_accounts a LEFT JOIN budget_days b ON b.billing_account_id=a.id AND b.budget_date=$2 WHERE a.environment=$1",
        [this.environment, day],
      );
      return { ...page, items: page.items.map((r) => budgetDto(r, day)) };
    });
  }
  async updateBudget(
    actor: Actor,
    accountId: string,
    input: S["AiBudgetUpdate"],
    revision: number,
    context: RequestContext,
  ): Promise<S["AiBudget"]> {
    requireReason(input.reason);
    money(input.dailyBudgetFen);
    if (!Number.isSafeInteger(revision) || revision < 1)
      fail("REVISION_REQUIRED", 428);
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["finance"]);
      return runIdempotent(
        tx,
        "ai-budget:" + this.environment + ":" + actor.userId,
        context.idempotencyKey ?? "",
        digest(JSON.stringify({ accountId, input, revision })),
        async () => {
          const row = (
            await tx.query(
              "SELECT * FROM ai_billing_accounts WHERE id=$1 AND environment=$2 FOR UPDATE",
              [accountId, this.environment],
            )
          ).rows[0];
          if (!row) fail("NOT_FOUND", 404);
          if (row.state === "retired") fail("ACCOUNT_RETIRED", 409);
          if (Number(row.revision) !== revision) fail("REVISION_CONFLICT", 409);
          await this.reauth.verifyFresh(
            actor,
            context.reauthProof ?? "",
            "admin_operations",
            tx,
          );
          await tx.query(
            "UPDATE ai_billing_accounts SET daily_budget_fen=$2,state=$3,revision=revision+1 WHERE id=$1",
            [accountId, input.dailyBudgetFen, input.state],
          );
          await audit(
            tx,
            actor,
            context,
            "ai.budget.updated",
            "ai_billing_account",
            accountId,
            input.reason,
            {
              previousBudgetFen: Number(row.daily_budget_fen),
              dailyBudgetFen: input.dailyBudgetFen,
              state: input.state,
            },
          );
          const day = this.day();
          return budgetDto(await this.account(tx, accountId, day), day);
        },
      );
    });
  }
  async createCostRule(
    actor: Actor,
    input: S["AiCostRuleCreate"],
    context: RequestContext,
  ): Promise<S["AiCostRule"]> {
    requireReason(input.reason);
    for (const value of [
      input.creditsPerImage,
      input.estimatedProviderCostFen,
      input.maxCostFen,
    ])
      money(value);
    if (input.estimatedProviderCostFen > input.maxCostFen || !input.name.trim())
      fail("AI_COST_INVALID", 422);
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["finance"]);
      return runIdempotent(
        tx,
        "ai-pricing:" + this.environment + ":" + actor.userId,
        context.idempotencyKey ?? "",
        digest(JSON.stringify(input)),
        async () => {
          await this.reauth.verifyFresh(
            actor,
            context.reauthProof ?? "",
            "admin_operations",
            tx,
          );
          const ruleKey = this.environment + ":" + input.name.trim();
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["ai-cost:" + ruleKey],
          );
          const version = Number(
            (
              await tx.query(
                "SELECT COALESCE(max(version),0)+1 AS n FROM cost_rule_versions WHERE rule_key=$1",
                [ruleKey],
              )
            ).rows[0].n,
          );
          const row = (
            await tx.query(
              "INSERT INTO cost_rule_versions(id,rule_key,version,credit_cost,estimated_cost_fen,max_cost_fen,parameters) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
              [
                id(),
                ruleKey,
                version,
                input.creditsPerImage,
                input.estimatedProviderCostFen,
                input.maxCostFen,
                { name: input.name.trim(), environment: this.environment },
              ],
            )
          ).rows[0];
          await audit(
            tx,
            actor,
            context,
            "ai.pricing.created",
            "cost_rule_version",
            row.id,
            input.reason,
            {
              version,
              creditsPerImage: input.creditsPerImage,
              estimatedProviderCostFen: input.estimatedProviderCostFen,
              maxCostFen: input.maxCostFen,
            },
          );
          return priceDto(row);
        },
      );
    });
  }
  async listCostRules(actor: Actor, query: Query) {
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["finance"]);
      const page = await sqlPage(
        tx,
        { actor, query },
        "ai-cost-rules",
        "SELECT * FROM cost_rule_versions WHERE parameters->>'environment'=$1 OR NOT parameters ? 'environment'",
        [this.environment],
      );
      return { ...page, items: page.items.map(priceDto) };
    });
  }
}
