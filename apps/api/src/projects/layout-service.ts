import { fail, type Actor } from "@album/server-core";
import type { components } from "@album/contracts";
/** C4 owns durable leases and candidate publication. No fake job is emitted before that port is configured. */
export class CloudLayoutService {
  async createCloudLayoutJob(
    _actor: Actor,
    _wid: string,
    projectId: string,
    input: components["schemas"]["LayoutJobCreate"],
    _key: string,
  ): Promise<never> {
    if (
      !input ||
      !input.layoutSpec ||
      Object.keys(input).some((k) => k !== "layoutSpec") ||
      input.layoutSpec.projectId !== projectId
    )
      fail("INVALID_LAYOUT_SPEC", 422);
    return fail("CLOUD_LAYOUT_UNCONFIGURED", 503);
  }
  async runCloudLayoutJob(_lease: unknown): Promise<never> {
    return fail("CLOUD_LAYOUT_UNCONFIGURED", 503);
  }
  async applyCloudLayout(
    _actor: Actor,
    _wid: string,
    _projectId: string,
    _candidateId: string,
    _expectedRevision: number,
    _key: string,
  ): Promise<never> {
    return fail("CLOUD_LAYOUT_UNCONFIGURED", 503);
  }
  async listCandidates(
    _actor: Actor,
    _wid: string,
    _jobId: string,
  ): Promise<never> {
    return fail("CLOUD_LAYOUT_UNCONFIGURED", 503);
  }
}
