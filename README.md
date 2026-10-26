> C2 整本排版开发：实现说明与测试边界见 [C2 研发记录](docs/implementation/c2/README.md)。

# ai-album-layout-designer
面向摄影师／影楼与个人的 AI 相册排版设计工具。首期网页完整编辑，微信小程序快速成册，为 App 预留接口。

支持方向：多页相册、33 种滤镜、文字／形状／模板、AI 智能排版、水墨彩绘、账号会员与 AI 点数、在线权益、导出队列。

当前已实现 C1–C4 的网页编辑、模板、整册规则排版、本地与云端基础、持久任务、会员点数/订单/退款财务内核及运营后台。真实身份、支付、存储和 AI 供应商仍需部署适配器；AI 模型生成属于后续 C5。

## 运行、完整源码与服务器测试

- [在线编辑器](https://2041996029.github.io/ai-album-layout-designer/) / [运营后台界面](https://2041996029.github.io/ai-album-layout-designer/admin/)：Pages 只有静态页面，不能代替 API。
- 本地前端：Node24，`npm ci` → `npm run dev`；后台：`npm run admin:dev`。
- [完整项目服务器搭建与本地 Codex 交接](deploy/server-test/README.md)：目标 `/www/wwwroot/HuaNian_SheJi`，含实际 Dockerfile、Compose、Nginx、首次空库初始化与密钥生成。
- 打包完整已跟踪源码：`node scripts/package-server-test.mjs`，生成 `artifacts/HuaNian_SheJi-source.zip` 与 SHA256。先提交/暂存新源码；未跟踪文件不会进入包。
- [C4 交付范围和实现取舍](docs/c4-delivery-notes.md)。
- [C1 实现](docs/implementation/c1/README.md) / [C2 规则排版](docs/implementation/c2/README.md) / [C3 云端基础](docs/implementation/c3/README.md)。

原有历史“研发交付包”是设计文档，不是本次可执行项目。实际源码与测试部署入口以上面链接为准。浏览器草稿请定期备份项目包；服务器秘密不要提交到仓库。

## 全部模块研发交付包 v1.0

- [统一交付入口](docs/release-v1.0/README.md)：49项需求、155个API操作、65页状态规范、92表数据库、C1–C6共44项实施任务、测试与部署运维合同。
- [完整ZIP](docs/AI相册-全模块研发交付包-v1.0.zip)／[研发手册PDF](docs/release-v1.0/AI相册-全模块研发手册-v1.0.pdf)／[Word](docs/release-v1.0/AI相册-全模块研发手册-v1.0.docx)／[19张原型册](docs/release-v1.0/全部页面原型册-v1.0.pdf)。
- [正式OpenAPI](docs/release-v1.0/contracts/openapi.yaml)、[JSON Schema](docs/release-v1.0/contracts/schemas)、[数据库与SQL迁移设计](docs/release-v1.0/database)、[验收追踪](docs/release-v1.0/requirements.csv)。

v1.0统一本次交接，以下v0.1–v0.4保留调研与评审历史。文档及隔离SQL验证已交付，C1产品代码正在交付，供应商联调和上线验证尚未执行；相关外部输入在决策表登记。

## 历史评审入口

- [v0.4 配置中心与素材目录规格](docs/configuration-v0.4/README.md)：补充云存储、自定义根前缀／用户文件夹、AI连接／模型／费用及20类配置覆盖；含3张静态原型、PDF／Word。新增方案待评审，尚无后台实现。
- [全程 AI 开发：实施与验收入口](docs/superpowers/plans/README.md)：C1–C6 的 44 项执行任务、验证命令、接口与交付路线。
- [C1 实施计划 PDF](docs/superpowers/plans/C1-网页编辑与确定性导出-实施计划.pdf)／[Word](docs/superpowers/plans/C1-网页编辑与确定性导出-实施计划.docx)：网页编辑、保存恢复与真实图片／PDF 导出的逐项计划。
- [v0.3 产品与研发评审基线](docs/design-v0.3/README.md)：整合已确认范围与调研发现，明确创作分流、照片完整性、导出阻断和跨端规则。
- [v0.3 新版原型目录](docs/design-v0.3/prototypes)：创作选择、排版核对、艺术素材入册、导出预检，共 4 张 SVG／PNG。
- [v0.3 规格 PDF](docs/design-v0.3/产品与研发评审基线-v0.3.pdf)／[Word](docs/design-v0.3/产品与研发评审基线-v0.3.docx)／[4 页原型 PDF](docs/design-v0.3/新版原型-v0.3.pdf)
- [完整评审资料包 v0.3](docs/AI相册-完整评审资料-v0.3.zip)：含本轮基线、原型及前两轮资料，保留离线引用关系。

v0.3记录前期设计依据，当前冲突以v1.0统一合同为准；不把界面草案或计划测试写成已经实现的功能。

## 历史资料与样片

- [离线阅读入口](docs/ai-album-v0.1/review.html)
- [阅读指南与已确认决策](docs/ai-album-v0.1/00-阅读指南与决策记录.md)
- [产品需求文档](docs/ai-album-v0.1/02-产品需求文档.md)
- [原型与交互说明](docs/ai-album-v0.1/06-原型与交互说明.md)
- [相册成品设计样片：婚礼双页](docs/export-samples/README.md)（AI 设计示意，非程序实际导出）
- [v0.2 增补：魔镜／Zine 定向调研与真实算法调用验证](docs/research-2026-10-21/README.md)（含 PDF、Word、几何与装订页序示意、复现脚本）

目录包含 8 份 Markdown、可编辑 Word、产品技术 PDF、8 页原型 PDF、8 张原创 SVG 和 33 项滤镜配方 CSV。PDF 与原型为评审稿，数值预算不代表实测成绩。

历史文档ZIP的校验清单固定于文档交付版本；它校验ZIP内文件或原文档分支，不用于比较当前已加入产品代码的工作树。当前程序样片使用独立 manifest 和验收记录。
