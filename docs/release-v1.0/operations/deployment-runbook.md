# 环境、部署、发布与恢复操作

## 1. 环境分离与秘密

dev、staging、prod分开数据库、对象桶／前缀、Redis、微信应用／渠道、AI采购账户和预算。正式应用镜像尚未构建，compose.review.yaml为后续集成拓扑模板；语法可校验，不能当作当前可启动产品。生产使用已构建并签名／锁定digest的镜像，静态站CDN＋TLS网关，API建议两个实例，独立worker，托管PG／Redis和私有对象。

[environment.schema.json](environment.schema.json)定义变量合同，[.env.example](.env.example)只含非秘密样例与文件引用。应用须实现_FILE载入并验证文件权限，缺项启动失败。不会把真实URL密码或供应商key塞进示例。DB／Redis秘密和会话签名放挂载文件；供应商秘密通过受控secretRef版本加载，不在前端构建时注入。

| 变量 | 说明／生产约束 |
|---|---|
| APP_ENV／SERVICE_ROLE | dev/staging/prod；api/export-worker/ai-worker等角色，客户端不能选择环境 |
| PUBLIC_ORIGIN／PUBLIC_API_ORIGIN | 精确HTTPS来源，CORS／CSRF匹配；本地dev可localhost |
| HTTP_PORT／TRUST_PROXY_HOPS | 默认3000／1；只信任真实网关层数，防伪造来源 |
| DATABASE_URL_FILE／REDIS_URL_FILE | 挂载秘密文件，不输出内容；生产传输加密和最小数据库角色 |
| SESSION_SIGNING_SECRET_FILE | 生产强随机秘密且可轮换，禁止默认常量 |
| SECRET_STORE_PROVIDER／SECRET_STORE_REGION | localFiles仅dev；生产按实际云秘密服务适配和workload身份 |
| SECRET_STORE_CATALOG_FILE | dev秘密引用到本地文件的受控映射，不接受请求指定路径 |
| CONFIG_REFRESH_SECONDS | 默认30秒；取得完整release后原子替换，不混合配置 |
| CONFIG_MAX_STALENESS_SECONDS | 默认300秒；超时停止新写／claim并告警，保留在途终结和安全只读 |
| WORKER_MEMORY_MIB／WORKER_CONCURRENCY | 导出初始2048MiB／1，实测加容器余量后调整，最大值由部署硬限制控制 |
| LOG_LEVEL／LOG_REDACTION | info／strict；不得记录token、照片、完整提示词或签名下载地址 |
| RENDER_BROWSER_REVISION | 实际Playwright修订；不得写latest，构建证据含版本和字体／kernelhash |
| RELEASE_ID／COMMIT_SHA | 发布批次与真实commit，写入任务manifest及观测标签 |
| API_IMAGE／WEB_IMAGE／ADMIN_IMAGE／WORKER_IMAGE | 构建后填写；生产必须含sha256摘要，文档不伪造真实镜像 |
| POSTGRES_IMAGE／REDIS_IMAGE | 开发参考postgres17／redis7，实际测试记录确切版本；生产托管服务或锁定digest |

## 2. 构建与预发

1. 对照需求追踪，锁定本次代码、OpenAPI、schema、SQL migration和内容／配置版本；执行单元、集成、浏览器和契约测试，保留失败详情。
2. 从lockfile构建web/admin/api/worker；固定Chromium和合法字体，生成SBOM／依赖许可／镜像摘要；运行无秘密扫描。没有实际产物不得填假digest。
3. 本地集成先准备秘密文件和非生产配置；用docker compose config检查拓扑后启动应用构建产物。compose模板不创建真实云桶／商户号／AI采购账户。
4. 预发加载空库执行up，验证schema；有历史数据时先备份并执行expand兼容迁移，再部署兼容双版本的API，最后做数据回填和contract。不要把删除字段与首次读取新字段放一版。
5. 运行healthLive／healthReady，后者检查DB、必要Redis、配置版本、secret绑定和自身角色所需依赖；AI缺配置只关闭生成能力，不阻断普通作品读取。
6. 在后台建立存储profile并测试临时对象写读删，建立内容／字体／滤镜版本，配置微信／支付与模型能力。真实样图先展示费用并取得操作者确认，使用测试预算。
7. 执行全链路E2E：mini选片／成册→web编辑→预检／队列→下载；支付小额真实下单／履约／退款；AI状态未知／迟到／成本对账。缺资质的能力保持unconfigured并在发布范围表说明，不标记通过。

## 3. 发布与回滚

发布前必须有测试报告、数据库／对象恢复记录、前后兼容说明、迁移校验、版本化配置、渠道准入、AI标识／隐私／许可、告警目的地和回滚值。内部工作区→5%→20%→100%为推荐灰度，每段观察保存成功率、任务错误与财务差异；实际时长依据流量记录，不用无请求的窗口证明稳定。

阻断级：作品丢失、跨租户访问、重复扣点／履约立即停相关写；未知供应商提交不重新发起。关闭新生成／购买／导出开关不删除已保存作品。API回滚必须仍能读新schema；数据库优先前向修复，不在真实业务期间执行down删表。回滚配置复验旧密钥有效，不回滚财务历史。

记录发布ID、commit／镜像摘要、数据库版本、配置release、执行时间（UTC存储、北京时间展示）、观测值和结果。没有值班人时先确定告警接收方式；文档完成不代替经营者的生产发布授权。

## 4. 恢复演练

数据库推荐连续归档＋每日备份，目标RPO≤15分钟、RTO≤4小时，必须实测；对象存储版本／备份覆盖原片、文档、字体和模板。Redis非事实源，可由jobs＋outbox重建；对象迁移不算备份。

恢复流程：停止支付／生成新写和outbox→复制备份到隔离目标→恢复PG至选定时间点→匹配对象版本并抽查manifest SHA→重放tombstones→对账恢复点后的支付／退款／点数／上游生成状态→重建未终局队列并使旧fence失效→只读验收作品和下载权限→小流量恢复新写。未与渠道对账前不重新履约或重新提交付费模型。

每月预发演练、每季度完整一致性演练；记录备份点、恢复耗时、账本汇总、孤立对象、未完任务与删除重放。超过保留期的原片不能因备份恢复重新对用户可见。

## 5. 故障操作

| 故障 | 保护动作 | 恢复检查 |
|---|---|---|
| Redis丢失 | 暂停重复投递风暴，保留PG任务／账本 | jobs/outbox重建，租约fence递增，终态／输出唯一 |
| worker OOM | 降并发、隔离输入，不盲试同预算 | 单面像素／字体／缓存峰值检查，明确要求用户改规格 |
| 存储不可读 | 缺原片阻断，不回退缩略图 | 权限／profile版本／locator／hash恢复后重新预检 |
| 支付到账未履约 | 查单与原事件共用幂等事务 | 原订单唯一grant／lot，账单一致；客服不直接再送 |
| AI超时／限流 | 停新提交，查询原providerRequestId | 终态／预占／迟到费用核对，不跨模型重复付费 |
| 配置刷新失败 | 使用上一完整快照、标记陈旧、限新写 | 新测试hash和依赖一致后原子切换；不恢复已撤销key |
| 跨租户访问 | 停入口、撤销短期访问、保留脱敏审计 | 查所属／分享／签名边界，修复后负面回归 |

## 6. 监控与成本

核心仪表：API保存失败、CAS冲突、上传pending、导出排队／内存、任务失败和fence冲突、支付履约延迟、负点数／重复operation、AI估计与实际费用、存储活跃／回收／版本占用、备份失败和恢复耗时。初始阈值沿用v0.1：5xx>2%持续5分且有最小请求量、任务最老等待>10分、预算80%预警／100%停新付费、存储80%告警。

告警只发到经营者配置并验证的目的地；本次文档不发送任何外部消息。记录每有效生成成本、每本相册渲染和下载成本、用户原片／版本存储，价格决策不拿虚构账单推导。
