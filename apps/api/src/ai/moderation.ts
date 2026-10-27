import { fetchApprovedHttps } from "../config/network-policy";
export type ModerationDecision = {
  state: "approved" | "rejected" | "review";
  reasonCode: string;
  policyVersion: string;
  reviewId: string | null;
};
export interface ModerationAdapter {
  review(bytes: Uint8Array, policyVersion: string): Promise<ModerationDecision>;
}
export class OpenAIModerationAdapter implements ModerationAdapter {
  constructor(
    private options: {
      policies: Record<
        string,
        { endpoint: string; model: string; readSecret: () => Promise<string> }
      >;
      allowedHosts: string[];
      request?: typeof fetchApprovedHttps;
    },
  ) {}
  async review(
    bytes: Uint8Array,
    policyVersion: string,
  ): Promise<ModerationDecision> {
    const p = this.options.policies[policyVersion];
    if (!p) throw Error("MODERATION_UNCONFIGURED");
    try {
      const raw = await (this.options.request ?? fetchApprovedHttps)(
        p.endpoint.replace(/\/$/, "") + "/moderations",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + (await p.readSecret()),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: p.model,
            input: [
              {
                type: "image_url",
                image_url: {
                  url:
                    "data:image/png;base64," +
                    Buffer.from(bytes).toString("base64"),
                },
              },
            ],
          }),
        },
        this.options.allowedHosts,
        { maxBytes: 1000000, timeoutMs: 60000 },
      );
      const value = JSON.parse(Buffer.from(raw).toString()),
        flag = value.results?.[0]?.flagged;
      if (typeof flag !== "boolean") throw Error();
      return {
        state: flag ? "rejected" : "approved",
        reasonCode: flag ? "MODERATION_REJECTED" : "APPROVED",
        policyVersion,
        reviewId: null,
      };
    } catch {
      return {
        state: "review",
        reasonCode: "MODERATION_UNAVAILABLE",
        policyVersion,
        reviewId: null,
      };
    }
  }
}
