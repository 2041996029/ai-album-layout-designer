# GitHub Pages 测试部署

2026-10-22 实际状态：GitHub Pages 部署成功，安装、类型检查、99项单测、构建、Pages配置、制品上传和发布全部通过。[在线测试](https://2041996029.github.io/ai-album-layout-designer/)；[部署任务](https://github.com/2041996029/ai-album-layout-designer/actions/runs/39739824473)。

用户已授权并手动将仓库公开；主分支未修改。`.github/workflows/pages.yml` 在 `feat/album-development` 更新后构建并部署网页，使用仓库的 `github-pages` 环境；只申请 contents:read、pages:write、id-token:write，无须提供微信、AI或支付密钥。

成功部署步骤输出的 page_url 为 `https://2041996029.github.io/ai-album-layout-designer/`。托管执行环境的网络代理拒绝直接访问 github.io，网页工具也未能读取此站；当前发布确认依据 GitHub 成功部署记录与输出地址，未声称在公网地址完成交互测试。生产构建的子路径交互测试已在本地通过。

如果 Configure GitHub Pages 提示权限或套餐问题，请在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，然后重跑失败任务。私有仓库的 Pages 是否可用由 GitHub 账号套餐决定；本流程不会自动公开源码。若 github-pages 环境限制分支，请允许 `feat/album-development` 部署。

字体随静态站分发并遵循项目子目录路径；网页启动、中文编辑及真实导出已在本地生产构建的子路径下验证。页面采用浏览器 IndexedDB，作品不会上传到 GitHub；换浏览器不共享项目，请使用备份/恢复项目包。

Pages 只承载当前 C1 前端，不承载未来登录、支付、AI密钥或持久导出队列。普通 Pages 网站的访问控制取决于 GitHub 的 Pages/Enterprise 设置，不能把“源码私有”当作“测试网站只有自己可访问”。
