import { ApiError, MiniApi, type Schema } from "./api";
export class MiniTasks {
  items: Array<{ jobId: string; state: string }> = [];
  nextCursor: string | null = null;
  hasMore = true;
  status: "idle" | "loading" | "ready" | "error" | "unconfigured" = "idle";
  message = "";
  private loading = false;
  constructor(
    private api: MiniApi,
    private configured = true,
  ) {}
  async load(more = false) {
    if (!this.configured) {
      this.status = "unconfigured";
      this.message = "任务中心未配置";
      return;
    }
    if (this.loading || (more && !this.hasMore)) return;
    this.loading = true;
    this.status = "loading";
    try {
      const cursor = more ? this.nextCursor : null;
      const page = await this.api.get<
        Schema<"ListWorkspaceJobsResponse">["data"]
      >(
        `/workspaces/${encodeURIComponent(this.api.workspaceId)}/jobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      const items = page.items.map((j) => ({ jobId: j.id, state: j.state }));
      this.items = more
        ? [
            ...this.items,
            ...items.filter(
              (j) => !this.items.some((i) => i.jobId === j.jobId),
            ),
          ]
        : items;
      this.nextCursor = page.nextCursor;
      this.hasMore = page.hasMore;
      this.status = "ready";
      this.message = "";
    } catch (error) {
      this.status =
        error instanceof ApiError && error.status === 503
          ? "unconfigured"
          : "error";
      this.message =
        this.status === "unconfigured"
          ? "任务中心未配置"
          : "任务加载失败，请重试";
    } finally {
      this.loading = false;
    }
  }
}
let client: MiniApi | null = null;
let configured = false;
export function configureMiniTasks(api: MiniApi, available: boolean) {
  client = api;
  configured = available;
}
export async function listMiniTasks(cursor: string | null) {
  if (!client || !configured)
    throw new ApiError(503, "UNCONFIGURED", "任务中心未配置");
  const result = await client.get<Schema<"ListWorkspaceJobsResponse">["data"]>(
    `/workspaces/${encodeURIComponent(client.workspaceId)}/jobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  return {
    items: result.items.map((job) => ({ jobId: job.id, state: job.state })),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  };
}
