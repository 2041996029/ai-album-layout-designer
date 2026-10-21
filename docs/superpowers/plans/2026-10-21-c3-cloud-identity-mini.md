# C3 统一身份、私有素材、云revision与小程序成册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付网页与微信小程序统一身份、工作区权限、私有云素材／文件夹、跨端保存、分享通知和小程序快速成册闭环。

**Architecture:** NestJS模块化API使用FastifyAdapter承载HTTP，PostgreSQL作为身份、权限和revision事实源；存储对象与素材ID／目录解耦。两端调用同一合同，mini仅发白名单patch，云仓库适配C1端口；集成服务通过可替换适配器实现且默认禁用未验证能力。

**Tech Stack:** Node 24 LTS、TypeScript、NestJS＋FastifyAdapter、pg、OpenAPI类型生成、Vitest、Playwright；原生微信小程序TypeScript与wx APIs；私有OSS/COS/S3按实际已实现适配器启用。

**Spec:** [v0.3 §8](../../design-v0.3/README.md)、[账号与权益](../../ai-album-v0.1/04-会员支付与授权设计.md)、[v0.4配置](../../configuration-v0.4/01-配置中心与权限.md)、[存储与文件夹](../../configuration-v0.4/02-云存储与自定义文件夹.md)、[API合同](../../release-v1.0/contracts/openapi.yaml)。

## Global Constraints

- 本文是待执行研发计划；测试片段和预期结果均不是当前已通过记录。只写本模块实现；真实微信、存储、支付、AI集成缺凭据时保持 `unconfigured`，本地模拟／契约测试可完整实施。
- 继承 [共同合同](../../release-v1.0/CONTRACT-RULES.md)：公开ID为1–128字符不透明字符串；SHA-256为64位小写十六进制；金额为人民币分整数、点数整数，JSON整数上限9007199254740991；UTC存储，展示和预算日为Asia/Shanghai。
- API导出格式枚举固定为`png`／`jpeg`／`pdf`，产物容器可为`zip`；`.jpg`只作为文件扩展名或用户文案，不能用作API格式枚举。
- API根 `/v1`；成功 `{data,requestId}`，失败 `{error:{code,message,retryable,details},requestId}`；列表 `{items,nextCursor,hasMore}`。网页cookie＋CSRF，小程序短期bearer；所有资源逐次校验工作区权限。
- 可重放创建／财务／任务操作使用空间范围唯一的 `Idempotency-Key`，保留7天；相同key不同payload返回409。文档If-Match revision为字符串；草稿／目录更新有expectedRevision／If-Match，冲突409。
- 唯一产品文档模型由C1 `@album/document`提供，对应 `document.schema.json`；schemaVersion1、px96、sRGB；1–50内页跨页、500照片、100递归图层／跨页、组深度≤5。原片JPEG／PNG≤25_000_000字节且≤80MP；不接受任意外部URL素材引用。
- 平台统一存储／AI连接，不开放BYOS／BYOK；免费与付费能力都实现，真实价格／配额未经确认不得伪造。影楼首期单使用者，预留owner/admin/designer/viewer与seat_limit，不做邀请UI；App仅预留共享API。
- 测试命令沿用C1 `npm run test:unit -- <file>`／`npm run test:browser -- <file>`、`npm run typecheck`。集成测试使用临时PostgreSQL／Redis和本地受控模拟，禁止生产数据库；精确依赖版本在实施时锁入package-lock.json，Node 24 LTS。
- 微信身份键为provider＋app_id＋openid；只在同开放平台可信来源的UnionID关联，不因手机号／昵称相同合并资产或订单。无UnionID仍可登录。
- 环境固定dev/staging/prod，由部署注入，不接受业务请求切换env。正式凭据仅秘密引用，平台管理员不自动获得用户原片权限；短信备用只在已开通且验证的配置下启用。
- 文件夹名称1–80个Unicode码点、NFC＋大小写折叠、最多10级；禁止`/`、`\`、控制字符、`.`、`..`；basePrefix为1–256字符相对前缀，keyPatternVersion=v1，publicAccess=false。
- 上传／下载凭据默认900／300秒，正整数≤3600；回收期建议30天，导出产物7天、未完成上传临时对象24小时，但不清理活动pin；所有期限来自已发布政策。
- 云保存至少最近20个恢复revision；自动保存空闲2秒／连续最多10秒沿用C1；小程序不提供自由移动图层／加形状／完整网页编辑器。

## Review Focus

- RF1：OpenID复用到不同app、UnionID缺失、手机相同和扫码重放不得误合并账号；任务1有断言。
- RF2：跨工作区ID混用、角色刚被撤销、普通管理员读取原片须拒绝；任务2／3有断言。
- RF3：并发预占、伪造图片、prefix改名和迁移校验失败不越配额或断旧资源；任务3／4有断言。
- RF4：离线双端提交、mini未知层字段、迟到保存响应不得静默覆盖或丢草稿；任务5／6／8有断言。
- RF5：分享撤销、签名URL存续、注销和通知重放不能继续新授权或重复发消息；任务1／7有断言。

---

## 文件与合同边界

下列产品路径均为未来实施时创建／修改，当前不生成产品代码。API只实现 [OpenAPI](../../release-v1.0/contracts/openapi.yaml) 已定义操作与参数；DTO从合同生成到 `packages/contracts/src/api.ts`（C3任务1），不自行维护第二套HTTP字段。五个schema使用固定文件名与各自`$defs.root`。数据库执行 [001_initial.up.sql](../../release-v1.0/database/001_initial.up.sql) 与对应down迁移，并遵守 [transaction-safety.md](../../release-v1.0/database/transaction-safety.md)；发现合同和本计划有差异先修订合同并加反例，再实现。应用内部类型由本计划拥有它的任务定义并导出，测试数据在相应测试文件内构造，不依赖未定义的未来测试帮助函数。

## 文件与端口分工

`apps/api/src/auth`拥有身份／会话与注销；`workspaces`是逐请求授权边界；`assets`拥有上传／对象locator；`folders`只管理逻辑目录；`projects`拥有CAS与mini白名单；`sharing`／`notifications`管理外发授权。`packages/server-core`只提供数据库事务、幂等记录与时钟，禁止放入会员或供应商逻辑。C4权益通过本模块定义的只读QuotaPolicyPort注入，首期本地策略也必须有真实边界；不依赖尚未实现的会员函数。

### Task 1: 合同驱动API、微信身份、绑定与注销

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/api.ts`
- Create: `scripts/generate-api-types.ts`
- Create: `packages/server-core/package.json`
- Create: `packages/server-core/src/database.ts`
- Create: `packages/server-core/src/idempotency.ts`
- Create: `packages/server-core/src/index.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/auth/types.ts`
- Create: `apps/api/src/auth/identity.ts`
- Create: `apps/api/src/auth/sessions.ts`
- Create: `apps/api/src/auth/account-deletion.ts`
- Create: `apps/api/src/auth/privacy-export.ts`
- Create: `apps/api/src/auth/auth.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/server-core/src/actor.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/controller.ts`
- Create: `apps/api/src/http/contract-http.ts`

**Interfaces:**
- Consumes: OpenAPI及database/001_initial.up.sql；部署注入的dev/staging/prod和秘密适配器。
- Produces: `Database={transaction<T>(work:(tx:PoolClient)=>Promise<T>):Promise<T>}`；`Actor={userId:string,sessionId:string,client:"web"|"mini",platformPermissions:string[]}`（由server-core/actor.ts定义并在auth/types.ts re-export，避免共享jobs反向依赖API）；`VerifiedIdentity={provider:"wechat"|"sms",appId:string,subject:string,unionId:string|null,openPlatformId:string|null}`；`IdentityAdapter={exchange(code:string,redirectUri:string|null):Promise<VerifiedIdentity>}`；`AuthService.login(adapter:IdentityAdapter,code:string,client:"web"|"mini"):Promise<{actor:Actor,accessToken:string,refreshToken:string}>`、`beginWebLogin(browserNonce:string):Promise<{loginId:string,expiresAt:string}>`、`consumeWebLogin(loginId:string,nonce:string):Promise<Actor>`、`bind(actor:Actor,verified:VerifiedIdentity):Promise<void>`、`rotateRefresh(token:string):Promise<{accessToken:string,refreshToken:string}>`、`requestAccountDeletion(actor:Actor,input:components["schemas"]["DeletionRequest"]):Promise<components["schemas"]["DeletionStatus"]>`；`cancelAccountDeletion(actor:Actor):Promise<components["schemas"]["DeletionStatus"]>`；`requestPrivacyExport(actor:Actor,key:string):Promise<{jobId:string}>`；`runPrivacyExport(lease:JobLease):Promise<void>`（privacy-export.ts，JobLease由C4任务2提供）。`runIdempotent<T>(tx:PoolClient,scope:string,key:string,payloadHash:string,work:()=>Promise<T>):Promise<T>`定义在server-core。HTTP组合接口`bindContractHttp(app:NestFastifyApplication):Promise<void>`定义在http/contract-http.ts；领域端口不依赖Nest装饰器。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(await auth.login(noUnionIdAdapter,'verified-code','mini')).toMatchObject({actor:{userId:expect.any(String)}});
expect(userForAppA).not.toBe(userForAppB); // same openid, different appId
expect(userWithSamePhone).not.toBe(existingUser);
await expect(auth.consumeWebLogin(loginId,nonce)).rejects.toThrow('LOGIN_ALREADY_CONSUMED');
await expect(auth.rotateRefresh(reusedToken)).rejects.toThrow('REFRESH_REUSE');
expect(afterDeletion).toMatchObject({activeSessions:0,activeShares:0,canCreateJob:false});
expect(privacyExportUserIds).toEqual([actor.userId]);
expect(deletionWithPendingRefund.blockers).toContain('pending_refund');
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/auth/auth.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在所列文件实现上述接口；`generate-api-types.ts`从OpenAPI生成`paths/components/operations`类型，禁止手改生成DTO。`database.ts`实现PoolClient事务rollback/finally释放；`idempotency.ts`落实7天payload绑定。`main.ts`使用`NestFactory.create<NestFastifyApplication>(AppModule,new FastifyAdapter())`启动Nest应用并设置/v1前缀；`app.module.ts`组合领域模块，`auth/auth.module.ts`注册身份端口providers与AuthController，`auth/controller.ts`按生成OpenAPI operationId绑定登录／会话／绑定／注销／隐私导出路由，领域服务仍使用Interfaces中的原签名。`http/contract-http.ts`定义并实现`bindContractHttp(app:NestFastifyApplication):Promise<void>`，把生成合同请求／响应校验、Actor认证Guard、CSRF Guard、统一envelope／异常过滤器、requestId与受控CORS安装到Nest/Fastify生命周期；微信登录与独立验签回调按合同声明的security例外处理，不用客户端参数跳过Guard。登录code只在服务器交换，二维码请求按合同由浏览器创建browserNonce，原浏览器cookie与nonce双绑定且一次消费，确认终端不能直接拿走会话；工程默认二维码120秒、mini access 15分钟、refresh 7天且轮换，实际值受已发布auth配置限制。绑定需两个已验证主体和重新登录，已有不同账户时返回人工合并冲突，不自动转移订单。刷新重用撤销会话族，退出／禁用撤销会话。注销以已验证会话发起和二次确认；确认事务立即封禁新登录／任务／分享并写删除计划，冻结取消／财务保留引用，按合同requested/confirmed/blocked/executing/completed/cancelled与eligibleAt执行，owned_studio/pending_payment/pending_refund/active_job/legal_retention阻塞须明示；符合条件时confirmed即排期，不另发明scheduled状态，取消只能在执行前且不自动复活旧会话／分享；按已发布政策异步清理；必要订单审计脱敏保留。privacy-export.ts中requestPrivacyExport按POST /me/privacy-exports创建privacy_export任务，runPrivacyExport以fence执行、只用个人工作区授权范围，导出本人可访问数据／素材清单，私有短期下载并剔除秘密／其他用户数据；调度由C4任务2提供，接口未连接时不显示已生成。短信能力adapter默认unconfigured，实际短信资质／模板／频控验证后才开放。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/auth/auth.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。附带检查生成DTO无diff及cookie Secure/HttpOnly/SameSite、日志无code/token；提供本地测试身份模式但prod启动拒绝它。
- [ ] **Step 5: 限定提交。** `git add packages/contracts/package.json packages/contracts/src/api.ts scripts/generate-api-types.ts packages/server-core/package.json packages/server-core/src/database.ts packages/server-core/src/idempotency.ts packages/server-core/src/index.ts apps/api/package.json apps/api/src/main.ts apps/api/src/auth/types.ts apps/api/src/auth/identity.ts apps/api/src/auth/sessions.ts apps/api/src/auth/account-deletion.ts apps/api/src/auth/privacy-export.ts apps/api/src/auth/auth.test.ts package.json package-lock.json packages/server-core/src/actor.ts apps/api/src/app.module.ts apps/api/src/auth/auth.module.ts apps/api/src/auth/controller.ts apps/api/src/http/contract-http.ts`；`git commit -m "feat(auth): add unified verified identities and deletion lifecycle"`。

### Task 2: 工作区、逐资源授权与席位预留

**Files:**
- Create: `apps/api/src/workspaces/types.ts`
- Create: `apps/api/src/workspaces/authorization.ts`
- Create: `apps/api/src/workspaces/service.ts`
- Create: `apps/api/src/workspaces/workspaces.test.ts`
- Create: `apps/api/src/workspaces/workspaces.module.ts`
- Create: `apps/api/src/workspaces/controller.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: 任务1 `Actor`、`Database`、`runIdempotent`；SQL工作区／成员表。
- Produces: `WorkspaceRole="owner"|"admin"|"designer"|"viewer"`；`WorkspaceAction="read"|"edit"|"manageAssets"|"deleteAssets"|"purchase"|"share"|"manageSettings"`；`WorkspaceContext={workspaceId:string,userId:string,role:WorkspaceRole}`；`authorizeWorkspace(actor:Actor,workspaceId:string,action:WorkspaceAction,tx?:PoolClient):Promise<WorkspaceContext>`；`createWorkspace(actor:Actor,kind:"personal"|"studio",key:string):Promise<{workspaceId:string,seatLimit:number}>`；`updateWorkspaceSettings(actor:Actor,workspaceId:string,expectedRevision:number,settings:{defaultTemplateId:string|null,defaultSpreadCount:number,defaultWidthMm:number,defaultHeightMm:number}):Promise<{revision:number}>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
await expect(authorizeWorkspace(viewer,wid,'edit')).rejects.toThrow('FORBIDDEN');
await expect(authorizeWorkspace(admin,wid,'purchase')).rejects.toThrow('FORBIDDEN'); // purchase/redeem/refund share owner-only financial gate
expect((await authorizeWorkspace(admin,wid,'manageSettings')).role).toBe('admin');
await expect(authorizeWorkspace(ownerA,workspaceB,'read')).rejects.toThrow('NOT_FOUND');
await expect(authorizeWorkspace(removedDesigner,wid,'read')).rejects.toThrow('FORBIDDEN');
await expect(authorizeWorkspace(platformAdmin,wid,'read')).rejects.toThrow('NOT_FOUND');
expect(studio).toMatchObject({seatLimit:1});
expect(projectAfterChangingDefaults).toEqual(projectBeforeChangingDefaults);
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/workspaces/workspaces.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在`types.ts`定义角色／动作／上下文，`authorization.ts`实现`authorizeWorkspace`；`service.ts`实现创建与设置CAS。个人工作区唯一本人；studio初始化seatLimit=1但保留成员／权益seat_limit字段，与设备数无关，不提供邀请入口。owner/admin可管理设置与素材；purchase动作仅owner，购买／兑换／申请退款的API共用此owner专属财务授权，admin不得由管理设置权限推导财务权限；designer编辑及素材整理，删除由已发布角色策略授权；viewer只读。每个资源查找用workspace_id＋id，数据库事务内重新检查撤销状态；不以JWT缓存角色作为最终授权。默认值仅用于新项目；不能修改平台配额、endpoint或价格。`workspaces.module.ts`注册WorkspaceController和授权providers，`controller.ts`按合同映射工作区／设置端点，AppModule导入该模块，HTTP wrapper负责认证与输入校验、领域层仍逐资源授权。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/workspaces/workspaces.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/workspaces/types.ts apps/api/src/workspaces/authorization.ts apps/api/src/workspaces/service.ts apps/api/src/workspaces/workspaces.test.ts apps/api/src/workspaces/workspaces.module.ts apps/api/src/workspaces/controller.ts apps/api/src/app.module.ts`；`git commit -m "feat(workspaces): enforce resource ownership and reserved studio roles"`。

### Task 3: 私有存储适配、上传验证与原子配额

**Files:**
- Create: `apps/api/src/assets/types.ts`
- Create: `apps/api/src/assets/object-store.ts`
- Create: `apps/api/src/assets/upload.ts`
- Create: `apps/api/src/assets/resource-port.ts`
- Create: `apps/api/src/assets/upload.test.ts`
- Create: `apps/api/src/assets/assets.module.ts`
- Create: `apps/api/src/assets/controller.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: 任务1–2端口；C1 `importImage`归一化规则、ResourcePort／ResourceWriter／AssetRecord；config.schema.json storage配置。
- Produces: `StorageLocator={storageProfileId:string,profileVersion:number,bucket:string,key:string,objectVersionId:string|null,sha256:string,variant:string}`；`ObjectStore={put(locator:StorageLocator,bytes:Uint8Array):Promise<void>,read(locator:StorageLocator):Promise<Uint8Array>,head(locator:StorageLocator):Promise<{bytes:number,sha256:string}>,remove(locator:StorageLocator):Promise<void>,sign(locator:StorageLocator,mode:"upload"|"download",ttlSeconds:number):Promise<string>}`；`QuotaPolicyPort={readQuota(workspaceId:string):Promise<{limitBytes:number,maxProjectPhotos:number}>}`；`beginUpload(actor:Actor,wid:string,input:{bytes:number,sha256:string,mime:"image/jpeg"|"image/png",folderId:string|null,projectId:string|null},key:string):Promise<{uploadId:string,url:string,expiresAt:string}>`；`completeUpload(actor:Actor,wid:string,uploadId:string,key:string):Promise<AssetRecord>`；`createResourcePort(actor:Actor,wid:string):ResourcePort`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(await Promise.allSettled(twoConcurrentUploads)).toMatchObject([{status:'fulfilled'},{status:'rejected'}]); // quota fits exactly one
await expect(completeUpload(actor,wid,fakeJpegUploadId,key)).rejects.toThrow('INVALID_IMAGE');
await expect(beginUpload(actor,wid,{...uploadInput,bytes:25_000_001},key)).rejects.toThrow('UPLOAD_TOO_LARGE');
await expect(completeUpload(actor,wid,over80MpUploadId,key)).rejects.toThrow('IMAGE_PIXELS_EXCEEDED');
expect(await port.read(oldId,'original')).toEqual(originalBytes); // prefix changed
expect(usageAfterRejectedUpload.reservedBytes).toBe(0);
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/assets/upload.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在`object-store.ts`定义ObjectStore并提供本地私有fake及已选择供应商adapter；未实现oss/cos/s3不得标ready。`upload.ts`实现begin/complete签名，事务预占原片及派生图保守上界、解码后原子调整实际字节；完成前HEAD、magic、解码像素、hash全部匹配，EXIF校正后存normalized与preview，原片不可变。服务端生成含UTC年月的固定token key，不使用文件夹／姓名／文件名；profile只影响新写入，旧资源按locator。下载每次授权再签300秒URL，资源端口绑定actor/wid且核对hash，禁止preview替代original。限额包含回收／历史／预占，工作区内去重不泄露跨区hash；会员过期超额只阻止新增，保留读／下载。活动上传24小时清理例外与幂等complete要有CAS。`assets.module.ts`注册素材／存储providers与AssetsController，`controller.ts`映射上传签发／complete、素材查询／下载／用量端点，AppModule导入该模块；不能让直接Fastify路由绕过Nest的合同／安全wrapper。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/assets/upload.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/assets/types.ts apps/api/src/assets/object-store.ts apps/api/src/assets/upload.ts apps/api/src/assets/resource-port.ts apps/api/src/assets/upload.test.ts apps/api/src/assets/assets.module.ts apps/api/src/assets/controller.ts apps/api/src/app.module.ts`；`git commit -m "feat(assets): validate private uploads with atomic storage reservations"`。

### Task 4: 逻辑文件夹、回收恢复与可恢复迁移

**Files:**
- Create: `apps/api/src/folders/service.ts`
- Create: `apps/api/src/assets/migration.ts`
- Create: `apps/api/src/folders/folders.test.ts`
- Create: `apps/api/src/folders/folders.module.ts`
- Create: `apps/api/src/folders/controller.ts`
- Create: `apps/api/src/assets/migration-controller.ts`
- Modify: `apps/api/src/assets/assets.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: 任务2授权、任务3 `StorageLocator`／`ObjectStore`；SQL asset_folders、storage_migration_items。
- Produces: `AssetFolder={id:string,workspaceId:string,parentId:string|null,name:string,normalizedName:string,revision:number,deletedAt:string|null}`；`FolderMutation={name?:string,parentId?:string|null}`；`createFolder(actor:Actor,wid:string,parentId:string|null,name:string,key:string):Promise<AssetFolder>`、`updateFolder(actor:Actor,wid:string,fid:string,expectedRevision:number,patch:FolderMutation):Promise<AssetFolder>`、`batchMoveAssets(actor:Actor,wid:string,assetIds:string[],targetFolderId:string|null,key:string):Promise<void>`、`trashFolder(actor:Actor,wid:string,fid:string,expectedRevision:number,key:string):Promise<void>`、`restoreFolder(actor:Actor,wid:string,fid:string,targetParentId:string|null,name:string,key:string):Promise<AssetFolder>`；`migrateObject(itemId:string,store:ObjectStore):Promise<{state:"copied"|"verified"|"switched"|"failed",oldLocatorRetained:boolean}>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
await expect(updateFolder(actor,wid,parentId,1,{parentId:descendantId})).rejects.toThrow('FOLDER_CYCLE');
await expect(createFolder(actor,wid,tenthLevelId,'child',key)).rejects.toThrow('FOLDER_DEPTH_EXCEEDED');
await expect(updateFolder(actor,wid,folderId,1,{name:'CAFÉ'})).rejects.toThrow('FOLDER_NAME_CONFLICT'); // sibling café exists
expect(assetKeysAfterRename).toEqual(assetKeysBeforeRename);
await expect(trashFolder(actor,wid,referencedFolderId,1,key)).rejects.toThrow('ASSET_IN_USE');
expect(failedHashMigration).toMatchObject({state:'failed',oldLocatorRetained:true});
expect(locatorAfterFailedMigration).toEqual(oldLocator);
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/folders/folders.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在`folders/service.ts`定义AssetFolder并实现五个目录／批量签名；同父活跃名称使用NFC＋大小写折叠唯一键，移动整棵子树算最大10级，不仅检查目标深度。批量操作同事务全成功／全拒绝，引用项目／任务的树删除列出影响并整体拒绝；回收不释放物理配额，恢复同名冲突不覆盖。`assets/migration.ts`实现`migrateObject(itemId,store)`：复制→SHA/尺寸核验→原locator revision条件更新→记录检查点；旧locator受活动snapshot pin保护直到释放／保留期，失败不切换。后台迁移创建需权限、估算费用和显式确认，取消只停止未复制项；目录操作永不触发对象迁移。`folders.module.ts`注册FoldersController和目录服务并由AppModule导入；`folders/controller.ts`映射目录／批量移动／回收恢复合同端点。`assets/migration-controller.ts`承载后台存储迁移创建／进度／取消路由，由AssetsModule注册并施加平台运维权限，不借工作区目录权限执行物理迁移。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/folders/folders.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/folders/service.ts apps/api/src/assets/migration.ts apps/api/src/folders/folders.test.ts apps/api/src/folders/folders.module.ts apps/api/src/folders/controller.ts apps/api/src/assets/migration-controller.ts apps/api/src/assets/assets.module.ts apps/api/src/app.module.ts`；`git commit -m "feat(storage): add transactional folders and checked object migration"`。

### Task 5: 云端revision仓库、恢复与mini白名单patch

**Files:**
- Create: `apps/api/src/projects/revisions.ts`
- Create: `apps/api/src/projects/mini-patch.ts`
- Create: `apps/api/src/projects/layout-service.ts`
- Create: `packages/storage/src/cloud-revision-store.ts`
- Create: `apps/api/src/projects/revisions.test.ts`
- Create: `apps/api/src/projects/projects.module.ts`
- Create: `apps/api/src/projects/controller.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: C1 `RevisionStore`、`SavedRevision`、`SaveResult`、`DocumentModel`；任务1–3授权／资源端口；C2 `verifyCandidate`、`createLayoutCommand`。
- Produces: `saveCloudRevision(actor:Actor,wid:string,doc:DocumentModel,expectedRevision:number,resources:ResourceManifest,key:string):Promise<SavedRevision>`；`MiniPatch=components["schemas"]["SetText"]|components["schemas"]["SetCrop"]|components["schemas"]["ReplaceAsset"]|components["schemas"]["ReorderSpreads"]`（使用合同type判别与spreadId，不另设op字段）；`applyMiniPatch(actor:Actor,wid:string,projectId:string,expectedRevision:number,patches:MiniPatch[],key:string):Promise<SavedRevision>`；`CloudRevisionStore implements RevisionStore`，构造器`(baseUrl:string,workspaceId:string,fetcher:typeof fetch)`，保持C1 load/save签名。`createCloudLayoutJob(actor:Actor,wid:string,projectId:string,input:components["schemas"]["LayoutJobCreate"],key:string):Promise<JobRecord>`、`runCloudLayoutJob(lease:JobLease):Promise<void>`、`applyCloudLayout(actor:Actor,wid:string,projectId:string,candidateId:string,expectedRevision:number,key:string):Promise<SavedRevision>`定义在layout-service.ts；JobRecord/JobLease由C4任务2提供。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(concurrentSaveResults.filter(r=>r.ok)).toHaveLength(1);
expect(conflict.status).toBe(409);
expect(advancedLayerAfterMini).toEqual(advancedLayerBeforeMini); // opaque metadata untouched
expect(changedText.text).toBe('新标题');
await expect(applyMiniPatch(actor,wid,projectId,12,unsupportedPatch,key)).rejects.toThrow('MINI_PATCH_FORBIDDEN');
expect(recoverableRevisionCount).toBeGreaterThanOrEqual(20);
expect(cloudSaveFailure.recoveryDraft).toEqual(unsavedLocalDoc);
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/projects/revisions.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在`revisions.ts`实现saveCloudRevision并按项目锁＋revision CAS保存规范JSON/hash和manifest；验证每个asset/font版本归属、ready、不可变hash及C2清单，引用对象pin／retention不被回收。`mini-patch.ts`只允许模板editableFields、允许替换槽位和合法crop；拒绝自由几何／字体／未知操作，使用C1模型局部更新保留未知同版层及扩展字段。`cloud-revision-store.ts`实现HTTP适配，将If-Match字符串revision与409映射为C1 SaveResult恢复草稿；离线先落IndexedDB恢复副本，不显示已云保存。候选apply在相同CAS事务验证baseRevision，不信客户端文档。至少20恢复revision和活动任务引用例外。`layout-service.ts`按精确OpenAPI挂接POST /projects/{projectId}/layout-jobs、GET /jobs/{jobId}/layout-candidates、POST /projects/{projectId}/apply-layout：LayoutJobCreate只有layoutSpec字段，路由projectId必须等于layoutSpec.projectId，不复制baseRevision/assetIds/seed到顶层；job冻结布局输入/权重，worker调用C2引擎、保存真实候选清单，应用在同一项目CAS事务调用C2校验。此云调度接线在C4任务2就绪后完成，不提前引用不存在的队列帮助函数。mini外部commands只接受合同setText/setCrop/replaceAsset/reorderSpreads，平台取会话；内部MiniPatch统一为这四种合同命令，replaceDocument仅web。`projects.module.ts`注册revision／mini／layout领域providers，`controller.ts`导出ProjectsController与LayoutCandidatesController映射项目保存／恢复、mini patch及上述layout合同端点，由AppModule导入；业务CAS在领域事务内完成。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/projects/revisions.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/projects/revisions.ts apps/api/src/projects/mini-patch.ts apps/api/src/projects/layout-service.ts packages/storage/src/cloud-revision-store.ts apps/api/src/projects/revisions.test.ts apps/api/src/projects/projects.module.ts apps/api/src/projects/controller.ts apps/api/src/app.module.ts`；`git commit -m "feat(projects): add cloud compare-and-swap revisions and safe mini patches"`。

### Task 6: 小程序快速成册、轻编辑与跨端任务中心

**Files:**
- Create: `apps/mini/project.config.json`
- Create: `apps/mini/app.ts`
- Create: `apps/mini/app.json`
- Create: `apps/mini/src/api.ts`
- Create: `apps/mini/pages/album/index.ts`
- Create: `apps/mini/pages/album/index.wxml`
- Create: `apps/mini/pages/album/index.wxss`
- Create: `apps/mini/pages/tasks/index.ts`
- Create: `apps/mini/pages/tasks/index.wxml`
- Create: `apps/mini/src/album.test.ts`

**Interfaces:**
- Consumes: 生成HTTP类型、任务1微信登录、任务3上传、任务4目录、任务5 MiniPatch、C2布局API；任务列表来自C4合同，未就绪只显示unconfigured。
- Produces: `MiniAlbumState={projectId:string|null,revision:number|null,phase:"select"|"upload"|"layout"|"edit"|"preview",pendingPatches:MiniPatch[],recoverable:boolean}`；`loadMiniAlbum(projectId:string):Promise<MiniAlbumState>`、`submitMiniEdits(state:MiniAlbumState,key:string):Promise<MiniAlbumState>`；`listMiniTasks(cursor:string|null):Promise<{items:Array<{jobId:string,state:string}>,nextCursor:string|null,hasMore:boolean}>`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
expect(travelAlbum.selectedPhotoCount).toBe(50);
expect(travelAlbum.spreadCount).toBe(10);
expect(offlineState).toMatchObject({recoverable:true,pendingPatches:expectedPatches});
expect(after409.pendingPatches).toEqual(expectedPatches);
expect(advancedFieldAfterMiniSave).toEqual(advancedFieldBeforeMiniSave);
expect(taskSeenOnMini.jobId).toBe(taskCreatedOnWeb.jobId);
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/mini/src/album.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在`api.ts`实现统一envelope、bearer轮换、过期登录和HTTP错误；相册页实现选片逐项上传重试、简易目录选择／新建、主题／页数／候选对比、允许文字替换／单图裁剪、预览／保存和导出任务入口。状态机函数按上述签名放`pages/album/index.ts`并可在Node测试；小程序wx存储只保存恢复patch和revision，不保存refresh明文日志。409显示保留本地草稿、复制恢复或重新加载，不自动重放到新revision。需要高级编辑显示“可在电脑网页继续编辑”；不把提示变成未开通渠道购买引导。任务页按服务端事实源分页查询，页面关闭不取消后台任务，未理解图层不重序列化。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/mini/src/album.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。真实微信开发者工具与iOS/Android授权设备流程留实施证据，缺AppID只标联调待接入，不阻断本地状态机与mock合同验收。
- [ ] **Step 5: 限定提交。** `git add apps/mini/project.config.json apps/mini/app.ts apps/mini/app.json apps/mini/src/api.ts apps/mini/pages/album/index.ts apps/mini/pages/album/index.wxml apps/mini/pages/album/index.wxss apps/mini/pages/tasks/index.ts apps/mini/pages/tasks/index.wxml apps/mini/src/album.test.ts`；`git commit -m "feat(mini): build quick-album workflow with safe cross-device edits"`。

### Task 7: 私有分享、下载授权与用户授权通知

**Files:**
- Create: `apps/api/src/sharing/service.ts`
- Create: `apps/api/src/notifications/service.ts`
- Create: `apps/api/src/sharing/sharing.test.ts`
- Create: `apps/api/src/sharing/sharing.module.ts`
- Create: `apps/api/src/sharing/controller.ts`
- Create: `apps/api/src/notifications/notifications.module.ts`
- Create: `apps/api/src/notifications/controller.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: 任务1 Actor／注销、任务2权限、任务3ObjectStore；SQL分享／通知／outbox。
- Produces: `createShare(actor:Actor,wid:string,projectId:string,expiresAt:string,key:string):Promise<{shareId:string,url:string}>`；`revokeShare(actor:Actor,wid:string,shareId:string):Promise<void>`；`authorizeShare(token:string,resourceId:string):Promise<{workspaceId:string,resourceId:string}>`；`NotificationAdapter={send(input:{recipientId:string,templateVersion:string,fields:Record<string,string>}):Promise<{providerMessageId:string}>}`；`deliverNotification(eventId:string,adapter:NotificationAdapter):Promise<"sent"|"skipped"|"retry">`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
await expect(authorizeShare(revokedToken,resourceId)).rejects.toThrow('SHARE_REVOKED');
expect(existingSignedUrlExpirySeconds).toBe(300);
await expect(authorizeShare(revokedToken,resourceId)).rejects.toThrow('SHARE_REVOKED'); // no new signed URL issued
expect(messageCountAfter100Replays).toBe(1);
expect(notificationAfterOptOut).toBe('skipped');
expect(smsUnconfiguredResult).toBe('skipped');
```
- [ ] **Step 2: 运行失败用例。** `npm run test:unit -- apps/api/src/sharing/sharing.test.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 在`sharing/service.ts`实现三签名，随机高熵token仅存hash，默认私有，分享范围明确到项目／冻结预览资源，不泄露原片、GPS或其他项目；到期／撤销／注销后拒绝新签名。UI准确说明直连300秒窗口，需即时撤销时切网关逐次鉴权且无公开缓存。`notifications/service.ts`定义adapter并实现deliverNotification：站内记录＋可选微信订阅／短信，检查实际授权、模板版本、退订及工作区访问；eventId＋recipient＋channel唯一，Outbox投递重试不重复发送。短信默认disabled；未配置通知不使任务失败。不可让管理员随请求传收件地址绕过已验证目的地。SharingModule／NotificationsModule各注册对应controller.ts和服务providers并由AppModule导入，分别映射私有分享／公开token访问／撤销与通知列表／偏好合同操作；公开分享路径仅使用合同token授权，其他路由继续使用统一Actor Guard。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:unit -- apps/api/src/sharing/sharing.test.ts` 与 `npm run typecheck`；预期PASS、退出码0。
- [ ] **Step 5: 限定提交。** `git add apps/api/src/sharing/service.ts apps/api/src/notifications/service.ts apps/api/src/sharing/sharing.test.ts apps/api/src/sharing/sharing.module.ts apps/api/src/sharing/controller.ts apps/api/src/notifications/notifications.module.ts apps/api/src/notifications/controller.ts apps/api/src/app.module.ts`；`git commit -m "feat(sharing): enforce revocable access and consented notifications"`。

### Task 8: 网页云工作区、目录界面与恢复状态整合

**Files:**
- Create: `apps/web/src/auth/LoginPanel.tsx`
- Create: `apps/web/src/workspaces/WorkspaceSwitcher.tsx`
- Create: `apps/web/src/assets/FolderBrowser.tsx`
- Create: `apps/web/src/projects/CloudProjectProvider.tsx`
- Create: `apps/web/src/account/AccountSettings.tsx`
- Create: `tests/browser/cloud-workspace.spec.ts`
- Modify: `apps/web/src/editor/EditorPage.tsx`

**Interfaces:**
- Consumes: 任务1–7服务和CloudRevisionStore；C1本地仓库／恢复项目包；C2候选核对。
- Produces: `CloudProjectProvider(props:{workspaceId:string,children:React.ReactNode}):React.JSX.Element`；`FolderBrowser(props:{workspaceId:string,onSelectAsset:(assetId:string)=>void}):React.JSX.Element`；`WorkspaceSwitcher(props:{onChange:(workspaceId:string)=>void}):React.JSX.Element`；`AccountSettings():React.JSX.Element`。

- [ ] **Step 1: 写失败断言。** 测试文件内构造下述输入、受控时钟和端口fake；并发／SQL行为在临时PostgreSQL执行，不用只返回预定结果的mock证明事务。

```ts
await expect(page.getByText('云端保存失败，本地草稿已保留')).toBeVisible();
await expect(page.getByText('该版本已由其他设备修改')).toBeVisible();
await expect(page.getByText('移入回收站，不会立即删除云对象')).toBeVisible();
await expect(page.getByRole('button',{name:'邀请成员'})).toHaveCount(0);
expect(documentAfterLateSaveResponse).toEqual(currentWorkspaceDocument);
await expect(page.getByText('短信登录未开通')).toBeVisible();
```
- [ ] **Step 2: 运行失败用例。** `npm run test:browser -- tests/browser/cloud-workspace.spec.ts`；预期FAIL，错误指向本项缺失的接口或行为断言；依赖／测试配置错误须先排除，不能算有效红灯。
- [ ] **Step 3: 实现本项接口。** 实现上述组件与LoginPanel／AccountSettings并接入EditorPage。登录支持微信扫码过期刷新与明确平台状态；只有短信能力available才显示可用入口。工作区切换绑定项目／资源／购买上下文并清理迟到响应；云保存中／成功／离线／失败文案与真实状态一致。目录面包屑、名称／时间排序、搜索、批量移动、当前目录上传、回收恢复、引用影响和存储用量分类完整呈现；无权操作不显示成功按钮。个人设置包括语言／展示时区／快捷键，工作区默认只影响新建相册；账号注销展示实际政策和订单保留说明后请求删除。分享显示有效期／撤销与签名窗口；保留C1本地项目包导入／恢复入口。
- [ ] **Step 4: 验证通过。** 重跑 `npm run test:browser -- tests/browser/cloud-workspace.spec.ts` 与 `npm run typecheck`；预期PASS、退出码0。运行`npm run build`并验证网页→mini改标题／crop→网页恢复高级字段的合同回放，实际设备另记。
- [ ] **Step 5: 限定提交。** `git add apps/web/src/auth/LoginPanel.tsx apps/web/src/workspaces/WorkspaceSwitcher.tsx apps/web/src/assets/FolderBrowser.tsx apps/web/src/projects/CloudProjectProvider.tsx apps/web/src/account/AccountSettings.tsx tests/browser/cloud-workspace.spec.ts apps/web/src/editor/EditorPage.tsx`；`git commit -m "feat(web): integrate cloud workspaces folders and recovery states"`。

## 自审与执行交接

已复核NestJS＋FastifyAdapter组合、模块／controller与统一合同安全wrapper，领域公开端口保持原签名；admin购买拒绝及owner专属购买／兑换／退款有任务2失败断言，机器格式统一jpeg。8项覆盖AUTH-01/02、AST-01、DOC-01、V3-CROSS-01、CFG-STORAGE/FOLDERS/AUTH/NOTIFY、SHARE-01、ACCOUNT-DELETE／PRIVACY-01与APP-RESERVE。RF1→1、RF2→2/3、RF3→3/4、RF4→5/6/8、RF5→1/7都有失败断言。已检查ResourcePort与RevisionStore保持C1签名，MiniPatch不另定义产品文档；云仓库把数值revision转If-Match字符串；应用服务都在拥有任务定义。迁移、目录与账号删除都具备引用／pin保护，不用测试任务代替功能。

当前覆盖缺口：无首期功能缺项；真实微信扫码／小程序／短信和云厂商适配仅在经营者确认接入后做真实联调，不宣称模拟即生产可用。通知的可靠调度与账本依赖C4任务事实源，C3先以相同数据库outbox接口实施；允许本地完整验证，不等待真实凭据。本轮不编码，不逐模块请求增量批准。
