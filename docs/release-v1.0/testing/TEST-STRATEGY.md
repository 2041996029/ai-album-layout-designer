# 全模块测试策略与证据规则

## 1. 测试资产

[需求追踪](../requirements.csv)49项统一需求；[业务验收](cases.csv)73项（49个主验收＋24个竞态／故障／边界）；[API操作合同测试](api-contract-cases.csv)逐项覆盖全部155个操作。它们是待执行测试设计，不把文档编制当作产品通过。

contracts/examples和invalid-cases提供结构／语义样本；tools/validate_bundle.py实际运行文档合同校验。database/contract-checks.sql在隔离PG执行39个预期拒绝断言与合法样本，证据范围见transaction-safety.md。SQL检查不能代替API授权、并发账本、供应商或真机联调。

## 2. 测试分层与模式

| 层次 | 输入／执行 | 证据要求 |
|---|---|---|
| 合同／静态 | OpenAPI3.1、schema meta、全部$ref、有效与无效JSON、CSV追踪、计划／页面ID、SQL解析 | 校验器版本／命令／结果及SHA；只证明对应合同属性 |
| 模型／规则 | C1文档、方向／crop／滤镜／文字／几何、C2容量／manifest | 确定fixture、seed、输入／预期、失败与修复；非法输入必须拒绝 |
| 数据集成 | 空库up／down、唯一约束、事务回滚、CAS／fence／预占、Outbox、去重 | 真实隔离PG／Redis／对象模拟，记录版本与负面断言；不能对生产库运行 |
| API／安全 | 逐155操作的有效请求、缺字段／类型错误、匿名／错角色／跨租户、CSRF、CAS、幂等 | 预期HTTP／error.code、请求号，禁止在证据存token／原片 |
| 端到端 | mini→web→导出，会员→订单→回调→权益，AI报价→结果→入册 | 明确mock/sandbox/live，基线快照及产物hash；mock不能满足真实准入关口 |
| 视觉／设备 | 中文禁则／肤色／色卡／透明／裁剪、浏览器／微信真机 | 固定字体／renderer，截图、人工结果、实际系统／基础库／设备型号 |
| 性能／恢复 | 阶梯会话、耐久、OOM／限流、备份、队列重建、删除重放 | 实际硬件、样本、负载、耗时／峰值、失败、费用与RPO／RTO |

## 3. API操作级测试生成规则

api-contract-cases.csv为每operation标出method/path、权限分支、必要headers、request schema、成功／失败HTTP及需求。实现时依OpenAPI生成或手写用例，必须包括：最小合法请求、边界合法值、缺必填／错误类型／未知额外字段、401与403、存在但跨工作区资源、过期proof/token。带CAS写入测缺失428／陈旧409；幂等创建测同输入回放和不同输入409。callbacks用原始字节有效签名／篡改／重放／商户金额不匹配，不套Cookie鉴权；公开QR轮询仍需browserNonce／scene绑定。

只有适用才测该分支；不能给公开health构造虚假的必须401，不能给无CAS只读GET强制要求If-Match。业务状态／照片完整性／许可／预算等错误必须在结构校验后再测，不能以JSON Schema成功代替事务通过。

## 4. 渲染黄金样本

至少含横竖混合、EXIF6/8、暗部高光、肤色、灰阶／色卡、透明PNG、细线、长中文、标点、中英混排、组合字符、已知缺字、两种字体400/700。33滤镜强度0／.5／1，固定seed和tile边界；强度0字节直通，tile拼接等于整图。照片先归一方向、滤镜再crop与缩放，预览不采用另一套CSS效果。

PNG／JPEG重新解码验证尺寸；PNG pHYs、JPEG JFIF密度、PDF页数／MediaBox／TrimBox／BleedBox、singlePage／spread和独立封面分别检查。600×300mm／300DPI／3mm出血要求7157×3614。图像相同环境像素hash应重复一致；JPEG有损与跨浏览器边缘不做错误字节承诺。SSIM建议稳定区域≥.99，但漏字／漏片／页序错误无论分数都拒绝。

## 5. 浏览器与mini真机

桌面Chrome／Edge最近两大版本，Safari最近两大版本列兼容验证；正式版本填入真实矩阵。小程序当前稳定与确定最低基础库，Android低／中／高内存档、较旧／当前iPhone；覆盖弱网、微信权限拒绝、后台切换、上传中断、支付能力差异、切端任务找回。模拟器和API mock不等于真机结果。

## 6. 容量与发布关口

初始测试阶梯1→10→50→100活跃会话，每级15分钟稳定段、混合负载2小时耐久；200照片规则排版、50／200／500照片输入、最多100内页逐面导出。记录p50/p95/p99、错误率、队列等待、CPU／内存峰值、存储与供应商费用；用契约模拟做供应商限流压力，不轰击付费API。

沿用目标：普通API p95<500ms、保存<1s、拖动≥30FPS、小程序已有预览首屏<3s（20Mbps下行）、200照片规则候选<30s、20跨页300DPI处理<180s（8vCPU/16GB目标worker，排队另计）。这些是待验证预算，实际达不到就调整规格／资源和产品承诺，不能在报告里改成功。

准出：P0全通过；P1无未评估高风险；无作品丢失／跨租户访问／重复扣点／履约／负余额；真实微信／支付／AI链路和许可／标识核验；备份恢复／删除重放；平台能力和隐私政策；灰度／监控／回滚可执行。未准入的可选能力须明确disabled且不进入对外发布范围。

## 7. 报告格式

每条结果包括testId、requirementIds、commit、environment、serviceMode、inputFixtureHash、versions、startedAt/finishedAt（UTC）、status、actual、expected、evidencePaths、request/job/order IDs脱敏、knownLimitations。status只能passed/failed/blocked_external/skipped，后两者不能当通过。报告不存在时用planned_not_executed清单，不生成虚构运行数据。
