# 事务、一致性与迁移边界（v1.0 设计合同）

本目录交付 PostgreSQL 16/17 的设计与可执行初始迁移，不交付 API、worker、支付/微信/存储/AI 适配器实现。共92表，覆盖身份、工作区、素材/目录、版本化内容、配置、商业/权益、点数、采购预算、任务、分享、通知、删除与备份。交易尝试、回调事实、履约、点数、采购成本和输出分别建表，使引用、金额与去重可单独约束。设计覆盖面达到全部模块；生产上线仍需服务事务、角色授权、真实适配器契约、并发/恢复/性能测试。

## 迁移与权限

- `001_initial.up.sql` 在空数据库执行，显式 BEGIN/COMMIT，创建专属 `ai_album` schema；没有扩展、超级用户函数、外部连接或自动种子。所有表按依赖顺序创建，无循环 FK。PK、FK、CHECK、唯一键均命名且不与其他表同名。应用连接显式 `search_path=ai_album,pg_catalog`、`TimeZone=UTC`；不接受业务请求切换 schema、环境或采购账户。
- 生产需受控部署账号拥有 schema，业务账号不能是 owner、superuser 或 BYPASSRLS，不能 ALTER、TRUNCATE、DISABLE TRIGGER。按模块授予最小表权限；不可变/账本表只授 SELECT/INSERT，mutable 表才授所需 UPDATE。PUBLIC 已无本 schema 对象权限。迁移不自行创建真实运行角色或假定已有用户。
- 没有依赖 RLS 的隐含隔离。资源查询必须带 workspace_id，按当前成员/角色检查，复合 FK 拦截跨租户写引用。`id` 全局唯一不等于可绕过工作区鉴权。成员移除后不应继续发签名下载 URL；已有 URL 在 TTL 内仍可能有效。
- `001_initial.down.sql` 是**不可恢复的本地临时库清空**，受会话 `ai_album.allow_destructive_local_reset=yes` 保护；该标志仅防误操作，不是生产识别或权限隔离。不得对生产执行。生产数据库回退用兼容的 forward migration，灾难恢复用已验证备份与墓碑重放，不能用 DROP SCHEMA 回滚版本。
- 不可变 SQL trigger 拦截 UPDATE/DELETE，不声称拦截表所有者或 TRUNCATE。数据到期的依法清理需单独维护身份、停服窗口/锁、审计及专门清理迁移；业务角色不能临时关闭 trigger。上迁移失败整个事务回滚；重复上迁移主动失败，迁移版本与 SQL hash 由部署工具记录。

## SQL 强制与服务强制清单

| 不变量 | SQL 直接保证 | 事务服务必须实现 |
|---|---|---|
| ID/金额/时间 | text domain 长度1–128；bigint 0–9007199254740991；SHA-256格式；timestamptz | 安全随机生成，不从微信ID、序号或姓名构造；UTC序列化 |
| 所属工作区 | 复合 FK、workspace 不可修改 trigger | 每个读取/写入鉴权；跨空间复制只能新资源和显式授权，不改 workspace |
| 文件夹 | 同空间父级 FK、自父级拒绝、有效名称、活跃同父级规范名唯一（含 NULL 根） | NFC+casefold、去空白、祖先无环、≤10级、整子树深度、expectedRevision；所有目录结构写在同一空间锁下串行 |
| 不可变版本 | revision、模板/字体/滤镜/模型/配置/快照等34表禁止 UPDATE/DELETE；存储对象 locator/content 不可修改 | JSON Schema、未知同版本层保留、未来版本/未知渲染层阻断、完整引用/授权/配额检查 |
| 素材/上传 | 字节≤25MB、尺寸≤80MP、JPEG/PNG；ready/trashed必须有解码事实；初始化后字节元数据不可改 | 25MB为25_000_000；HEAD/magic/真实解码与hash；同一字节才可切换 copied object；不信客户端尺寸/metadata |
| 项目当前版本 | 唯一(project,number)/(project,commandId)，新版本 number=base+1，不可变 | 锁项目、CAS current_revision、插revision和引用、更新指针同事务；current_revision>0必须存在匹配版本 |
| 配置环境 | profile/secret、provider/secret、active-release复合环境 FK；不可变发布版本 | 完整 schema、发布清单所有依赖同环境/可用/许可/测试hash匹配，CAS生效指针；不把SQL object CHECK当发布验证 |
| 金额履约 | 非负与界限；渠道事件唯一；一订单一grant_type、一兑换码一空间；provider交易号唯一 | 验签/商户/金额/币种/order匹配、合法订单状态、累积退款≤已收金额、不得重复履约 |
| 点数 | lot各桶总和=granted；流水 operation_id 全局唯一；有效桶迁移；追加不可改 | 账户投影等于各lot/流水；按最早到期分配、预占总额=报价、分配总额=预占、一次终局、退款/到期补偿 |
| 采购预算 | 稳定账户/连接/当天 FK；非负桶；独立采购成本流水 operation_id唯一 | 上海业务日、账户+连接双上限原子预占、预算0停止新任务、旧日未知预占继续保留、实际超估记账而非丢事实 |
| 任务 | 状态集合与转换；初始queued/fence0；revision+1，只有queued→running领取能使fence/attempt+1；终态不可改；输出写入锁住job并查当前未过期fence/状态 | 领取/续租/结果/取消条件写；fence仅领取新执行增加；snapshot/quote/job一致；调用上游前持久化提交意图；不重付 |
| pin/输出 | 任务/对象/版本引用；output(job,index)唯一；私有对象locator不可改 | 全资源manifest逐项pin、全对象hash/权限；同事务输出+成功+账本+outbox；仅成功任务可下载；失败孤儿清理 |
| 幂等/分享/删除 | 作用域+key唯一（NULL平台作用域也唯一）、≥7天；token只存hash、墓碑追加 | 请求canonical hash比较与409；分享密码/到期/撤销检查；注销撤会话/分享/停止新任务、合法保留/备份删除重放 |

## 统一锁和事务重试

采用 READ COMMITTED 加显式行锁与条件更新；需要多行不变量的事务不能只读后写。统一锁序：幂等占位 → workspace（若目录/成员/容量/工作区余额涉及）→ project（若保存）→ 已存在job（若终局）→ order（若履约/退款）→ credit_account → credit_lots（expires_at,id排序）→ billing_account → budget_day → provider connection → provider_budget_day → reservation（id排序）→ 子记录。单事务若跨流程，跳过不涉及的锁但不倒序。新建 job 在接受事务内尚未对外可见，不等同于“先锁一个别的既有job”。维护任务遵同锁序；先读候选ID，锁后重新验证。目录和成员写锁 workspace；worker金融终局不需要反向锁workspace。

平台运维任务 `privacy_export/config_test/reconciliation/backup_restore_drill` 与其他任务同样需要非空 workspace_id；由服务端分配 kind=platform 的专用工作区，公开创建工作区接口只能创建 personal/studio，不能让客户端自选平台空间。SQL包含这些job kinds，不代表这些worker已实现。

所有锁内检查用数据库 `clock_timestamp()`（不依赖客户端时钟；`now()`在长事务内不前进）。业务事务有短 statement_timeout/lock_timeout，不在持锁时调用第三方网络。40001/40P01 可有限退避重跑整个事务；23505 仅在能识别命名唯一键时转成幂等重读或冲突，不能吞掉全部数据库异常。外部调用与未知 COMMIT 均通过operation_id/provider_request_id查询已存在事实，不凭一次连接错误再次收费。

工作区余额账号、当日预算行的首次创建：INSERT ... ON CONFLICT DO NOTHING，再 SELECT ... FOR UPDATE。不要以“没有行可锁”视为已排他。行内 CHECK 防负数，但跨表余额/预算总量无触发器自动维护：仅财务事务服务可执行相关写入，每次同事务更新lot、account、reservation、append-only ledger、outbox。

## 登录、绑定与注销

1. 微信 code 交换和回调证据在适配器验证；不存 session_key。生成一次性 auth_challenge，token仅存hash、expires_at。消费在行锁下校验 state/时效并条件改为 consumed；扫码确认不等于已发放会话。
2. 绑定需当前会话再认证证明和目标身份新证明。锁用户与挑战，尝试写 `(provider,app_id,subject_digest)`；唯一冲突返回身份已占用，不按昵称/手机号/无范围UnionID自动合并。UnionID只在经过验证的union_scope内使用。手机号/subject摘要应为服务端带pepper不可逆稳定摘要；pepper版本与可撤销加密映射在秘密服务托管，不进SQL/日志。
3. 会话刷新锁旧 session，校验 refresh_hash/过期/撤销，撤旧发新同事务，轮换重放触发会话链撤销；csrf_hash 用于cookie写请求验证。绑定/登录挑战state与bound身份/会话必须同事务，过期挑战定期清理。
4. 删除请求需再认证、延迟/确认与影响预览。锁用户/所属空间，处理影楼owner移交和未结订单、未知AI成本、法定财务保留；未解决时blocked。确认后撤销全部会话、绑定访问、分享和新作业权限；通知不发送敏感详情。
5. 资产先撤访问，再在引用/活动pin/保留检查后删除对象；写 deletion_tombstones。同一原子业务操作使用稳定operation_id。用户/工作区行保留去标识 anchor 以维持账本 FK，删除个人资料与外部秘密映射；不能物理级联删财务事实或把deleted状态当已清理对象。删除完成必须有对象清理结果和备份保留说明；备份到期前可恢复数据时不得宣称“所有副本即时删除”。

## 上传、目录、回收与存储迁移

- 创建上传先锁 workspace/usage_account，检查 used+reserved+bytes≤当前有效限制，插 quota_reservation 和 pending_upload asset、upload_session，记录服务端生成的profileVersion/bucket/key。asset在初始化阶段允许hash、object/dimensions为NULL；ready前必须完成真实验证。上传凭据本身不存库。外部上传无长数据库事务。
- complete使用幂等事务进入verifying，真实HEAD/解码/hash在事务外；最终按 expectedRevision/状态条件写已验证 storage_object，初始化asset不可变元数据并ready，扣reserved加used，同事务插必要outbox。重复complete只返回已完成结果。失败/超时释放容量一次；若对象已上传但未绑定，进入受保留策略保护的孤儿清理。原文件名仅私有展示，绝不参与key。对象locator创建后不可改。
- 所有创建/重命名/移动/目录删除/恢复先 `SELECT id FROM workspaces WHERE id=:wid FOR UPDATE`。在此锁下递归CTE查祖先和子树：拒绝目标是自己/后代、总深度>10、跨空间、已删目标、规范名冲突；expectedRevision条件写。所有目录结构写都遵循该锁，避免两个并发互换父级形成环；仅 CHECK parent<>id 不能防多节点循环。
- 删除目录先算整个子树和全部资产引用（current/retained project revision、活动job pin、法律留存）；任何会破坏引用的项目即整批409，不隐含部分成功。写 trash_operation/items 和原parent/name；事务内标记deleted_at与state。恢复校验原父级/目标、冲突、深度，冲突由用户改名/选目标，不覆盖；物理用量不因进回收站减少。
- 清理按复核revision、保留期、引用、pin、备份策略决定；锁顺序同工作区，禁止仅按创建时间在云桶生命周期直接删除仍引用原片。实际对象DELETE确认后才能减少物理used。未完成上传24h、回收30d、输出7d仅默认策略，发布版本冻结并由清理服务执行；活动作业pin优先。
- 默认profile/basePrefix切换只影响新写入。旧对象按历史row读取；basePrefix不得在读时重算。SQL只做字面前缀安全检查，应用还须拒绝百分号编码/重复解码逃逸、绝对路径、空段、控制字符，规范化后展开固定v1 token；endpoint/域名/CORS精确白名单由发布验证器验证。
- 迁移复制到**新storage_object**，校验字节/hash和供应商objectVersion，再在锁下按 asset.expectedRevision、source object/hash 比较并更新 assets.original_object_id（内容hash不变）。旧storage_objects row从不retarget；asset_variants不可变，重做variant需新pipeline版本。resource_pins存job所属空间和独立storage_workspace_id，允许引用已授权的平台字体/模板对象，不能据此读取其他工作区素材。跨空间pin必须是全局授权内容且版本对象匹配，由服务检查。
- 迁移切换只修改当前asset指针；冻结manifest和pin仍持有旧objectId/locator。旧副本保留到最后pin释放+保留期，逐对象检查点可续传。失败/回滚只改新请求路由，不删除副本；retired profile如仍有对象或pin不可撤读取凭据。

## 保存、候选与导出提交

- 保存以 If-Match字符串解析安全正整数。锁project并查current_revision，校验document.schema.json与引用：1–50跨页、≤500照片、每跨页≤100递归层、group深度≤5、坐标有限、无外部URL、未知同版本层原样保留。写文档对象后在事务内追加 project_revision/asset引用并条件更新 current_revision；孤儿对象由回收清理。commandId重复同body返回原revision，异body冲突。schema迁移新建版本，不改旧记录；恢复草稿不移动current_revision。
- layout_jobs冻结base revision/约束/seed；layout_candidates为不可变候选，不更新文档。apply以当前revision CAS，验证candidate来自此项目、未过期、约束/资源/许可有效，再产生新revision；冲突保存恢复草稿或409。建议文字不被当代码执行。
- preflight固定revision与normalizedSpecHash，检查字体存在/授权/缺字、文字超框、未知schema/render层、原图缺失、PPI警告、目标像素。SQL仅可保证已存max_face_pixels≤50MP/DPI=72/150/300；全部业务检查和真实预估由服务负责。机器格式枚举固定`jpeg/png/pdf`（JPEG文件扩展名可为.jpg）；ZIP只作为多输出面归档/隐私导出包的job_output格式，不能作为exportOptions或preflight格式。job_outputs另外允许json供结构化结果。PPI100–199警告，<100强警告需明确确认；禁止把这些警告当可跳过缺资源阻断。
- 接受导出在同事务校验preflight token hash/时效/revision/specHash、无blocker、必要warning ack、当前权益和资源预算；插 job_snapshot、job、精确resource_pins、必要quota预占、outbox、幂等响应。快照固定config release、font/template/filter versions、asset对象locator/hash、renderer版本和镜像digest；manifest必须完全闭合且受JSON Schema约束。job.kind/quote/snapshot/preflight/当前授权等交叉一致性由事务服务保证，不声称所有这些由FK覆盖。

## 订单、支付、兑换与退款

### C4 durable order binding amendment

Apply `002_order_snapshots.up.sql` after `001_initial.up.sql` (93 canonical tables after this additive migration). `orders` alone cannot freeze the application, merchant, virtual product mapping, release, published SKU features and refund policy. The immutable `order_snapshots` business row stores those nonsecret facts, a canonical JSON SHA-256, and release/payment-item foreign keys. Its insertion guard checks workspace/order ownership, frozen SKU ID/amount/currency/channel and the exact immutable published payment payload. Service validation additionally checks canonical hash, published SKU materialization, product mapping and real channel/platform admission. Secret references are versioned references only, never key bytes. Application users receive neither this internal snapshot nor credential references.

Counterexample: create an order, then expire/delete its seven-day `idempotency_keys` record and publish another payment app/product mapping. A delayed callback must still validate against the original snapshot, and a refund must use the original binding. Keeping that snapshot only in `response_json` loses financial facts during legal idempotency cleanup. The payment integration tests execute this deletion, verify the old callback, and reject snapshot mutation plus mismatched snapshot price/release. The migration adds no ledger and does not change idempotency retention. Runtime deployment must apply both canonical migrations before enabling payment endpoints; the C3 disposable database helper applies both.

Rollout: run `002_order_snapshots.up.sql` once under the migration owner after the initial schema and before enabling order creation; it does not backfill financial bindings for legacy orders. Legacy orders without reconstructable authoritative bindings remain blocked for manual review. The matching down file is guarded by `ai_album.allow_destructive_local_reset=yes` and only removes this table/function in a disposable local database; production uses forward migrations and retains snapshots.

1. 创建订单在服务端读取已启用sku的不可变version，冻结CNY金额和渠道/平台，写幂等记录。支付尝试有独立attempt和稳定provider_request_id（商户号作用域）；客户端“支付成功”只触发查询，不能发权益。
2. 回调先独立验签/证书/时间/商户/app/币种/金额和provider transaction匹配。验签通过的事件按(channel,merchant_account_ref,provider_event_id)插payment_event，同事务锁order/attempt，检查状态和金额，改paid并插唯一entitlement_grant、credit_lot、credit_ledger、outbox。若同事件已存在，验证body_hash后读结果；若前事务未知，查询订单/渠道事实。一次provider transaction只能绑定一个attempt。
3. 拆开pay event和履约状态是为重放恢复；重放同事实只补缺少的唯一grant/lot/ledger。不可让管理员直接改订单为paid绕过事件与账本；人工调整必须明确审批、operation_id、补偿流水和审计原因。
4. 兑换锁code与batch，检查启用/expiry/used_count<max_uses、用户/空间权限；插redemption（同code同空间唯一），used_count+1，追加来源grant/lot/ledger/outbox同事务。批次停用与兑换须统一锁序；原始兑换码仅初次安全交付，数据库/日志只hash，接口限速且错误不暴露枚举信息。
5. 退款锁order、对应attempt和相关credit_account/lots；累计成功+待定退款预留不能超过已收金额。建立refund稳定operation_id，调用渠道在事务外，unknown先查询。渠道终局成功同事务反转grant/可撤销credit余额、追加revoke/补偿流水；已消费点数/已交付结果按公开退款规则转manual_review，不能改历史流水为0。活跃预占先查询/取消终局，不能在worker可结算时又释放同一批点数。需要取消时先挂起退款，在独立任务事务完成取消/终局后再重试退款，不持有order锁反向请求job锁。
6. 会员到期阻止新收费/超额操作，不自动删已有作品/素材；权益来自时间窗与策略版本，不能仅信subscriptions.state缓存。续费生成新订单/时间窗，不改旧SKU价格。源order/grant、引用版本及财务事实按法定期限留存并去标识。

## 点数、报价与稳定采购预算

**报价阶段**不扣款/不预占。generation_quote冻结configRelease、route/model/provider/preset/costRule、inputHash、consent/reference、点数/预估与上限成本、5分钟有效期，每子任务1张图。用户合法授权和明确传输用途单独generation_consent；不把全部相册上传。公开响应不暴露采购成本/平台endpoint/秘密。

**接受事务**：

1. 原子插幂等占位，重复key先比较canonical request_hash；锁所需工作区/余额。锁quote或利用 jobs(workspace_id,quote_id)唯一键保证仅接受一次。按clock_timestamp检验expires_at、输入hash、模型能力/路由/预设支持白名单、当前许可、参考图所属及可用、config和secret允许新提交。已接受的同key重复返回既有job，即使quote后来过期，不重新预占。
2. 锁credit_account，按 `(expires_at,id)` 锁未到期可用lots。余额不足402；按FEFO分配 reservation_allocations，available→reserved，更新account，追加每lot reserve流水。quote点数为0允许零amount reservation、零allocation，不写零金额credit_ledger。
3. 采购日以 `(:acceptedAt AT TIME ZONE 'Asia/Shanghai')::date` 计算，稳定归属ai_billing_accounts.account_billing_id。锁billing_account → budget_day → connection → provider_budget_day；检查账户/连接两者有效上限，当前reserved+spent+quote.maxCost不得超限。0表示停新付费；密钥、connection version、模型/路由切换不创建新的账户预算桶。相同采购账户多connection共享budget_day，同时计各自connection上限。
4. 预算row的limit_fen是当日接受策略快照，运营降额不能抹去既有reserved/spent；锁同row更新limit后若已超限，只阻止新增，不拒绝记录实际费用。budget_days不以CHECK强制spent+reserved≤limit，避免实际超估费用无法入账；服务在**接受新任务时**必须检查两层上限。spent+reserved不得超JSON安全整数，极端溢出需财务异常队列和停新任务，不能丢账。
5. 同事务插snapshot/job、credit_reservation、budget_reservation和采购reserve流水、pins、outbox、幂等响应。预算预占归属接受日不因午夜/租约重试迁移到今日。提交后才可调度调用供应商；任何一步失败全回滚。

**终局事务**：先锁job并检查expectedFence/状态/lease，再依统一顺序锁余额、lots、采购账户及两个预算桶、两种reservation。成功且审核/标识通过：reserved→consumed，release采购保守预占、记actual成本，发布私有结果/来源，job=succeeded并terminal_at，同事务append ledgers、outbox。明确拒绝/失败：reserved→available（若lot未过期且grant有效），否则reserved→expired/revoked；采购成本按已发生事实记账，其余释放；job失败或取消。每个reservation仅从held条件转一次，operation_id唯一作为第二道防重，抢占失败回滚整个结果事务。

- **lot到期与预占竞争**：过期sweeper锁credit_account、lot，仅available→expired；reserved保持，不能偷走运行任务已占额度。若接受先锁并检查未到期，后到期仍可用既有预占成功结算；若过期先锁，接受看不到可用额。终局失败释放时重新检验lot时效，已到期部分进expired而非恢复available。账户available/reserved与lot投影同事务变更，不能先释放再扣。
- **未知供应商状态**：提交前持久化stable provider_request_id与submission intent，网络调用不持金融锁。超时/进程崩溃/响应丢失把状态保持unknown/accepted，查询原request/job；不跨供应商、不凭429/超时盲目再次付费提交。只有确认从未接受且备用满足原报价能力/质量/价格，才可用固定备用，否则释放旧报价并让用户新确认。
- **终局时限**默认30分钟可配置，expiry sweeper先按job锁与供应商查询结果/合同判定。仍未知到合同上限时，停止发布资格、释放用户点数与未发生的采购预占，job进入终态；迟到结果不再次扣点、不发布。已产生/迟到确认的采购成本进provider_cost_ledger late_charge/reconcile并归原budget_day，可能超限后停新任务；不得为保持预算表面不过限隐去真实费用。
- **费用与点数分离**：非收费query若供应商按次收费，也写采购成本。用户点数不随供应商实际价格变动重新扣。实际费用>max预估属于运营告警/策略校正，仍记录；采购对账不能修改已结用户ledger。取消仅表示请求，需上游明确终局或时限规则后释放，防止取消同时上游已收费的双花。
- **账本operation_id**每个物理流水行全局唯一、opaque≤128；多lot同一业务操作用共同operation_group_id、递增operation_line与各自独立operation_id，不能多行复用一个ID。服务重试使用已持久化同ID，禁止临时重生成规避唯一键。余额/lot校正只写有原因的补偿流水，禁止UPDATE历史。

## worker、租约、输出、Outbox 与幂等

- dispatcher按outbox未sent且available、claim过期选行 `FOR UPDATE SKIP LOCKED`，写有到期claim后提交；向BullMQ投递以jobId dedupe，成功后条件sent_at。队列断线重投；投递成功但DB确认丢失可重复，worker按job事实去重。sent不等于job完成；定期用jobs/outbox修复队列，不用Redis重建余额。
- worker领取必须条件 `state=queued`（或先retry_wait→queued）、revision匹配，`fence=fence+1, attempt_count+1, revision+1, lease_owner, lease_expires_at`。续租只在id/workspace/current fence/owner/允许状态且 lease仍有效时更新revision+1；过期worker不能自行续回。后台回收器先按租约过期与provider_submission_state判断query/retry_wait，不能让unknown上游任务重新submit。
- 每次条件结果写 WHERE id/workspace/fence/revision/state/leaseOwner/leaseExpiresAt；0行表示失去资格，停止发布。SQL trigger验证fence单调和transition，但不能替代expectedFence WHERE，也不声称知道调用者worker身份。
- 结果先写独有临时object，真实下载校验、MIME、尺寸、SHA、审核/标识通过再进入结果事务。INSERT job_output触发器锁job并验证可发布state、当前fence和未过期lease；服务须在**同事务**完成账本与job=succeeded，下载只查succeeded任务。若只插输出不成功，此row不可被下载，后续错误清理/补偿由维护流程处理。旧worker/fence、已cancel_requested或终态均不能插新output。
- cancellation先条件queued/running/packaging/retry_wait→cancel_requested；运行worker在安全点按fence终局cancelled。若成功先锁并提交，终态trigger阻止改cancelled，取消API返回既有成功；若cancel_requested先提交，success/output都被拒绝。两个顺序的SQL检查已验证，但没有声称运行了真实多连接竞态压测。
- 最大重试默认3次（SQL可配置1–10）；invalid schema/font/license/budget等永久失败不重试。重试仅已确认无上游重复付费风险；OOM不得无变化重跑相同内存，重试parentJob产生新quote/权限/预占，旧终态不可复活。取消/失败/成功仅一个终态。
- output过期/分享撤销仅停止新签名；已发300秒URL不是即时可撤销。生成结果上游URL仅后端临时取回，允许域名、重定向次数/大小/时限/解码像素都由adapter验证，禁止任意URL/SSRF/原图GPS外泄。生成provenance冻结具体model/provider/preset/consent/许可/审核/标识，不伪造可重复像素保证。
- Idempotency-Key：工作区请求principal_scope固定`workspace`，同workspace跨operation仍唯一；登录/绑定/平台操作workspace=NULL且principal_scope为经过认证用户/平台或匿名流程的稳定服务端作用域。不能接受客户端指定scope。首次INSERT唯一冲突后等待/重读已有记录；相同hash已完成返回原状态/响应，异hash409，处理中返回可轮询状态不执行第二次。
- 幂等占位、业务写、最终响应同事务；涉及外部调用的流程先提交可恢复业务意图，未知结果由稳定requestId查询。至少7天保留，自created_at算，过期删除前确认无非终态业务；到期允许重用key不免除订单/grant/ledger/provider_request_id的永久财务去重。canonical hash覆盖method/path/主体/workspace与规范请求body，排除随机签名和传输header。

## 通知、分享、审计与恢复

站内通知以recipient+event_key去重，投递按channel+attempt记录；只从已提交outbox消费，偏好禁止时suppressed。第三方通知响应丢失先按provider_message_id查询，不能声称各渠道恰好一次。小程序订阅授权单独服务校验；保留App适配不表示首期已发送App通知。分享固定项目revision、用途scope和expiry，token使用高熵随机值只存hash，可选强密码hash；每次访问鉴权、口令、限速与撤销校验，分享不授权任意assetId下载。审计、通知payload只存脱敏业务摘要。

备份同时涵盖PostgreSQL、对象与配置版本引用；秘密由秘密服务独立备份，SQL只引用。恢复先隔离外发/付费调用，恢复数据库+对象至一致水位、重放 deletion_tombstones 到最新已知水位，恢复法律保留与撤销状态，再对账订单/供应商unknown任务/点数/预算/对象pins，用jobs+outbox重建调度，完成恢复演练后开放访问。恢复不得把已撤销分享/已删对象重新公开；RPO/RTO与备份保留期须在生产环境实测，本目录不编造达标值。

## 本次实际验证与后续门槛

2026-10-21，在本会话的隔离Docker临时库实际运行 PostgreSQL 17.11 与 16.15，未连接生产、未调用支付/微信/AI/存储服务。实际结果见本文末尾记录。`contract-checks.sql` 是可重复的SQL负面/正面样本，每次BEGIN/ROLLBACK，不是产品测试套件。两个版本都执行了完整SQL迁移与约束样本；最终jpeg/zip枚举对齐后仅重新执行PostgreSQL17，PG16记录适用于枚举修订前的结构与36项样本，不将其表述为最终文件已再次跑过PG16。

复现（仅有授权的临时空数据库）：

```sh
psql -X -v ON_ERROR_STOP=1 "$TEMP_DATABASE_URL" -f 001_initial.up.sql
psql -X -v ON_ERROR_STOP=1 "$TEMP_DATABASE_URL" -f contract-checks.sql
# 未设置本地标志时 down 应失败且 schema 保留
psql -X -v ON_ERROR_STOP=1 "$TEMP_DATABASE_URL" -f 001_initial.down.sql
# 仅本地销毁：在同一个连接设置标志再执行 down
psql -X -v ON_ERROR_STOP=1 "$TEMP_DATABASE_URL" \
  -c "SET ai_album.allow_destructive_local_reset='yes';" -f 001_initial.down.sql
psql -X -v ON_ERROR_STOP=1 "$TEMP_DATABASE_URL" -f 001_initial.up.sql
```

待实施后必须增加真实多连接测试：双扣点/两连接预算穿透、上海午夜旧预占、lot到期竞争、退款与运行中job、folder并发互换父级、租约过期旧worker提交、成功/取消同时提交、outbox重复投递、DB COMMIT丢响应、provider已接受但submit超时、迟到收费对账、secret紧急撤销、迁移与pin/删除竞态、恢复后墓碑重放，以及全量schema/许可与导出像素样本。SQL检查不能证明这些服务协议已实现。


实际SQL验证记录：

| 检查 | PostgreSQL 17.11（最终jpeg/zip修订） | PostgreSQL 16.15（枚举修订前） |
|---|---|---|
| 空库执行初始迁移，ON_ERROR_STOP=1 | 通过 | 通过 |
| contract-checks.sql 预期失败断言（逐个SQLSTATE匹配） | 最终39项通过 | 修订前36项通过 |
| 有效上传元数据初始化、live-fence输出、终态与lot/ledger夹具 | 通过；新增jpeg preflight和jpeg/zip输出通过（最终ROLLBACK） | 修订前夹具通过（最终ROLLBACK） |
| 未设置local-reset标志时down拒绝，原schema保留 | 通过，psql退出3 | 通过，psql退出3 |
| 设置local-reset后down，再重新up | 通过 | 通过 |
| 目录自检：92基础表/746约束/203外键/重复约束名0 | 通过 | 通过 |

容器使用 `postgres:17-alpine` 与 `postgres:16-alpine`，本次镜像内容摘要分别 `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`、`sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`；仅为本次临时验证环境证据，不是产品生产镜像锁定。容器无宿主端口映射，执行使用 `docker exec -i ... psql -X -U postgres -d contract_test -v ON_ERROR_STOP=1`。下迁移仅在这些临时容器运行。SQLSTATE负面断言分别覆盖23514、23503、23505；没有把顺序化状态断言称为真实并发竞态测试。

最终枚举补充验证：`export_preflights.format=jpeg`成功、`jpg/zip`分别以23514拒绝；`job_outputs.format=jpeg/zip`成功、`jpg`以23514拒绝。最终SQL在PostgreSQL17重新空库up、39项负面断言/正面夹具、down保护拒绝、guarded down/up及目录自检均重新执行。provider submit未知状态查询、双预算锁及终局释放仍是待实现服务事务要求；本SQL检查不证明这些跨供应商协议已经实现。
