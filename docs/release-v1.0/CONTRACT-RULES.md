# 全模块交付合同：共同规则

本目录是用户明确要求的“全部模块完整研发交付包”，为文档、设计合同和计划交付，不包含产品服务实现。日期2026-10-21，北京时间。继承v0.3产品基线、v0.4配置增补；本目录提供统一入口，历史版本保留证据。

## 已确认及默认假设

已确认：影楼／摄影师与个人；网页完整编辑＋微信小程序快速成册，App预留；中国大陆／微信／人民币；会员＋AI点数；JPG／PNG／普通PDF；全程AI开发。

本轮为消除技术空白采用可修改的工程默认：平台统一存储与AI连接；后台根前缀与用户逻辑素材目录都纳入；首期不开放BYOS／BYOK；参考图生成和规则排版分离。目录范围与供应商／价格尚待业务确认，记录在决策表，功能和接口先按此默认写全；不调用真实付费服务、不替用户选择已采购供应商。

## 跨文件约定

- 文档根 `docs/release-v1.0/`；API为 `contracts/openapi.yaml`（OpenAPI3.1）；schema位于 `contracts/schemas/`（draft2020-12）；数据库设计位于 `database/`；新增实施计划位于 `../superpowers/plans/2026-10-21-c2-layout.md`、`...-c3-cloud-identity-mini.md`、`...-c4-jobs-commerce.md`、`...-c5-ai-admin.md`。
- 所有公开ID为1–128字符不透明字符串，推荐由服务端安全随机生成；不使用自增序号或微信身份主键。SQL使用text ID；JSON示例可用 `prj_demo` 等明显演示值，不作为已存在记录。
- SHA-256为64位小写十六进制。金额以人民币分整数、点数整数，JSON整数上限9007199254740991；数据库可用bigint并设置非负／业务界限。时间存UTC date-time；展示、预算日和对用户交付日期使用Asia/Shanghai。
- API根 `/v1`。成功 `{data,requestId}`，失败 `{error:{code,message,retryable,details},requestId}`；游标列表 data 为 `{items,nextCursor,hasMore}`。网页cookie＋CSRF、小程序短期bearer；回调独立验签、不是普通登录鉴权。工作区成员与资源权限逐接口校验。
- 对可重放的创建／财务／任务写接口用 `Idempotency-Key`；空间范围唯一且7天；同key不同payload→409。文档CAS使用If-Match revision（字符串形式），配置草稿、目录等更新也有expectedRevision／If-Match，冲突409。
- 文档schemaVersion1、px96、sRGB，1–50跨页、500照片、100递归图层／跨页、组深度≤5；原片JPEG／PNG≤25_000_000字节且≤80MP；任意外部URL不得作为素材引用。未知同版本层原样保留，未知未来版本／未知渲染层阻断导出。
- 业务schema文件名固定：`document.schema.json`、`layout.schema.json`、`config.schema.json`、`export.schema.json`、`provider.schema.json`。API $ref可引用这些文件的 `$defs`，各自必须有 `root` 可作入口；产品文档模型只在document文件定义，禁止另起冲突模型。
- 文件夹是工作区元数据；对象locator独立，basePrefix只作用于新写入；历史迁移复制、校验、条件更新并保留活动任务pin。原片、字体、模板、滤镜与快照版本不可变。
- 任务事实源PostgreSQL，Outbox＋BullMQ仅调度；fence／租约保护结果，取消与成功仅一终态；配置与报价版本冻结；未知供应商提交状态先查询，不重复付费提交。
- 原图缺失／字体缺失或无授权／文字超框或缺字／未知schema／资源超预算阻断导出；PPI100–199警告，<100强警告需明确确认；DPI72／150／300；50MP／输出面。600×300mm，300DPI，3mm四边出血→7157×3614px。
- 新计划沿用writing-plans格式：Goal／Architecture／Tech Stack／Spec、Global Constraints、5个Review Focus、文件与接口、每任务5个可勾步骤（失败用例含断言、失败命令、精确实现接口、通过命令、提交）；仅为待执行计划，不生成假通过报告。
- API operation 使用 `x-module` 值 C2／C3／C4／C5／OPS，`x-requirement-ids` 指向下述统一ID范围；具体功能可以多个ID，不能只有泛用API壳。

## 统一需求ID范围

原需求：AUTH-01/02、AST-01、DOC-01、EDT-01/02/03/04/05、TPL-01、LAY-01/02、GEN-01/02、PAY-01、LIC-01、EXP-01/02、ADM-01；另有V3-MODE-01、V3-LAYOUT-01/02/03、V3-EXPORT-01/02/03/04、V3-ART-01、V3-LICENSE-01、V3-CROSS-01。

配置：CFG-CENTER、CFG-STORAGE、CFG-FOLDERS、CFG-AI、CFG-AUTH、CFG-BILLING、CFG-EXPORT、CFG-CONTENT、CFG-NOTIFY、CFG-OPS。

补足：SHARE-01、NOTIFY-01、ACCOUNT-DELETE、PRIVACY-01、OPS-DEPLOY、OPS-BACKUP、OPS-MONITOR、SEC-01、APP-RESERVE。验收矩阵将按这些ID逐项映射到页面、API、计划和测试。

## 文档状态与边界

设计合同可离线校验语法、引用、字段和负面样本；不据此宣称业务服务已实现。SQL为初始迁移设计，可在临时数据库验证；不得连接生产库。实际部署镜像摘要／微信资质／商户准入／供应商key／价格由经营者接入时确认，使用明确决策记录而非在代码或文档里伪造值。
