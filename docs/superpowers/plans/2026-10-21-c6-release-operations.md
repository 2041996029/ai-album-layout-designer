# C6 全模块验收与运维发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为C1–C5建立可重复构建、集成验证、恢复演练和受控发布证据，使真实上线条件可核对。

**Architecture:** 重用C3 API、C4任务／账本及C5供应商契约，不另建业务实现。环境、秘密、镜像、数据库与配置版本共同构成release manifest；先隔离预发，再完成平台／经营者所需真实接入，最后灰度发布。

**Tech Stack:** Node24 LTS、npm lockfile、Playwright固定Chromium、PostgreSQL16/17目标、Redis/BullMQ、Docker/Compose集成、云秘密服务、指标与日志。

**Spec:** [统一基线](../../release-v1.0/01-产品与模块基线.md)、[运行手册](../../release-v1.0/operations/deployment-runbook.md)、[测试策略](../../release-v1.0/testing/TEST-STRATEGY.md)、[环境schema](../../release-v1.0/operations/environment.schema.json)。

## Global Constraints

- 用户已明确全程AI开发；此为待执行计划，不是部署记录。dev/staging/prod隔离，不将生产照片复制到测试。
- 公开ID1–128字符不透明字符串；金额人民币分、点数整数；数据库UTC，预算日Asia/Shanghai。
- 1–50内页跨页、500照片／项目、100递归图层／面、源图25_000_000字节／80MP、输出面50MP，容量需实测。
- 固定Chromium／字体／滤镜／模板及renderer hash；缺原片不回退缩略图；缺字体／授权／文字超框阻断导出。
- 生产镜像须实际构建并锁定digest；真实支付／AI调用只使用已确认账户／预算，秘密不入Git或报告。

## Review Focus

- RF1：环境变量看似存在但值为空／秘密引用越界，必须启动失败且无明文日志；任务1。
- RF2：配置刷新部分失败或新镜像schema不兼容，禁止混合版本接受新写；任务2。
- RF3：跨端切换、支付重复回调、供应商未知状态同时出现，作品／账本仍一致；任务3。
- RF4：恢复旧库使已注销照片复活或重复履约，必须重放删除标记并先对账；任务4。
- RF5：无实际流量／无真机／无真实渠道证明的发布不能被标成全通过，失败回滚保留新业务数据；任务5。

## Task 1: 可重复构建与启动配置

**Files:** Create `scripts/release/build-manifest.ts`, `scripts/release/check-startup.ts`, `deploy/compose.integration.yaml`, `.github/workflows/release.yml`, `tests/ops/startup.spec.ts`；Modify root `package.json`。

**Interfaces:** Consumes环境schema、实际lockfile和C1–C5产物。Produces `parseStartup(env:Record<string,string|undefined>,role:ServiceRole):StartupConfig`、`buildManifest(input:BuildInputs):Promise<ReleaseManifest>`。ServiceRole为api/export-worker/ai-worker/web/admin；BuildInputs含commit、imageDigests、schemaVersion、migrationVersion、rendererBuild、font/filter/template hashes；manifest不含秘密。

- [ ] **Step 1:** 写startup.spec.ts，空DATABASE_URL_FILE、路径越出/run/secrets、prod使用localFiles、未锁镜像digest均拒绝；`expect(()=>parseStartup(invalid,'api')).toThrow('STARTUP_CONFIG_INVALID')`。（RF1）
- [ ] **Step 2:** `npm run test:ops -- tests/ops/startup.spec.ts`，预期FAIL缺parseStartup实现，不能只把配置错误算有效失败。
- [ ] **Step 3:** 实现两个签名，数值环境字符串先转类型，只校验选定键；按角色读取必要_FILE，worker不索取会话签名秘密；镜像／SBOM／许可随产物归档，Compose从本包模板适配实际构建路径。
- [ ] **Step 4:** 同命令及`npm run typecheck`预期退出0；`docker compose --env-file deploy/.env.integration -f deploy/compose.integration.yaml config --quiet`预期0，检查输出不含秘密值，不执行生产连接。
- [ ] **Step 5:** 提交上述路径；`git commit -m "build: verify role-based startup and release manifests"`。

## Task 2: 健康检查、配置陈旧和兼容迁移

**Files:** Create `apps/api/src/health/readiness.ts`, `scripts/release/check-compatibility.ts`, `tests/ops/readiness.spec.ts`。

**Interfaces:** ConsumesC3 DB端口、C4配置快照／任务claim端口。Produces `readiness(deps:HealthDependencies,now:Date):Promise<ReadyStatus>`、`assertCompatible(current:ReleaseManifest,target:ReleaseManifest):void`。ReadyStatus含ready、checks[{name,state,reason}]；仅脱敏类别。

- [ ] **Step 1:** 断言DB不可达readiness503，AI未配置只关闭AI能力；配置陈旧>300秒不接受新写／claim但可终结在途；`expect(()=>assertCompatible(newSchema,oldReader)).toThrow('INCOMPATIBLE_READER')`。（RF2）
- [ ] **Step 2:** `npm run test:ops -- tests/ops/readiness.spec.ts`预期FAIL缺入口。
- [ ] **Step 3:** 实现上述签名，完整config release原子刷新；live只检测进程，ready检测当前角色必要依赖；迁移采用expand→兼容→回填→contract，不自动执行破坏性down。
- [ ] **Step 4:** 同命令PASS；隔离环境执行健康探针／迁移兼容样本，保留HTTP状态和schema版本，不用单个进程live当全站就绪。
- [ ] **Step 5:** `git add apps/api/src/health/readiness.ts scripts/release/check-compatibility.ts tests/ops/readiness.spec.ts`；`git commit -m "feat(ops): gate readiness and schema compatibility"`。

## Task 3: 全链路、跨端与竞态验收

**Files:** Create `tests/e2e/album-commerce-ai.spec.ts`, `tests/e2e/mini-contract.spec.ts`, `scripts/release/collect-evidence.ts`。

**Interfaces:** ConsumesOpenAPI、测试工作区、可重放adapter、真实浏览器和mini真机记录。Produces `collectEvidence(run:AcceptanceRun):Promise<EvidenceIndex>`；AcceptanceRun含commit、environment、testIds、results、attachments、actualServiceModes，明示mock／sandbox／live。

- [ ] **Step 1:** 同一run覆盖mini上传→规则成册→网页改中文→revision冻结导出；支付回调100次、10并发余额仅够1次、AI提交超时迟到、取消／成功竞态，`expect(grantsForOrder).toHaveLength(1)`、`expect(acceptedGenerationCount).toBe(1)`、`expect(exportRevision).toBe(12)`。（RF3）
- [ ] **Step 2:** `npm run test:e2e -- tests/e2e/album-commerce-ai.spec.ts tests/e2e/mini-contract.spec.ts`预期FAIL缺串联／证据收集，不以缺凭据错误冒充功能失败。
- [ ] **Step 3:** 完成现有模块串联与证据收集，不为通过测试创建第二套账本；mock服务有固定故障脚本。真实微信／支付／AI测试在已具备准入和预算后执行，其失败不能用mock结果覆盖。
- [ ] **Step 4:** 同命令PASS，实际程序样片验证像素／DPI／中文／页序；小程序真机矩阵逐项记录。无真机／服务资质时对应case记blocked_external，不能写通过。
- [ ] **Step 5:** 提交本项路径；`git commit -m "test: cover cross-platform album commercial and AI flows"`。

## Task 4: 备份恢复和队列重建

**Files:** Create `scripts/ops/restore-drill.ts`, `scripts/ops/rebuild-jobs.ts`, `tests/ops/restore.spec.ts`。

**Interfaces:** Consumes数据库／对象备份、tombstone、jobs/outbox和渠道只读查询。Produces `restoreDrill(input:RestoreInput):Promise<RestoreReport>`、`rebuildJobs(scope:RecoveryScope):Promise<RecoveryReport>`；input必须isolatedTarget=true、backupPoint、objectManifest、reconcileMode='queryOnly'，禁止默认生产目标。

- [ ] **Step 1:** 恢复点后删除的素材仍不可见，已付未履约只按同operation处理一次，旧worker fence不能提交；`expect(restoredAsset.visible).toBe(false)`、`expect(repeatedGrantCount).toBe(0)`。非隔离目标拒绝。（RF4）
- [ ] **Step 2:** `npm run test:ops -- tests/ops/restore.spec.ts`预期FAIL缺恢复编排。
- [ ] **Step 3:** 实现签名，先冻结新金融／生成写、恢复隔离目标、hash抽查、重放删除、只读对账、重建队列使旧租约失效；没有对账证据不恢复写入口。
- [ ] **Step 4:** 同命令PASS；实际隔离恢复记录RPO／RTO、账本汇总／资源引用／未完任务；建议RPO15分钟／RTO4小时只是目标，不自动出具已达标结论。
- [ ] **Step 5:** 提交本项路径；`git commit -m "feat(ops): add isolated restore and queue recovery drills"`。

## Task 5: 容量、发布准出与回滚验证

**Files:** Create `scripts/release/evaluate-gates.ts`, `scripts/release/rollback-dryrun.ts`, `tests/ops/release-gates.spec.ts`, `docs/implementation/release/README.md`。

**Interfaces:** Consumes所有需求追踪和真实证据。Produces `evaluateGates(evidence:EvidenceIndex,policy:ReleasePolicy):GateReport`、`rollbackDryRun(current:ReleaseManifest,target:ReleaseManifest):Promise<RollbackReport>`；GateReport含passed、blocked、waived及明确原因，不能把skipped映射passed。

- [ ] **Step 1:** mock支付、空流量、未测真机、缺恢复报告均不能满足各自真实准出；`expect(evaluateGates(incomplete,production).passed).toBe(false)`；回滚不能执行数据删表或重复账本写。（RF5）
- [ ] **Step 2:** `npm run test:ops -- tests/ops/release-gates.spec.ts`预期FAIL缺gate计算。
- [ ] **Step 3:** 实现签名，按测试策略跑1→10→50→100会话阶梯及耐久，渲染逐面／预算限制；把实际CPU／内存／耗时／费用与目标对比。发布灰度按真实观测推进，生成可审查发布说明和回滚方案后再处理生产发布授权。
- [ ] **Step 4:** 同命令PASS；运行`npm run release:check -- --evidence docs/implementation/release/evidence.json`，仅全部规定门槛有真实证据才退出0，否则非0并列明阻断。验收后按执行方法安排独立复核。
- [ ] **Step 5:** 提交本项路径；`git commit -m "feat(ops): enforce evidence-based release and rollback gates"`。

## 自审

5项任务覆盖构建／配置、健康迁移、全链路、恢复、容量发布；5个Review Focus都有失败断言和命令。命令随实施任务写入根package scripts，当前文档包不创建空脚本冒充运行。所有真实凭据与生产发布点有具体输入和证据要求，不阻断可离线研发。
