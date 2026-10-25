import { it, expect } from "vitest";
import { computeLayouts } from "./layout-controller";
it("aborted requests stop before allocating a worker", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    computeLayouts({} as never, {} as never, {} as never, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
