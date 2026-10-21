# C4 配置发布、可靠任务、导出与商业账本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付原子配置发布、持久任务／云导出、真实服务端订单状态、会员／AI点数、兑换退款与对账运营闭环。

**Architecture:** PostgreSQL事务和Outbox是任务及商业事实源，BullMQ仅调度；租约与fence隔离迟到worker。订单、entitlement_grants、credit_lots及不可变ledger分离，支付回调／查单共用履约入口；配置release与权益／导出snapshot在接受任务时冻结。

**Tech Stack:** Node 24 LTS、TypeScript、pg、Redis／BullMQ、固定Playwright Chromium、C1 render-cli、React admin/web、Vitest；渠道adapter与密钥服务端口。

**Spec:** [会员支付设计](../../ai-album-v0.1/04-会员支付与授权设计.md)、[v0.3 §§6–7](../../design-v0.3/README.md)、[v0.4配置发布](../../configuration-v0.4/01-配置中心与权限.md)、[配置验收](../../configuration-v0.4/04-配置清单与验收.md)、[测试运维](../../ai-album-v0.1/05-测试与运维手册.md)。

## Global Constraints

- 本文是待执行研发计划；测试片段和预期结果均不是当前已通过记录。只写本模块实现；真实微信、存储、支付、AI集成缺凭据时保持 `unconfigured`，本地模拟／契约测试可完整实施。
- 继承 [共同合同](../../release-v1.0/CONTRACT-RULES.md)：公开ID为1–128字符不透明字符串；SHA-256为64位小写十六进制；金额为人民币分整数、点数整数，JSON整数上限9007199254740991；UTC存储，展示和预算日为Asia/Shanghai。
- API根 `/v1`；成功 `{data,requestId}`，失败 `{error:{code,message,retryable,details},requestId}`；列表 `{items,nextCursor,hasMore}`。网页cookie＋CSRF，小程序短期bearer；所有资源逐次校验工作区权限。
- 可重放创建／财务／任务操作使用空间范围唯一的 `Idempotency-Key`，保留7天；相同key不同payload返回409。文档If-Match revision为字符串；草稿／目录更新有expectedRevision／If-Match，冲突409。
- 唯一产品文档模型由C1 `@album/document`提供，对应 `document.schema.json`；schemaVersion1、px96、sRGB；1–50内页跨页、500照片、100递归图层／跨页、组深度≤5。原片JPEG／PNG≤25_000_000字节且≤80MP；不接受任意外部URL素材引用。
- 平台统一存储／AI连接，不开放BYOS／BYOK；免费与付费能力都实现，真实价格／配额未经确认不得伪造。影楼首期单使用者，预留owner/admin/designer/viewer与seat_limit，不做邀请UI；App仅预留共享API。
- 测试命令沿用C1 `npm run test:unit -- <file>`／`npm run test:browser -- <file>`、`npm run typecheck`。集成测试使用临时PostgreSQL／Redis和本地受控模拟，禁止生产数据库；精确依赖版本在实施时锁入package-lock.json，Node 24 LTS。
- 任务事实源PostgreSQL，Outbox＋BullMQ仅调度；取消与成功只能一个终态；租约／fence守卫所有结果与账本终结。重试建议3次，退避10／30／90秒；OOM不盲重试相同超预算任务。
- 配置draft→validated→published→retired；测试绑定配置hash＋secretVersion，5分钟有效。回滚产生新release，禁止复活已撤销密钥，已有订单／快照／账本不回滚。
- 导出DPI72／150／300、50MP／输出面，headless预算2GiB；PPI100–199警告，<100强警告需确认。600×300mm、300DPI、四边3mm出血→7157×3614px；普通PDF为sRGB栅格页。
- 首期无自动续费；期限SKU按duration_days（30／365天等）计算，同档start=max(now,current_end)。价格以经营者发布的真实SKU为准；未发布不显示虚构价。
- 支付回调重放100次仅发放一次；待支付5分钟仍未知进入查单，关单前先查询。网页微信支付与小程序虚拟权益支付独立adapter／准入capability，不默认复用wx.requestPayment。
- 点数报价不预占，接受任务原子预占，成功一次结算，明确失败／取消一次释放到原批次。状态未知建议30分钟终局，超时释放后迟到结果不再扣点／发布；退款冻结额度不得消费。

## Review Focus

- RF1：配置并发编辑、失效测试、旧密钥回滚和进程刷新失败不混用release或泄密；任务1有断言。
- RF2：Redis丢失、重复派发、worker失租、取消／成功竞态不能产生两个终态或可下载半成品；任务2／3有断言。
- RF3：回调100次、回调与查单并发、金额／应用被篡改只履约合法订单一次；任务4／5有断言。
- RF4：点数刚好够用、批次在预占期间到期、退款冻结和并发兑换不能负余额或错误恢复有效期；任务5／6／7有断言。
- RF5：排队时会员到期、退款迟到、已扣款本地关单和跨日对账不能抹去收款或重复补发；任务3／7／8有断言。

---

## 文件与合同边界

下列产品路径均为未来实施时创建／修改，当前不生成产品代码。API只实现 [OpenAPI](../../release-v1.0/contracts/openapi.yaml) 已定义操作与参数；DTO从合同生成到 `packages/contracts/src/api.ts`（C3任务1），不自行维护第二套HTTP字段。五个schema使用固定文件名与各自`$defs.root`。数据库执行 [001_initial.up.sql](../../release-v1.0/database/001_initial.up.sql) 与对应down迁移，并遵守 [transaction-safety.md](../../release-v1.0/database/transaction-safety.md)；发现合同和本计划有差异先修订合同并加反例，再实现。应用内部类型由本计划拥有它的任务定义并导出，测试数据在相应测试文件内构造，不依赖未定义的未来测试帮助函数。

## 文件与服务分工

`apps/api/src/config`拥有所有typed config草稿／发布与秘密引用；`packages/jobs`提供持久任务状态机，`apps/export-worker`只执行冻结快照。`payments`规范化渠道事件，`commerce`实现订单／权益／点数／兑换／退款／对账；共同事务使用C3 Database，不复制第二套账本。配置中心负责20个业务域的校验／权限／未配置能力；schema中的albumDefaults作为独立typed payload也必须覆盖。AI模型／预设内容和样图测试UI归C5，平台账本及发布机械归本模块。

### Task 1: 类型化配置中心、秘密轮换、原子release与能力

**Files:**
- Create: `apps/api/src/config/types.ts`
- Create: `apps/api/src/config/secrets.ts`
- Create: `apps/api/src/config/network-policy.ts`
- Create: `apps/api/src/config/service.ts`
- Create: `apps/api/src/config/capabilities.ts`
- Create: `apps/api/src/config/config.test.ts`

**Interfaces:**
- Consumes: C3 `Database`／`Actor`／`runIdempotent`；config.schema.json全部root种类；001_initial.up.sql配置实体。
- Produces: `ConfigPayload`为config.schema.json root生成的判别联合；`ConfigVersion={id:string,namespace:string,version:number,environment:"dev"|"staging"|"prod",payload:ConfigPayload,revision:number,state:"draft"|"validated"|"published"|"retired",payloadHash:string}`；`ConfigRelease={releaseId:string,versionIds:string[],versions:Readonly<Record<string,ConfigVersion>>,effectiveAt:string}`（内部有效配置快照，HTTP只投影生成ConfigRelease DTO字段）；`SecretPort={write(name:string,value:Uint8Array):Promise<{secretRef:string,secretVersion:string}>,read(ref:string,version:string):Promise<Uint8Array>,isRevoked(ref:string,version:string):Promise<boolean>}`；`createConfigDraft(actor:Actor,namespace:string,payload:ConfigPayload,baseVersion:number|null):Promise<ConfigVersion>`、`updateConfigDraft(actor:Actor,id:string,expectedRevision:number,payload:ConfigPayload):Promise<ConfigVersion>`、`publishConfig(actor:Actor,versionIds:string[],testIds:string[],reason:string,expectedCurrentRelease:string|null):Promise<ConfigRelease>`、`rollbackConfig(actor:Actor,releaseId:string,expectedCurrentRelease:string,reason:string):Promise<ConfigRelease>`、`loadRelease(releaseId?:string):Promise<Readonly<ConfigRelease>>`；`assertApprovedHttps(url:string,allowedHosts:string[]):Promise<void>`；`fetchApprovedHttps(url:string,init:RequestInit,allowedHosts:string[],limits:{maxBytes:number,timeoutMs:number}):Promise<Uint8Array>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(concurrentDraftWrites.filter(r=>r.status===200)).toHaveLength(1);
await expect(publishConfig(ops,versions,[expiredTestId],reason,current)).rejects.toThrow('CONFIG_TEST_EXPIRED');
await expect(rollbackConfig(ops,oldRelease,current,reason)).rejects.toThrow('SECRET_REVOKED');
expect(snapshotAfterRefreshFailure.releaseId).toBe(previousRelease.releaseId);
expect(JSON.stringify(publicCapabilities)).not.toContain('secretRef');
await expect(assertApprovedHttps('https://127.0.0.1/model',['provider.example'])).rejects.toThrow('ENDPOINT_FORBIDDEN');
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/config/config.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在所列文件实现签名。每种payload注册schema、命名空间角色、秘密字段、依赖／有效版本、默认禁用、功能测试级别、审计与snapshot影响，不只做通用JSON表单。平台运维／财务／内容分权，发布需重新验证会话；secret只写新版本／返回掩码，日志不记明文。network-policy.ts实现两个网络签名：DNS解析、IPv4/6私网／loopback／link-local／metadata、逐跳重定向都验证，fetchApprovedHttps用固定已验证地址的连接lookup/SNI校验封住DNS重绑定窗口，不是校验完再任意fetch；生产只允许部署批准HTTPS主机，本地模拟隔离。发布事务验证5分钟内测试绑定hash／secretVersion、依赖和未撤销状态后CAS切指针，worker一次加载完整release失败沿用旧版告警。回滚重新验证并生成新release，不回滚账本。能力仅available/disabled/unconfigured/degraded与通用原因；支持紧急停新请求而保留查询／终结。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/config/config.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。遍历全部schema root kind验证注册覆盖，含albumDefaults；模拟本地对象PUT/GET/hash/DELETE测试的删除残留明确告警，不删既有key。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/config/types.ts apps/api/src/config/secrets.ts apps/api/src/config/network-policy.ts apps/api/src/config/service.ts apps/api/src/config/capabilities.ts apps/api/src/config/config.test.ts`；`git commit -m "feat(config): publish validated releases with secret-safe capabilities"`。

### Task 2: 数据库事实源、Outbox、租约fence与取消

**Files:**
- Create: `packages/jobs/package.json`
- Create: `packages/jobs/src/types.ts`
- Create: `packages/jobs/src/repository.ts`
- Create: `packages/jobs/src/outbox.ts`
- Create: `packages/jobs/src/index.ts`
- Create: `packages/jobs/src/jobs.test.ts`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: C3 `Database`与幂等事务；任务1 ConfigRelease；SQL jobs/job_attempts/outbox。
- Produces: `JobState="queued"|"running"|"packaging"|"retry_wait"|"cancel_requested"|"succeeded"|"failed"|"cancelled"`；`JobRecord={jobId:string,workspaceId:string,kind:"export"|"generation"|"layout"|"storage_migration"|"privacy_export"|"config_test"|"reconciliation"|"backup_restore_drill",state:JobState,configReleaseId:string,attempt:number,fence:number,cancelRequested:boolean,providerSubmissionState:"not_submitted"|"submitting"|"accepted"|"unknown"|"terminal",stage:string}`；`JobLease={job:JobRecord,leaseOwner:string,fence:number,expiresAt:string}`；`createJob(tx:PoolClient,input:{workspaceId:string,kind:JobRecord["kind"],configReleaseId:string,inputHash:string,payload:unknown},key:string):Promise<JobRecord>`、`claimJob(jobId:string,workerId:string,now:string):Promise<JobLease|null>`、`renewLease(lease:JobLease,now:string):Promise<JobLease>`、`finishJob(lease:JobLease,outcome:{state:"succeeded"|"failed"|"cancelled",result:unknown}):Promise<boolean>`、`requestCancel(actor:Actor,wid:string,jobId:string):Promise<JobRecord>`、`dispatchOutbox(limit:number):Promise<number>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(await dispatchOutbox(100)).toBeGreaterThanOrEqual(1); // rebuild Redis solely from DB
expect(await finishJob(staleLease,{state:'succeeded',result:artifact})).toBe(false);
expect(terminalTransitionsForJob).toHaveLength(1);
expect(uniqueJobsForSameKey).toHaveLength(1);
expect(otherWorkspaceFirstDispatchIndex).toBeLessThan(hugeWorkspaceAllJobs.length);
expect(await claimJob(cancelledJobId,workerId,now)).toBeNull();
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- packages/jobs/src/jobs.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在`repository.ts`实现任务／租约函数；API与SQL同用queued/running/packaging/retry_wait/cancel_requested/succeeded/failed/cancelled；未知上游使用state=running、providerSubmissionState=unknown、stage=confirming_upstream，不能发明独立持久态；接口JobRecord.jobId映射HTTP Job.id。`outbox.ts`实现派发；PG行锁／条件更新校验当前fence+未终态，续租有界且失租即停止写结果。取消queued原子终局，running标请求并由同一终局CAS决定赢家；结果对象上传完成也不能绕过fence。Outbox至少一次投递，唯一jobId和调度去重，Redis重建扫描未终态PG记录，不依赖队列历史。全局／工作区并发取部署／发布配置／权益最严值，轮转工作区公平调度；10/30/90秒最多3次仅对可重试明确错误，未知付费提交保持running＋providerSubmissionState=unknown＋stage=confirming_upstream而非重提。attempt记录脱敏原因、心跳和队列延迟，OOM标资源失败建议降规格／拆分。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- packages/jobs/src/jobs.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add packages/jobs/package.json packages/jobs/src/types.ts packages/jobs/src/repository.ts packages/jobs/src/outbox.ts packages/jobs/src/index.ts packages/jobs/src/jobs.test.ts package-lock.json`；`git commit -m "feat(jobs): add durable fenced jobs and replayable outbox"`。

### Task 3: 服务端导出快照、冻结权益与私有产物

**Files:**
- Create: `apps/api/src/exports/service.ts`
- Create: `apps/export-worker/package.json`
- Create: `apps/export-worker/src/main.ts`
- Create: `apps/export-worker/src/render-job.ts`
- Create: `apps/export-worker/src/export.test.ts`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: C1 `freezeSnapshot`／`preflight`／`authorizeExport`／render:snapshot CLI；C3 ResourcePort／ObjectStore／授权；任务1 loadRelease、任务2 JobLease／createJob；任务5 `getEntitlements`（本项执行顺序在任务5核心接口就绪后接入，先用显式EntitlementPort）。
- Produces: `EntitlementPort={getEntitlements(workspaceId:string,at:string):Promise<EntitlementSnapshot>}`；`EntitlementSnapshot={workspaceId:string,at:string,grantIds:string[],maxDpi:72|150|300,maxConcurrentExports:number,brandWatermark:boolean,storageLimitBytes:number}`；`acceptExport(actor:Actor,wid:string,input:{projectId:string,revision:number,options:ExportOptions,snapshotHash:string,acknowledgedWarningIds:string[]},key:string):Promise<JobRecord>`；`renderExportJob(lease:JobLease,signal:AbortSignal):Promise<void>`；`authorizeArtifactDownload(actor:Actor,wid:string,artifactId:string):Promise<{url:string,expiresAt:string}>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(artifact.revision).toBe(12); // save13 while12 queued
await renderExportJob(leaseAcceptedBeforeExpiry,signal);
expect(jobAfterWorker.state).toBe('succeeded');
expect(renderedSize).toEqual({width:7157,height:3614});
expect(artifactVisibleAfterLostFence).toBe(false);
expect(artifactVisibleAfterCancel).toBe(false);
await expect(acceptExport(actor,wid,staleWarningAck,key)).rejects.toThrow('PREFLIGHT_STALE');
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/export-worker/src/export.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在`exports/service.ts`定义EntitlementPort/Snapshot并实现acceptExport／download；在`render-job.ts`实现renderExportJob。接受时重新鉴权／原图可读／预检hash与逐项警告确认，事务冻结saved revision+manifest+configReleaseId+entitlement_snapshot+资源locator pins并建job/outbox；权益检查只限提交，排队期间到期不撤销快照。worker使用C1固定Chromium CLI，单面顺序处理、2GiB和50MP硬限，不允许外部HTTP／任意路径；真实PNG/JPG/PDF校验实际像素／DPI／页序后私有上传，fence成功后才公开artifact记录。取消／失败清临时对象，pins至可安全终结后释放；7天保留期到期不删除原片，下载URL过期重新鉴权签发。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/export-worker/src/export.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。同时执行C1程序化样片校验；不能以mock证明7157×3614，需从真实产物重新解码。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/exports/service.ts apps/export-worker/package.json apps/export-worker/src/main.ts apps/export-worker/src/render-job.ts apps/export-worker/src/export.test.ts package-lock.json`；`git commit -m "feat(exports): render immutable entitled snapshots in durable workers"`。

### Task 4: 独立支付渠道adapter、订单与幂等收款确认

**Files:**
- Create: `apps/api/src/payments/types.ts`
- Create: `apps/api/src/payments/adapters.ts`
- Create: `apps/api/src/payments/orders.ts`
- Create: `apps/api/src/payments/confirm.ts`
- Create: `apps/api/src/payments/payments.test.ts`

**Interfaces:**
- Consumes: C3 Actor／授权／Database，任务1已发布SKU／payment配置，SQL orders/payment_attempts/payment_events；任务5 `fulfillOrder(tx,orderId)`事务函数。
- Produces: `PaymentEvent={channel:"wechat_pay"|"wechat_virtual",eventId:string,transactionId:string,orderId:string,appId:string,merchantId:string,amountFen:number,currency:"CNY",state:"paid"|"closed"|"refunded",fulfillable:boolean}`；`PaymentAdapter={createPayment(orderId:string):Promise<{clientPayload:unknown}>,verifyEvent(rawBody:Uint8Array,headers:Record<string,string>):Promise<PaymentEvent>,query(orderId:string):Promise<PaymentEvent>,refund(orderId:string,refundId:string,amountFen:number):Promise<{providerRefundId:string,state:"submitted"|"succeeded"|"unknown"}>,normalizeStatus(raw:unknown):PaymentEvent}`；`createOrder(actor:Actor,wid:string,skuVersionId:string,channel:PaymentEvent["channel"],key:string):Promise<{orderId:string,amountFen:number,clientPayload:unknown}>`；`confirmPayment(event:PaymentEvent):Promise<{accepted:boolean,fulfillmentState:string}>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(grantsAfter100Callbacks).toHaveLength(1);
expect(fulfillmentsAfterConcurrentQueryAndCallback).toHaveLength(1);
await expect(confirmPayment({...paidEvent,amountFen:paidEvent.amountFen-1})).rejects.toThrow('PAYMENT_MISMATCH');
await expect(confirmPayment({...paidEvent,appId:'wrong-app'})).rejects.toThrow('PAYMENT_MISMATCH');
expect(orderAfterClientSuccessOnly.state).toBe('pending');
expect(miniUnavailable.clientPayload).toBeUndefined();
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/payments/payments.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在types.ts定义PaymentEvent/Adapter，adapters.ts实现本地签名模拟与实际已批准渠道；orders.ts实现createOrder，confirm.ts实现confirmPayment。服务端读取SKU不可变价／期限／权益／退款规则和渠道商品映射，不信客户端金额；mini数字权益按真实虚拟支付权限、OS／版本capability独立启用，不伪造微信支付资格。验签在原始body上完成，校验商户／应用／商品／金额／币种／业务号，支付event和transaction双唯一；回调／查询共用加锁确认和履约事务。订单规范态pending/paid/closed/refund_pending/partially_refunded/refunded，fulfillmentState仅unfulfilled/fulfilled/reversed/manual_review；等待履约用paid＋unfulfilled，不持久化fulfilling。渠道若要求同步发货应答，必须履约提交后按官方合同ACK，不能通用先ACK；client success仅触发查单。5分钟未知进入查单队列，关单前查询，已扣款本地关单转异常补偿保留收款事实。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/payments/payments.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/payments/types.ts apps/api/src/payments/adapters.ts apps/api/src/payments/orders.ts apps/api/src/payments/confirm.ts apps/api/src/payments/payments.test.ts`；`git commit -m "feat(payments): confirm channel payments through idempotent orders"`。

### Task 5: 会员grants、批次点数与原子预占结算

**Files:**
- Create: `apps/api/src/commerce/entitlements.ts`
- Create: `apps/api/src/commerce/credits.ts`
- Create: `apps/api/src/commerce/fulfillment.ts`
- Create: `apps/api/src/commerce/credits.test.ts`

**Interfaces:**
- Consumes: 任务3 EntitlementSnapshot／EntitlementPort、C3 QuotaPolicyPort；任务4订单／PaymentEvent；SQL entitlement_grants/credit_lots/credit_reservations/credit_ledger。
- Produces: `getEntitlements(workspaceId:string,at:string):Promise<EntitlementSnapshot>`；`readQuota(workspaceId:string):Promise<{limitBytes:number,maxProjectPhotos:number}>`；`fulfillOrder(tx:PoolClient,orderId:string):Promise<void>`；`CreditReservation={reservationId:string,workspaceId:string,jobId:string,points:number,state:"reserved"|"settled"|"released"}`；`reserveCredits(tx:PoolClient,wid:string,jobId:string,points:number):Promise<CreditReservation>`、`settleCredits(tx:PoolClient,reservationId:string,eventId:string):Promise<void>`、`releaseCredits(tx:PoolClient,reservationId:string,eventId:string):Promise<void>`；`creditBalance(wid:string,at:string):Promise<{available:number,reserved:number,frozen:number,expired:number}>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(acceptedExactlyEnoughRequests).toHaveLength(1);
expect(await creditBalance(wid,now)).toMatchObject({available:0,reserved:quotedPoints});
expect(settlementEntriesForRepeatedSuccess).toHaveLength(1);
expect(releaseTargetLotId).toBe(originalLotId);
expect(releasedExpiredLot.expiresAt).toBe(originalExpiry); // no extension
expect(nextSameTierGrant.startsAt).toBe(previousGrant.endsAt);
expect(otherGrantAfterRefund.revokedAt).toBeNull();
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/commerce/credits.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在entitlements.ts实现getEntitlements/readQuota并适配C3／导出端口；在fulfillment.ts实现fulfillOrder，以source_order＋grant_type唯一创建会员grant／赠点／购买lot，不直接覆盖用户会员标签。免费权益来自有效free配置，付费只按未撤销grants当前时间计算，不依赖定时任务。相同档续购start=max(now,current_end)，按duration_days真实天数；首期跨档购买禁用或受审计人工处理，不隐式折算。credits.ts定义Reservation并实现四函数，按到期时间／lot ID稳定顺序锁批次，非负约束、reserved/frozen隔离；预占／结算／释放／过期均追加流水。同reservation内部重试不再预占，结算和释放终局CAS只能一次；失败回原lot不延有效期，特殊补偿新建lot并关联工单。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/commerce/credits.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/commerce/entitlements.ts apps/api/src/commerce/credits.ts apps/api/src/commerce/fulfillment.ts apps/api/src/commerce/credits.test.ts`；`git commit -m "feat(commerce): grant memberships and maintain atomic credit lots"`。

### Task 6: 高熵兑换批次、限速与唯一权益来源

**Files:**
- Create: `apps/api/src/commerce/redemption.ts`
- Create: `apps/api/src/commerce/redemption.test.ts`

**Interfaces:**
- Consumes: C3授权／幂等；任务5 fulfillOrder所用同一grant/lot发放事务语义，任务1 SKU版本；SQL redemption_batches/codes/redemptions。
- Produces: `RedemptionBatchInput={skuVersionId:string,startsAt:string,expiresAt:string,count:number,maxUsesPerCode:number,workspaceKinds:Array<"personal"|"studio">,distributionChannel:string}`；`createRedemptionBatch(actor:Actor,input:RedemptionBatchInput,reason:string):Promise<{batchId:string,oneTimeCodes:string[]}>`；`redeemCode(actor:Actor,wid:string,rawCode:string,key:string):Promise<{redemptionId:string,grantIds:string[]}>`；`disableRedemptionBatch(actor:Actor,batchId:string,reason:string):Promise<void>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(successfulConcurrentRedemptions).toHaveLength(1);
expect(await redeemCode(actor,wid,code,sameKey)).toEqual(firstRedemption);
expect(rawCodeInDatabaseOrLogs).toBe(false);
expect(genericErrorForUsedByOther).toBe(genericErrorForUnknownCode);
expect(previouslyGrantedEntitlementsAfterDisable).toEqual(entitlementsBeforeDisable);
await expect(redeemCode(viewer,wid,code,key)).rejects.toThrow('FORBIDDEN');
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/commerce/redemption.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在redemption.ts实现三签名，使用crypto随机至少128bit不可枚举code，数据库只存带服务端pepper的不可逆hash，原码仅生成时受控导出一次，日志只掩码。首期每码maxUses=1，未来上限仍事务计数；锁code检查状态／时效／工作区种类，redemption唯一来源调用同一发放语义而非创建假支付订单。按用户／IP／设备信号限速且错误通用。批次停用只阻止新兑换，不撤销既有grant；追回单独受审计工单，角色／理由／操作摘要必须记录。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/commerce/redemption.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/commerce/redemption.ts apps/api/src/commerce/redemption.test.ts`；`git commit -m "feat(redemption): issue hashed codes with atomic entitlement claims"`。

### Task 7: 退款冻结、渠道回执与订单来源撤销

**Files:**
- Create: `apps/api/src/commerce/refunds.ts`
- Create: `apps/api/src/commerce/refunds.test.ts`

**Interfaces:**
- Consumes: 任务4 PaymentAdapter／规范事件；任务5 reservation／credit_lot／grants；任务2取消API。
- Produces: `RefundState="requested"|"submitted"|"unknown"|"succeeded"|"failed"|"manual_review"`；`requestRefund(actor:Actor,wid:string,orderId:string,reason:string,key:string):Promise<{refundId:string,state:RefundState}>`；`processRefund(refundId:string,adapter:PaymentAdapter):Promise<RefundState>`；`confirmRefund(event:PaymentEvent,refundId:string):Promise<RefundState>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(balanceDuringRefund.frozen).toBe(refundablePoints);
await expect(reserveCredits(tx,wid,newJobId,refundablePoints)).rejects.toThrow('INSUFFICIENT_CREDITS');
expect(revokedGrantIds).toEqual([grantFromRefundedOrder]);
expect(orderAfterRefund.paidAmountFen).toBe(originalPaidAmountFen);
expect(orderAfterRefund.refundedAmountFen).toBe(confirmedRefundAmountFen);
expect(forcedRefundAfterConsumption).toMatchObject({state:'manual_review',negativeBalance:false});
expect(refundEntriesAfterDuplicateCallback).toHaveLength(1);
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/commerce/refunds.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在refunds.ts定义RefundState并实现三签名；API／SQL统一requested/submitted/unknown/succeeded/failed/manual_review；客户端以中文标签展示，不增加另一套业务状态。按购买时冻结退款政策受理，首期自动规则仅未消耗点数包／未使用会员权益；其他进入人工且不覆盖消费者／渠道强制退款要求。事务冻结来源order的未消耗lot／grant，活动预占任务先按规则取消或结算，不能挪其他订单余额。调用refund使用稳定refundId；未知回执查询原退款，不重复调用制造二次退款。确认退款保留付款历史与累计金额，撤销只限来源grant、未耗lot；强制退款但已消费记录平台财务损失／复核，余额不改负数。退款失败按终局释放冻结，迟到成功仍走唯一事件与审计；注销账户受限保留处理，不丢订单事实。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/commerce/refunds.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/commerce/refunds.ts apps/api/src/commerce/refunds.test.ts`；`git commit -m "feat(refunds): freeze and reverse source entitlements safely"`。

### Task 8: 商业UI、任务中心、管理对账与差异复核

**Files:**
- Create: `apps/web/src/commerce/MembershipPage.tsx`
- Create: `apps/web/src/commerce/OrderPage.tsx`
- Create: `apps/web/src/jobs/TaskCenter.tsx`
- Create: `apps/admin/src/commerce/CommerceConsole.tsx`
- Create: `apps/api/src/commerce/reconciliation.ts`
- Create: `apps/api/src/commerce/reconciliation.test.ts`
- Create: `tests/browser/commerce.spec.ts`

**Interfaces:**
- Consumes: 任务1–7服务、C3当前工作区／用户；渠道只读账单adapter。
- Produces: `StatementLine={channel:string,transactionId:string,orderId:string,paidFen:number,refundedFen:number}`；`reconcileStatement(businessDate:string,lines:StatementLine[]):Promise<{matched:number,reviewIds:string[]}>`；`MembershipPage(props:{workspaceId:string}):React.JSX.Element`；`TaskCenter(props:{workspaceId:string}):React.JSX.Element`；`CommerceConsole():React.JSX.Element`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(report.reviewIds).toHaveLength(1); // provider paid, local closed
expect(grantCountAfterRepeatedReconciliation).toBe(grantCountBeforeReconciliation);
expect(financeViewerCanSeeRawPhoto).toBe(false);
expect(visiblePriceWithoutPublishedSku).toBeNull();
expect(frontendSuccessWithoutConfirmation).toBe('待确认');
expect(manualAdjustmentAudit).toMatchObject({reason:'工单复核',ticketId:expect.any(String)});
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/commerce/reconciliation.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在reconciliation.ts实现reconcileStatement，以Asia/Shanghai businessDate核对渠道收款／退款和本地履约，每日差异建唯一复核记录，禁止靠重复补发修正。MembershipPage显示免费／个人／影楼／点数包真实已发布价格、天数、范围、工作区、点数有效期／退款规则；未配价显示未上架，未开通mini渠道不出可用购买按钮。OrderPage查询服务端状态、订单／退款／兑换记录，TaskCenter显示排队／处理／打包／确认中／完成／失败／取消与jobId、可追溯重试，不伪装浏览器任务。CommerceConsole含SKU版本、兑换批次受控下载、订单查询、差异复核、额度／会员人工调整；财务修改要角色、理由、工单、前后摘要，退款／返还双人复核策略可配置，客服不看密钥／支付token／原片。任务进度和通知共享outbox事实。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/commerce/reconciliation.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。另运行`npm run test:browser -- tests/browser/commerce.spec.ts`，预期PASS；用模拟签名渠道走购买→回调100次→会员→导出→退款→对账的真实本地数据库闭环；真实商户联调独立待接入。
- [ ] **Step 5: 限定提交。** `git add apps/web/src/commerce/MembershipPage.tsx apps/web/src/commerce/OrderPage.tsx apps/web/src/jobs/TaskCenter.tsx apps/admin/src/commerce/CommerceConsole.tsx apps/api/src/commerce/reconciliation.ts apps/api/src/commerce/reconciliation.test.ts tests/browser/commerce.spec.ts`；`git commit -m "feat(commerce): expose truthful purchases tasks and reconciliation"`。

## 自审与执行交接

8项覆盖CFG-CENTER/BILLING/EXPORT/OPS及所有配置注册、EXP-01/02、PAY-01、LIC-01、SHARE下载产物、ADM-01财务权限与账本。RF1→1、RF2→2/3、RF3→4/5、RF4→5/6/7、RF5→3/7/8均有明确断言。每任务拥有五个步骤；任务3使用本项EntitlementPort解耦任务5，任务4与5的收款／发放在同一数据库事务调用，实施可先完成5的独立账本签名再连4，不引入第二账本。C5报价／预算只能调用reserve/settle/release而不能直接改余额。所有DTO引用OpenAPI，JobState／Order／Refund／channel与SQL使用上述同一规范枚举，progress对外0–100。

当前覆盖缺口：无首期功能缺项。价格／资质／渠道ACK／退款政策要经营者接入时核验，当前可以用标明测试SKU与本地签名渠道完成状态机和竞态；不能给测试SKU伪造对外价格。部署备份恢复／告警属于上线手册与OPS合同，本模块实现其监控数据与可恢复事实源；真实生产上线另外验收。本轮只编写计划，不执行支付／付费供应商请求。
