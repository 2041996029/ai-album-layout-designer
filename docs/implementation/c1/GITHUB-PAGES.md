# GitHub Pages 测试部署

2026-10-22 实际状态：远端安装、类型检查、99项单测、构建已通过；首次创建 Pages 站点返回 `Resource not accessible by integration`。当前未生成可访问测试网址。[部署任务](https://github.com/2041996029/ai-album-layout-designer/actions/runs/39739824473)；请管理员先在 [Pages 设置](https://github.com/2041996029/ai-album-layout-designer/settings/pages) 选择 GitHub Actions，再重跑失败任务。

仓库保留私有，不修改主分支。`.github/workflows/pages.yml` 在 `feat/album-development` 更新后构建并部署网页，使用仓库的 `github-pages` 环境；只申请 contents:read、pages:write、id-token:write，无须提供微信、AI或支付密钥。

预期标准地址为 `https://2041996029.github.io/ai-album-layout-designer/`，但必须以成功部署步骤输出的 page_url 为准。未看到部署成功前，这不是已开通网址。

如果 Configure GitHub Pages 提示权限或套餐问题，请在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，然后重跑失败任务。私有仓库的 Pages 是否可用由 GitHub 账号套餐决定；本流程不会自动公开源码。若 github-pages 环境限制分支，请允许 `feat/album-development` 部署。

字体随静态站分发并遵循项目子目录路径；网页启动、中文编辑及真实导出已在本地生产构建的子路径下验证。页面采用浏览器 IndexedDB，作品不会上传到 GitHub；换浏览器不共享项目，请使用备份/恢复项目包。

Pages 只承载当前 C1 前端，不承载未来登录、支付、AI密钥或持久导出队列。普通 Pages 网站的访问控制取决于 GitHub 的 Pages/Enterprise 设置，不能把“源码私有”当作“测试网站只有自己可访问”。
