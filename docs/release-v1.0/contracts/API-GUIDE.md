# API v1 研发合同与接入说明

状态：设计交付，2026-10-21。权威机器合同为 [openapi.yaml](openapi.yaml)，共享约定为 [CONTRACT-RULES.md](../CONTRACT-RULES.md)。不代表接口、支付、微信、AI 或云账户已经实现、采购或上线。根地址 `/v1`，OpenAPI paths 不重复 `/v1`。接口环境由部署固定，业务请求不得切换环境。所有示例 ID、摘要及证明均为演示值，不含真实价格、密钥或采购结论。

## 合同组成与类型边界

OpenAPI 3.1 使用 JSON Schema draft2020-12。业务对象仅引用五个 schema 根：

| API 字段 | schema 根 | 用法 |
|---|---|---|
| `ProjectDocument.document`、模板文档、候选文档 | `schemas/document.schema.json#/$defs/root` | 自有 DocumentModel 是唯一业务文档模型；不接受 Fabric 私有 JSON 代替 |
| `LayoutJobCreate.layoutSpec` | `schemas/layout.schema.json#/$defs/root` | 完整 LayoutRequest；包含 projectId/baseRevision/photos/constraints/templateRef/algorithmVersion/seed |
| `PreflightRequest.exportSpec`、normalizedSpec | `schemas/export.schema.json#/$defs/root` | ExportOptions：png/jpeg/pdf、DPI72/150/300、singlePage/spread、pageIds、封面、出血、JPEG底色 |
| `ConfigDraftCreate.value`、ConfigDraft.value | `schemas/config.schema.json#/$defs/root` | 按 kind 区分的类型化配置值；不是任意 JSON 编辑器 |
| ProviderAdapterContract | `schemas/provider.schema.json#/$defs/root` | 经过契约验证的适配器版本、能力与输入/结果限制 |

API 本地 schema 只定义传输信封、请求、列表、权限证明和业务摘要。`FilterOperation.parameters` 是唯一有意开放的键值配方字段：仅允许有限数字/短字符串、最多10项，仍需通过指定 recipeVersion 的不可变参数白名单；禁止脚本、CSS 和模板表达式。配置、项目保存、任务输入均无任意对象请求兜底。

所有公开 ID 是1–128字符不透明字符串，不能当成可信权限凭证；按具体共享 schema 的进一步限制校验。SHA-256 为64位小写十六进制。JSON 数值上限9007199254740991，金额为人民币分整数，点数为整数。时间传 UTC RFC3339；预算日、经营日期及交付展示使用 Asia/Shanghai。服务端校验引用存在、权限、跨字段不变量、唯一性和状态转换，不能只靠 JSON Schema。

## 响应与分页

业务成功：`{data,requestId}`；业务失败：`{error:{code,message,retryable,details},requestId}`，同时返回 `X-Request-Id`。禁止使用 HTTP200 包装失败。details 是已声明的诊断数组，不能回传秘密、上游原始错误、对象 locator 或其他工作区信息。500只返回通用信息和关联 ID。

游标列表 `data:{items,nextCursor,hasMore}`；limit默认20、最大100。末页 `hasMore:false,nextCursor:null`，有后页时必须有非空 nextCursor。游标绑定成员作用域、筛选、排序与稳定的 `(sortKey,id)` 边界；不得接收可修改 SQL offset。权限变化重新校验，不信任旧游标。首次请求可指定筛选，继续请求必须相同；过期或不匹配游标返回400 INVALID_CURSOR。列表在并发修改时不承诺数据库快照；不可变账本/版本列表可按 createdAt/id 稳定遍历。

支付/退款/供应商/通知回调是外部协议例外：成功 ACK 按登记适配器的确定格式发送，不能包装业务信封。健康 readiness503也是明确例外：返回 ReadyStatus 的成功式诊断信封，表示探针状态而非业务成功。

## 三种身份边界

网页安全写操作采用 OpenAPI security 的 `WebCookie AND CsrfToken`，或独立的 `MiniBearer` 分支；不是 Cookie 或 CSRF 二选一。网页会话 Cookie 必须 HttpOnly、Secure、SameSite=Lax，登录后轮换；所有 Cookie 写操作校验 session-bound CSRF token 和批准的 Origin，CORS精确来源。GET只读取，不产生账本或资源变更。`GET /auth/session` 在已登录同源会话中返回 CSRF，不返回 Cookie token。

小程序使用短期 opaque bearer，访问 token建议≤1小时；刷新 token家族轮换、哈希存储、重用检测撤销。刷新接口使用其专用 refreshToken，不接受普通 Cookie 作为替代。客户端传来的 platform、openid、unionid、session_key 不能决定身份；平台及当前授权能力由会话和服务端适配器核验。APP-RESERVE仅保留共享接口模型；capabilities返回 app_reserved 不可用，不承诺 App 登录、支付或安装包已交付。

回调的登录 security 为 `[]`，含义是“独立外部协议验签”，绝不是不验身份；`x-independent-callback-verification.required:true` 是硬性接入条件，见下节。后台使用同一安全会话机制并额外要求平台 RBAC、敏感操作目的绑定复验；普通 workspace owner不具备后台权限。

扫码流程是公开登录引导能力，不要求已有网页账号：

1. 浏览器先本地生成高熵browserNonce，再 `POST /auth/web/qr-sessions {browserNonce}`；首请求幂等范围绑定nonce hash及Origin，服务端另签匿名Cookie。接口校验 Origin、限速并绑定匿名浏览器 Secure HttpOnly nonce；sceneToken、pollToken 是不同随机能力。
2. 浏览器以 `X-QR-Poll-Token` 轮询自己会话；pollToken+原浏览器 nonce匹配，最短间隔1秒、总有效≤5分钟，不返回内部微信身份。
3. 已登录小程序使用 MiniBearer+sceneToken+显式确认调用 confirm。
4. 原浏览器带 pollToken、browserNonce、单次consumeProof调用 consume，原子消费并轮换网页 Cookie。该路径使用浏览器 nonce与Origin保护，不伪造已登录 CSRF要求；旧 Cookie不能替代能力验证。
5. 过期/消费/撤销不可再次用于登录；只有相同幂等请求可重放已确定结果，不能把证明转给另一浏览器。

短信 challenge限制用途、手机号/IP频率、验证码尝试和有效期；对不存在账户使用相同通用响应防枚举。登录保护还包括 CAPTCHA 和登录 CSRF的浏览器状态绑定。敏感操作先 `POST /auth/reauthenticate`，返回≤5分钟、绑定 actor/session/purpose的 reauthProof；后台秘密、财务、发布、运维及所有权操作还要求 `X-Reauthentication-Proof`。接口 body中声明的 proof与header在同时出现时必须相同并用途匹配；禁止跨会话复用。验证手机号或微信身份后才能生成证明，客户端不能自签。

## 工作区、资源与许可证权限

每个 operation 都有 `x-required-permission`。这是可实现的权限键，不是可由客户端申报的 scope。每次查询/写入先验证用户、工作区成员状态，再由资源记录推导真实 workspace，再校验角色/权限、资源状态、许可证和能力。只知道另一个工作区的 assetId、orderId、revision、outputId 或 jobId 不产生访问权；返回通用404避免存在性泄露。JWT或 Cookie成功不能替代任何一步。

| 角色 | 默认权限范围 |
|---|---|
| viewer | 工作区、已授权项目/素材只读及被允许下载；无上传/保存/创建任务/付款 |
| designer | viewer能力＋assets.write、projects.write、layout/generation/exports创建；assets.delete由角色策略显式授权 |
| admin | designer能力＋工作区偏好、成员（不提升到owner）、分享管理；账务购买/退款须显式授权 |
| owner | 工作区管理和账务授权、成员/席位/所有权转移；不能绕过平台限制或版权 |
| 平台角色 | `platform.config.*`、`platform.secrets.*`、`platform.content.*`、`platform.finance.*`、`platform.ops.*`、`platform.audit.read`按职责分开授予 |

后台发布还必须按配置 kind校验专项权限：payment/sku/aiPricing要求财务，storage/retention/queue/monitor要求运维，content/share及模板/字体要求内容/许可，auth/account要求安全身份管理，aiConnection/aiRoute要求AI配置管理。通用config.publish不是跨职责万能许可。记录操作人、理由、请求ID和前后hash，审计不可修改。

workspace owner转移只允许现有合格成员，需CAS和复验；不能借 member update删除最后owner。成员删除立刻禁止新资源访问和新下载令牌。个人与影楼权益、作品、素材不隐式迁移；首期不提供跨工作区 move或自动账号合并。付费/许可资源需后端检查，不能只隐藏前端入口。

绑定必须验证当前和目标身份；撞号返回 BINDING_CONFLICT，首期无隐式合并。解绑后必须有剩余登录方式。账户删除先列 owned_studio、活动财务/任务及合法保留阻断项，再安排可取消的删除期。撤会话/分享，按保留/备份策略处理物理对象；法规保留财务记录与用户内容删除分开。不可宣称立即抹除所有备份。个人数据导出需复验，仅本人数据及被许可清单，通过短期私有输出获取。

## 幂等与CAS

所有可重放创建、财务、任务写入，以及合同标记的普通写入要求 `Idempotency-Key`。建议安全随机16–128 ASCII字符；在工作区范围跨路径唯一，固定保留7天。无workspace的已登录操作按用户，预登录操作按受限浏览器/challenge范围。服务器规范化 method、path、body和影响业务的参数，保存请求hash、首个确定状态码及响应。并发同key串行裁决；同key同输入返回原结果（含原resourceId，不重复扣款/扣点/发短信），同key不同输入返回409 IDEMPOTENCY_MISMATCH；处理中返回409 IDEMPOTENCY_IN_PROGRESS，配 Retry-After，不能再执行。超出7天不得假设仍幂等，客户端应查询已知资源后决定新操作。

幂等不绕过当前会话和资源访问检查；读取原响应之前重新鉴权，避免已撤成员取回敏感支付参数。报价过期、下载令牌过期或网页登录证明消费后，旧key仅重放原结果，不续期；新请求用新key并重检。回调不使用客户端 Idempotency-Key，而以已验证 channel/account/eventId唯一约束。

文档、文件夹、元数据、偏好、配置草稿和合同列出的修订写入要求 `If-Match: "12"`；禁止 `*`。缺失428 CAS_REQUIRED，陈旧409 REVISION_CONFLICT及当前revision，不能把409改为无条件覆盖。读取返回ETag；写入事务比较当前revision、追加不可变内容、更新指针、写审计/Outbox。body中expectedRevision或baseRevision存在时必须与If-Match、候选基线一致。幂等重放成功在CAS重检前识别，但仍重检当前权限；新key面对旧CAS必须冲突。

revision是资源局部计数，不可互换：项目metadata与文档写都更新项目revision；账号偏好、目录、素材元数据与配置草稿各有独立revision；历史文档revision及原字节不覆写。失败重试或恢复历史都会产生新revision/新job，不改历史。

## 主要模块调用顺序

素材：签发uploads并原子预占物理配额→仅上传受限对象→complete→HEAD、长度/hash、magic、EXIF方向、解码及恶意内容检查→pending_scan/ready或rejected。原片只接受JPEG/PNG，≤25,000,000字节且≤80MP；不接受任意URL素材。只在本工作区去重；归一化图和预览独立存储。字体上传走单独的后台有许可暂存接口，字体解析隔离。暂存key只能由服务端分配，客户端不能传bucket/key。

目录：元数据组织，与对象locator分离；名称去首尾空白，NFC+casefold唯一，1–80 Unicode码点，无斜线/控制字符/`.`/`..`，深度≤10。move事务检查循环、同名、工作区与CAS。目录树删除/恢复、batch-move全有或全无；任一素材被相册引用则拒绝整树删除，不静默删片或部分成功。活动任务pin、法律保留及回收期后再物理清理；物理确认后才释放占用。basePrefix切换不重命名用户目录或旧locator。

文档：创建项目→读取自有document和manifest→PATCH typed commands→确认server revision才显示已保存。完整网页用replaceDocument保存任意受支持编辑操作；mini仅setText/setCrop/replaceAsset/reorderSpreads，且须在模板授权字段和服务端白名单内，不能通过clientPlatform伪装网页。未知同版本层原样保留，mini不得丢弃不认识字段；未知未来版本只读，阻断保存/导出。跨页1–50、照片≤500、每跨页递归层≤100、组深≤5。Schema之外验证重复ID、树循环、裁剪和比例、资源权属、不可变版本与预算。冲突只恢复草稿/用户明确重试，不自动覆盖或自动多人合并。

内容：场景统一wedding/travel/family/portrait/ink（国风），保留other作为扩展；项目创建、模板创建/响应和模板scene筛选使用同一枚举。Template.slots与TemplateVersionCreate.slots均为TemplateSlot数组，slotCount必须等于数组长度。每个slotId和(spreadId,layerId)唯一，递归定位的文档层必须真实存在且kind与image/text类型一致。图像必填槽bindingRequired=true，placeholderAssetId须等于对应image.assetId且已注册为有许可的不可变平台占位素材；ProjectCreate.templateBindings逐槽显式绑定ready且获授权的工作区assetId，slotId唯一且不得指向文字槽/未知槽；无templateVersionId时不能传非空bindings。项目实例化时必须替换为获授权工作区素材，否则TEMPLATE_BINDING_REQUIRED，不能把合成ID或任意URL当占位图。文字槽bindingRequired=false，mini字段只能text且为document.text.editableFields子集；图片mini字段只能crop/assetId，不能修改未授权层。content/template-seeds.json是原创槽位设计草稿，不是直接可提交的发布请求；先实例化完整DocumentModel图层、注册占位/示例素材与授权字体，再构建TemplateVersionCreate并审查发布。templates/fonts返回可见许可标记，不发永久公开对象URL。字体下载需授权和用途许可；不可嵌入不等于可无条件栅格商用。后台 staged upload→template/font version draft→许可证证据→publication，冻结字节/hash。退役限制新引用，历史记录不抹除；实际输出仍须按当前合法使用策略判断。SKU/预设通过类型化配置草稿创建版本并经publication/发布审批，不改历史订单版本。

排版：LayoutRequest.projectId必须等于路径项目；layoutSpec是唯一请求模型，photos中的尺寸/时间校验服务端素材，baseRevision必须存在且可读。规则排版不默认发照片到生图模型、不消耗生图点数；固定seed+算法/模板/素材版本可复现。必选/禁用/锁定、照片数量、重复与页数为硬约束，不能用总分抵消。无解422 LAYOUT_CONSTRAINT_UNSATISFIABLE，details包含冲突constraintIds。候选不修改当前文档；apply-layout需CAS及候选/当前baseRevision一致。

生图：v1收费图像协议仅接受textToImage/imageToImage；provider元数据中的textSuggestion仅为预留可声明能力，capabilities必须保持该独立能力unconfigured/disabled，直到专用文本输入/输出、报价/结算契约通过审查，不能套用imageCount/ratio表单。规则排版不依赖它。读取已验证预设/能力→提交完整GenerationInput获取5分钟quote→接受quote/inputHash→创建job并在同事务预占用户点数和平台采购账户预算/写outbox。imageToImage要求所选参考素材权利和传输同意；仅选中参考图传输，默认剥离GPS/原文件名，不传整个相册。每个收费child1张，批量逐一报价/结算，不提供含糊的部分成功账本。采购成本只在后台，用户报价只显示点数。quote冻结输入、route/model/preset/config/price/policy，接受后配置切换不改任务。

任务：Job.progress为0–100百分比，与SQL相同；所有job绑定workspaceId，平台任务使用服务端创建的platform工作区，个人隐私导出使用本人personal工作区。公开createWorkspace仍仅personal/studio。数据库是唯一事实源，Outbox/BullMQ只调度。queued→running→packaging→succeeded，失败/取消终态互斥；临时故障retry_wait，提交状态未知保持state=running、stage=confirming_upstream、providerSubmissionState=unknown。租约和递增fence保护结果发布，临时对象只有当前fence成功落库才成为Output。取消若先赢则迟到结果不能发布，成功若先赢返回既有成功。供应商submit超时必须按原providerRequestId查询，不能换模型/跨供应商重复收费提交；无查询能力不得启用异步收费功能。明确成功且审核/标识通过结算一次，明确失败释放一次；终局超时按冻结政策释放后，迟到结果不扣点、不发布。`jobs/retry`不接受需要再次收费的生图，返回NEW_QUOTE_REQUIRED，重新报价。

计费：服务端SKU版本决定价格/渠道/平台，客户端不传价格。渠道规范值统一为wechat_pay / wechat_virtual，配置、API和数据库相同。Order.fulfillmentState使用unfulfilled/fulfilled/reversed/manual_review，paid+unfulfilled表示待履约，不能丢弃退款后的reversed和人工核对manual_review。order→payment-attempt→渠道launch→验签回调或受控上游查询→支付事实/一次履约/追加账本；客户端支付成功永远不直接发权益。微信支付/虚拟支付按当前商户准入、终端规则和已验证SDK合同启用，未知组合422 CHANNEL_UNAVAILABLE，不伪造可用性。Refund.state严格使用requested/submitted/unknown/succeeded/failed/manual_review；审核approve后进入渠道提交，reject记录failed+REFUND_REJECTED和审计，不引入approved/rejected持久状态。退款核验已消费点数/来源批次和剩余权益，原子申请/审核/渠道执行/回收，不能制造负余额或重复退款。兑换码不进日志，哈希存储，事务锁防双花和maxUses竞争；错误统一避免枚举。

导出：revision+ExportOptions预检→明确确认全部acknowledgementRequired issue ID→export-jobs提交绑定token/hash→冻结文档/资源/许可/权益/renderer/config版本与pin→逐面渲染→私有产物。缺原片/字体/授权、文字溢出/缺字、未知schema/渲染层、预算超限阻断；PPI100–199警告、<100强警告需明确确认。单面≤50MP；600×300mm、300DPI、四边3mm出血为7157×3614px。JPEG需不透明底色；普通PDF为高分辨率栅格页，首期无PDF/X、CMYK、可搜索矢量文字。每个preflightToken绑定actor/workspace/project/revision/spec hash/manifest/renderer/policy且≤5分钟；有blocker不发token。导出事务再次校验权限、资源与预算；token不能绕过后来被撤销的合法权限。

下载/分享：每次签发前校验成员或有效share scope，短期私有URL≤300秒。分享只包含冻结output集合，不包含原片、项目编辑权、工作区成员权；口令模式必须设置口令hash，公开访问失败不暴露原因。撤销后不发新token，已签发直连URL可用到期，不能承诺即时撤销；需即时撤销时必须另接验证过的网关/边缘鉴权。通知仅本人/实际订阅同意，发送失败独立重试，不回滚任务/支付终态，接口不能指定任意收件人或自由消息内容。

## 配置发布、秘密与运维

21个schema kind对应配置中心20主题：storage、aiConnection、auth、payment、sku、editor、layout、export、queue、content、share、notification、retention、monitor、workspace、account、site、upload、aiRoute、aiPricing、albumDefaults（归入相册默认值主题）。`ConfigDraftCreate.category`必须与`value.kind`相同，更新不允许跨kind。客户端/工作区偏好不能提高额度、跳过审核或覆盖平台停用。无有效发布为unconfigured，不等于通过连接验证。

草稿→CAS编辑→结构/权限/依赖检查→impact→所需分层tests→publish，原子release pointer。测试level统一为schema（结构）、connection（网络/认证）、storage_roundtrip（对象写读删）、capability（模型契约）、sample（真实样图）。ConfigTest.state是明确投影：queued/running来自关联config_test job，passed/failed/cleanup_required来自不可变结果，expiresAt过期或hash/secret改变显示expired，不修改旧结果。测试绑定draft/configHash/secret版本，≤5分钟；任何修改立即失效。connection（网络/认证）不代表对象读写删或模型能推理；storage测试使用随机temporary key PUT→GET→hash→DELETE→确认，仅触及本次测试对象。sample（真实付费样图）需操作者显式预计成本上限确认，来自平台测试预算，不能默认用客户点数/原片。没有实际执行不能登记passed。

发布冻结原有任务/订单/对象locator，新请求使用新版本。回滚是复验秘密与依赖后重新发布旧组合，不能回滚账本/文件/运行任务。紧急停用只停新请求，合法查询、结算、删除按规则继续。运行中的provider query仍需原冻结秘密；正常revoke检查pin，紧急泄露撤销需审计并安全终结，不因此重发收费任务。

SecretCreate/Rotate的value为write-only，日志/APM/审计不采集；返回只有mask、版本、状态、验证时间。配置里的secretBinding仅为ref/version。无show-secret接口。端点主机必须部署批准HTTPS白名单；禁loopback/私网/link-local/metadata、DNS重绑定、重定向绕过、任意headers/脚本。只有已实现并测试的OSS/COS/S3或AI adapter可启用；“兼容”或“认证成功”不自动代表所有能力支持。

storage migration：plan估算范围/流量/成本和pin→显式成本上限confirm→逐对象复制→尺寸/SHA校验→CAS更新locator→保留旧副本/活动snapshot pin→引用核对→按retention清理。逐对象检查点重试；不能全局字符串替换路径；跨地域检查数据位置政策，旧profile仍有对象/pin时不能退役。basePrefix只改变新写入。

`/health/live`仅探针进程；`/health/ready`仅接收请求的基础依赖。实际capability就绪独立显示，不把某次检查当全站已验证。admin/operations/status返回脱敏监控；对账只能以渠道/账本/数据库事实和唯一operationId修复，不允许任意set-success。备份恢复演练只面向isolated_ephemeral目标，数据库/对象备份分别验证，重放删除标记；不可通过业务API部署生产或恢复覆盖生产。实际云账号、镜像摘要、商户资质、报警联系人与RPO/RTO由后续接入决策及演练确认。

## 回调原始字节与独立验证

路由：payment-callbacks/{channel}、refund-callbacks/{channel}、provider-callbacks/{adapterId}、notification-callbacks/{adapterId}。只接受服务端登记适配器和固定环境账户，未知channel/adapter404；不得根据body任意选择验证key。Content-Type application/json，body≤1MiB。OpenAPI给出微信支付加密信封和平台登记适配器标准信封；直接供应商若使用不同wire schema，必须先提交完整类型、验签/ACK/重放契约并审查后启用callback能力，否则采用query。不能把任意payload“兼容”作为已实现支持。

处理顺序是硬约束：

1. 保留原始HTTP实体字节与原始验签header，禁止JSON parse/restringify、更改空白、换行、解压后错误重建、代理header覆盖后再验签；部署层对签名相关header重复/歧义直接拒绝。若供应商签名规定压缩实体层，按其固定适配器合同选定字节层。
2. 按已登记channel/account/key版本解析必要timestamp/nonce/key-id/signature，校验已批准算法及轮换证书；微信支付使用Wechatpay-Timestamp/Nonce/Serial/Signature。时钟偏差默认±300秒，适配器协议更严格则取更严格；重放缓存不能替代数据库event唯一约束。其它适配器使用登记的X-Callback-*或明确供应商原header，禁止用户自定义。
3. 验证精确原始字节签名后，才解析和验证typed envelope；微信外层验签后才AES-GCM解密resource。验证事件类型与payload分支、商户/应用/采购账户、币种、金额、order/refund/providerRequest绑定及当前状态；不信任body自报的workspaceId/完成状态。
4. 事务记录不可变event摘要与UNIQUE(channel,account,eventId)，原子应用合法状态迁移/账本/Outbox。重复同事件返回既有ACK；相同eventId但内容hash不同触发安全告警，不覆盖。body、签名、完整提示词、原片、秘密不进普通日志；如需受限证据保留按隐私期限加密分离。
5. durable提交后才发供应商确定ACK。微信支付JSON `{code:"SUCCESS",message:"成功"}`；登记适配器可固定文本success。无匹配协议不返回通用成功。验签失败401/403；格式失败400；可恢复持久化故障500并依适配器触发重试；业务终态冲突记录核对，不能凭重复回调任意倒退状态。
6. 上游成功/取消竞争、重复回调、坏URL/大输出均走冻结job/fence和独立结算流程；结果URL仅服务端批准结果域名可抓取，重定向/字节/解码像素/hash再校验，quarantine→审核/标识→ready，客户端永不把上游URL当永久asset引用。

OpenAPI header参数因不同供应商头集合为OR而显示required:false；这不使签名可选。`x-independent-callback-verification.required:true`及登记适配器的完整必需header集合是必检条件，缺任何必需头即拒绝。IP白名单可加强防护，但不能代替验签。Cookie、MiniBearer、API管理员凭据都不能授权回调。

## 错误码与客户端决策

| HTTP | code | 客户端/服务端规则 |
|---|---|---|
| 400 | INVALID_REQUEST、INVALID_CURSOR | 修正参数/重开列表，不盲重试 |
| 401 | AUTH_EXPIRED、CALLBACK_SIGNATURE_INVALID | 重新登录；回调拒绝且不产生状态变更 |
| 403 | FORBIDDEN、LICENSE_RESTRICTED | 请求授权或更换合法资源，不重复提交 |
| 404 | NOT_FOUND | 不披露跨工作区资源是否存在 |
| 402 | CREDIT_INSUFFICIENT | 充值/更换工作区后重新报价，不预创建收费任务 |
| 409 | REVISION_CONFLICT、BINDING_CONFLICT、ASSET_IN_USE、FOLDER_NAME_CONFLICT | 刷新基线/展示冲突，不隐式覆盖/合并/部分删除 |
| 409 | IDEMPOTENCY_MISMATCH、IDEMPOTENCY_IN_PROGRESS | 前者停止并修正key使用；后者同key稍后查询/重放 |
| 409 | PAYMENT_PENDING、NEW_QUOTE_REQUIRED、INVALID_STATE | 查询权威事实；需要新报价时重新确认 |
| 410 | QUOTE_EXPIRED、RESOURCE_EXPIRED、QR_EXPIRED | 获取新报价/令牌；旧key不续期 |
| 413 | PAYLOAD_TOO_LARGE、EXPORT_PIXEL_LIMIT | 降低图片/页数/DPI后重新预检 |
| 422 | ASSET_NOT_READY、ASSET_MISSING、FONT_UNAVAILABLE、FONT_LICENSE_REQUIRED、TEXT_OVERFLOW、GLYPH_MISSING | 等待验证或替换资源；缺失不自动替图/替字体 |
| 422 | UNKNOWN_SCHEMA_VERSION、UNKNOWN_RENDER_LAYER、PRECHECK_BLOCKED | 升级/迁移或修复文档；不得跳过阻断 |
| 422 | LAYOUT_CONSTRAINT_UNSATISFIABLE | 展示constraintIds；用户调整硬约束 |
| 422 | CONTENT_REJECTED、CHANNEL_UNAVAILABLE、PARAMETER_UNSUPPORTED | 修改合法输入或使用已验证能力；不扣点/假装成功 |
| 428 | CAS_REQUIRED | 读取revision并提供If-Match |
| 429 | RATE_LIMITED、PROVIDER_RATE_LIMIT | 遵循Retry-After，保留幂等key，禁止重复收费submit |
| 503 | CAPABILITY_UNAVAILABLE、PROVIDER_TIMEOUT、BUDGET_EXHAUSTED | 展示disabled/unconfigured/degraded原因；未知submit状态先查询 |
| 500 | INTERNAL_ERROR | 展示requestId；先查询已知订单/任务/幂等结果，不无脑重新付款 |

任务error.code可包含CANCELLED（state=cancelled）、PROVIDER_TIMEOUT、CONTENT_REJECTED及上表业务错误；HTTP查询任务本身可200，任务业务终态通过data.state/error呈现。retryable只说明有安全恢复路径，不授权重新付费；客户端必须遵循该操作和provider状态规则。

## 研发验证边界

离线检查包括OpenAPI3.1语法、所有本地/外部$ref存在、operationId唯一、path参数匹配、typed request/response、每操作module/requirement/权限、示例schema和共享业务schema兼容。业务联调必须另验证：Cookie/CSRF与mini bearer、公开QR能力/nonce、跨租户404、CAS竞争、同key异payload、回调原字节/验签/重放/金额、账本一次结算、未知上游不重付、任务fence/取消竞争、字体版权/缺字、打印几何/像素、配置测试失效、迁移pin、备份删除标记及渠道准入。离线通过不能替代这些运行证据；本交付未调用任何真实付费服务或生产账户。
