export * from "../../src/tasks";
import { MiniTasks } from "../../src/tasks";
import { getMiniRuntime } from "../../src/runtime";
import { createNativePage } from "../../src/native-page";
function createTasksPage() {
  let tasks: MiniTasks | null = null;
  let active = true;
  const page = {
    data: { items: [], message: "", hasMore: false, loading: false },
    async onLoad() {
      active = true;
      try {
        const runtime = await getMiniRuntime();
        tasks = new MiniTasks(runtime.api, runtime.capabilities.tasks);
        await this.loadPage();
      } catch (error) {
        this.setData({
          message: error instanceof Error ? error.message : "任务中心未配置",
        });
      }
    },
    async refresh() {
      await this.loadPage();
    },
    async loadPage(more = false) {
      if (!tasks) return;
      this.setData({ loading: true });
      await tasks.load(more);
      if (active)
        this.setData({
          items: tasks.items,
          message: tasks.message,
          hasMore: tasks.hasMore && tasks.status === "ready",
          loading: false,
        });
    },
    async more() {
      await this.loadPage(true);
    },
    onUnload() {
      active = false;
    },
  } satisfies ThisType<{
    setData(value: object): void;
    loadPage(more?: boolean): Promise<void>;
  }>;
  return page;
}
if (typeof Page === "function") Page(createNativePage(createTasksPage));
