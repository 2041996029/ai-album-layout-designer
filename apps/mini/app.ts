import { miniConfig } from "./src/config";
import { createWxApi, wxRecoveryStore } from "./src/wx";
import { configureMiniAlbum } from "./src/album";
import { configureMiniRuntime } from "./src/runtime";
import { configureMiniTasks } from "./src/tasks";
App({
  onLaunch() {
    const ready = (async () => {
      if (!miniConfig.apiBaseUrl || !miniConfig.workspaceId)
        throw new Error("微信登录与云服务未配置，请联系管理员完成接入");
      const api = await createWxApi(
        wx,
        miniConfig.apiBaseUrl,
        miniConfig.workspaceId,
      );
      configureMiniAlbum(api, wxRecoveryStore(wx));
      configureMiniTasks(api, miniConfig.capabilities.tasks);
      return {
        api,
        wx,
        capabilities: miniConfig.capabilities,
        algorithmVersion: miniConfig.algorithmVersion,
      };
    })();
    // Keep rejection observable to pages without an unhandled-rejection message.
    void ready.catch(() => undefined);
    configureMiniRuntime(ready);
  },
});
