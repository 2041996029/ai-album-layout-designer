# 全模块页面与交互交付索引

状态：静态研发设计合同，2026-10-21。页面、支付、上传、AI、队列和后台均未因本包而实现；不得以线框作为真实联调通过证据。所有新增图形为原创矢量，几何占位替代照片，无外部图片、客户数据、真实账单或虚构生产报价。

- [页面登记 pages.csv](pages.csv)：65页，网页22、小程序9、后台28、共同6；每页6类必备状态、路径、模块、角色、动作、需求和原型来源。
- [完整交互合同](interaction-spec.md)：保存与冲突、身份、素材、完整编辑、33滤镜、模板、排版、AI、导出、商业、跨端、隐私、后台20配置域、运维及无障碍。
- [动作权限 permissions.csv](permissions.csv)：54个动作×10角色。页面角色与动作授权取交集；工作区角色与平台角色不互相授予客户照片权限。
- [页面流程 screen-flows.mmd](screen-flows.mmd)：全部65个页面ID和关键合法／异常转移；Mermaid源文件，可在支持Mermaid的工具渲染。
- [离线原型预览](preview.html)：4幅新静态SVG及PNG，含历史P01—P15跳转；没有可触发支付或删除的真实控件。
- [文档自检结果](validation.json)：本次离线一致性检查范围、统计与限制，区别于尚未执行的产品验收。

## 新增原型

这些补齐身份、商业售后、小程序全流程和后台对账的关键缺口；历史原型未被改写。

| 编号 | 范围 | 可编辑SVG | PNG预览 |
|---|---|---|---|
| P16 | 登录、账号绑定与注销 | [SVG](prototypes/P16-login-binding.svg) | [PNG](prototypes/P16-login-binding.png) |
| P17 | 会员购买、支付确认与退款 | [SVG](prototypes/P17-membership-refund.svg) | [PNG](prototypes/P17-membership-refund.png) |
| P18 | 小程序快速成册与任务接续 | [SVG](prototypes/P18-mini-quickflow.svg) | [PNG](prototypes/P18-mini-quickflow.png) |
| P19 | 后台任务、对账与受控处理 | [SVG](prototypes/P19-admin-reconciliation.svg) | [PNG](prototypes/P19-admin-reconciliation.png) |

## 历史原型证据 P01—P15

它们是设计参考，不是已实现页面；新登记的页面ID不与历史P编号一一对应。pages.csv的prototype_paths按本文件夹解析，可多对一。v0.3关于完整性、文字超框阻断与快照的修订覆盖早期原型中的简化状态。

| 编号 | 原型主题 | SVG | PNG |
|---|---|---|---|
| P01 | 网页工作台 | [SVG](../../ai-album-v0.1/prototypes/P01-workspace.svg) | [PNG](../../ai-album-v0.1/prototypes/P01-workspace.png) |
| P02 | 完整编辑器 | [SVG](../../ai-album-v0.1/prototypes/P02-editor.svg) | [PNG](../../ai-album-v0.1/prototypes/P02-editor.png) |
| P03 | 排版候选 | [SVG](../../ai-album-v0.1/prototypes/P03-layout.svg) | [PNG](../../ai-album-v0.1/prototypes/P03-layout.png) |
| P04 | 水墨彩绘 | [SVG](../../ai-album-v0.1/prototypes/P04-ai-art.svg) | [PNG](../../ai-album-v0.1/prototypes/P04-ai-art.png) |
| P05 | 导出队列 | [SVG](../../ai-album-v0.1/prototypes/P05-export.svg) | [PNG](../../ai-album-v0.1/prototypes/P05-export.png) |
| P06 | 账号与会员 | [SVG](../../ai-album-v0.1/prototypes/P06-membership.svg) | [PNG](../../ai-album-v0.1/prototypes/P06-membership.png) |
| P07 | 小程序三屏 | [SVG](../../ai-album-v0.1/prototypes/P07-mini-program.svg) | [PNG](../../ai-album-v0.1/prototypes/P07-mini-program.png) |
| P08 | 运营后台 | [SVG](../../ai-album-v0.1/prototypes/P08-admin.svg) | [PNG](../../ai-album-v0.1/prototypes/P08-admin.png) |
| P09 | 双创作入口 | [SVG](../../design-v0.3/prototypes/P09-create-mode.svg) | [PNG](../../design-v0.3/prototypes/P09-create-mode.png) |
| P10 | 排版完整性 | [SVG](../../design-v0.3/prototypes/P10-layout-integrity.svg) | [PNG](../../design-v0.3/prototypes/P10-layout-integrity.png) |
| P11 | 艺术素材与文字分层 | [SVG](../../design-v0.3/prototypes/P11-art-to-album.svg) | [PNG](../../design-v0.3/prototypes/P11-art-to-album.png) |
| P12 | 高清预检 | [SVG](../../design-v0.3/prototypes/P12-export-preflight.svg) | [PNG](../../design-v0.3/prototypes/P12-export-preflight.png) |
| P13 | 配置与存储 | [SVG](../../configuration-v0.4/prototypes/P13-configuration-storage.svg) | [PNG](../../configuration-v0.4/prototypes/P13-configuration-storage.png) |
| P14 | 素材文件夹 | [SVG](../../configuration-v0.4/prototypes/P14-asset-folders.svg) | [PNG](../../configuration-v0.4/prototypes/P14-asset-folders.png) |
| P15 | AI连接模型报价 | [SVG](../../configuration-v0.4/prototypes/P15-ai-configuration.svg) | [PNG](../../configuration-v0.4/prototypes/P15-ai-configuration.png) |

## 评审边界与默认权限

统一范围见[共同规则](../CONTRACT-RULES.md)。原始需求未明确的首期权限采用本合同工程默认：owner采购、兑换与退款；workspace_admin/designer编辑作品素材；viewer只读；designer可回收无引用素材，任何相册或活动任务引用都阻断整批回收。正常平台退款可由单个授权finance处理，异常人工调整的双人复核是可选更严策略，不能把未配置的第二位人员作为正常流程默认阻断。配置发布由具备所有相关命名空间权限的操作者完成，不默认要求多人。

未开通的真实渠道／模型／存储／许可保持unconfigured或disabled；生产资质、供应商、价格和正式保留期限接入时确认。首期App、多席位邀请、BYOK/BYOS、CMYK/PDF-X、小程序任意移动图层编辑均无已可用页面。后台20域均具备页面登记与状态要求，部署根连接仍由受控运维管理。
