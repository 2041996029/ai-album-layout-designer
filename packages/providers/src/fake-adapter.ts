import {
  checkProviderInput,
  type ProviderAdapter,
  type ProviderInput,
  type ProviderContext,
  type QueryResult,
  type ProviderCapability,
  type SubmitResult,
} from "./types";
/** Contract replay only; never registered as a live generation capability. */
export class ReplayProvider implements ProviderAdapter {
  readonly id = "replay";
  readonly version = "v1";
  readonly mode = "replay" as const;
  readonly capabilities: ReadonlySet<ProviderCapability> = new Set([
    "textToImage",
    "asyncQuery",
    "cancel",
    "idempotentSubmit",
  ]);
  submissions = 0;
  private results = new Map<string, QueryResult>();
  constructor(
    private options: {
      scenario:
        "success" | "accepted_timeout" | "rejected" | "running" | "cancelled";
      outputUrl?: string;
      costFen?: number;
    },
  ) {}
  async submit(
    input: ProviderInput,
    _context: ProviderContext,
  ): Promise<SubmitResult> {
    checkProviderInput(input, this.capabilities);
    if (this.options.scenario === "rejected")
      return {
        state: "rejected",
        code: "PROVIDER_REJECTED",
        message: "Provider rejected request",
      };
    if (!this.results.has(input.operationId)) {
      this.submissions++;
      this.results.set(
        input.operationId,
        this.options.scenario === "running"
          ? {
              state: "running",
              providerRequestId: input.operationId,
              retryAfterSeconds: 1,
            }
          : {
              state: "succeeded",
              providerRequestId: input.operationId,
              outputs: [
                {
                  url:
                    this.options.outputUrl ??
                    "https://outputs.example.com/image.png",
                  mime: "image/png",
                },
              ],
              costFen: this.options.costFen ?? 1,
            },
      );
    }
    return this.options.scenario === "accepted_timeout"
      ? {
          state: "unknown",
          operationId: input.operationId,
          retryAfterSeconds: 1,
        }
      : {
          state: "accepted",
          providerRequestId: input.operationId,
          acceptedAt: new Date().toISOString(),
        };
  }
  async query(
    identity: { operationId: string; providerRequestId: string | null },
    _context: ProviderContext,
  ): Promise<QueryResult> {
    return (
      this.results.get(identity.operationId) ?? {
        state: "unknown",
        providerRequestId: identity.providerRequestId ?? identity.operationId,
        retryAfterSeconds: 1,
      }
    );
  }
  async cancel(
    identity: { operationId: string; providerRequestId: string | null },
    _context: ProviderContext,
  ): Promise<QueryResult> {
    const existing = this.results.get(identity.operationId);
    if (existing?.state === "succeeded") return existing;
    const value: QueryResult = {
      state: "cancelled",
      providerRequestId: identity.providerRequestId ?? identity.operationId,
      code: "CANCELLED",
      message: "Cancelled",
    };
    this.results.set(identity.operationId, value);
    return value;
  }
}
