# AI 相册：全部模块研发交付包 v1.0

日期2026-10-21（北京时间）。本包将产品、配置、研发合同、界面、计划、测试和运维收敛到同一入口，覆盖首期全部模块。**这是可交接评审的研发资料包，产品代码尚未实施；真实微信、支付、AI和生产环境尚未联调。**

[完整ZIP下载](../AI相册-全模块研发交付包-v1.0.zip) · [研发手册PDF](AI相册-全模块研发手册-v1.0.pdf) · [可编辑Word](AI相册-全模块研发手册-v1.0.docx) · [离线阅读](review.html) · [19页原型册](全部页面原型册-v1.0.pdf) · [原型索引](ux/README.md)

## 从哪里开始

1. 阅读[统一产品基线](01-产品与模块基线.md)与[共同合同](CONTRACT-RULES.md)，明确网页完整编辑、小程序快速成册、会员点数及AI创作的边界。
2. 按[需求追踪表](requirements.csv)核对49项需求对应的页面、API、计划任务和验收；App预留是接口要求，不虚构App页面。
3. 阅读[架构与集成](02-架构与集成合同.md)、[状态机与一致性](03-状态机与一致性.md)，再使用机器合同与数据库设计。
4. 按[执行索引](04-实施与交接索引.md)逐单元实施；记录真实验证结果，完成[发布清单](06-发布准出清单.md)。

## 交付清单

| 部分 | 交付内容 | 入口 |
|---|---|---|
| 产品与范围 | 全模块统一规格、默认值、范围外、权威顺序、决策／外部接入 | [基线](01-产品与模块基线.md)、[决策](07-决策与接入清单.md) |
| 需求追踪 | 49项需求映射页面／接口／计划／用例 | [requirements.csv](requirements.csv) |
| API | OpenAPI3.1，155操作／134路径，类型、错误、权限、CAS、幂等和回调 | [openapi.yaml](contracts/openapi.yaml)、[接入说明](contracts/API-GUIDE.md)、[操作索引](contracts/operations.csv) |
| 业务数据合同 | 文档／排版／配置／导出／provider，5份draft2020-12 schema；含21类配置值覆盖20域 | [schemas](contracts/schemas)、[语义说明](contracts/SCHEMA-GUIDE.md)、[有效与无效样例](contracts/examples) |
| 数据库 | 92表完整字段字典、203 FK的ERD、初始up／受保护down、事务边界及可复现SQL断言 | [数据库字典](database/data-dictionary.md)、[up](database/001_initial.up.sql)、[down](database/001_initial.down.sql)、[ERD](database/erd.mmd)、[事务](database/transaction-safety.md) |
| 页面与权限 | 65页面／390状态、54动作×10角色、全页流程、历史15张＋新增4张原创原型 | [页面索引](ux/README.md)、[状态CSV](ux/pages.csv)、[权限](ux/permissions.csv)、[原型预览](ux/preview.html) |
| 实施计划 | C1–C5＋C6发布验收，44任务／220个可勾执行步骤 | [实施索引](04-实施与交接索引.md) |
| 内容设计 | 33滤镜数值／配方、5类原创模板槽位、3类原创水墨彩绘提示词草案 | [内容目录](content/README.md) |
| 测试 | 73业务验收＋155 API合同测试项、故障／真机／视觉／容量策略 | [策略](testing/TEST-STRATEGY.md)、[业务案例](testing/cases.csv)、[API案例](testing/api-contract-cases.csv) |
| 运维 | 环境变量schema、无秘密.env示例、未来应用集成Compose、发布／回滚／恢复／告警手册 | [运行手册](operations/deployment-runbook.md)、[环境schema](operations/environment.schema.json)、[环境示例](operations/.env.example)、[Compose设计](operations/compose.review.yaml) |
| 可复核证据 | 文档／引用／样本校验、隔离PG实际执行、SHA清单 | [文档校验](verification/artifact-checks.json)、[SQL执行](verification/sql-execution.json)、[manifest](manifest.json)、[校验脚本](tools/validate_bundle.py) |

## 模块交付顺序

C1网页编辑与真实导出→C2整本排版→C3身份／云素材／小程序→C4可靠队列／配置／商业→C5生成与运营。C6贯穿集成、恢复与最终发布；不在C1结束时冒充完整产品。工作区权限、资源版本、任务事实源和账本跨模块共用，不复制第二套存储路径或余额。

## 已完成和仍需真实执行的边界

本次完成文档与设计合同，运行了合同语法／引用／示例检查，并在隔离PostgreSQL执行迁移、39个预期拒绝断言、合法夹具与受保护down/up。具体版本、SHA和范围以verification文件为准；PG16记录是最终jpeg/zip修订前版本，最终SQL以PG17复核。

未执行产品单元／E2E／性能／真机／真实供应商测试，未构建生产镜像或上线服务。测试CSV统一planned_not_executed，实施checkbox未勾；SQL结构验证不证明跨供应商、真实并发或支付协议已实现。

后台根前缀＋用户逻辑素材目录按暂定基线写全；供应商、价格、主体资质、部署预算及正式保留政策在[决策清单](07-决策与接入清单.md)记录，相关能力配置不齐时有明确unconfigured行为。BYOS／BYOK、专业印刷、多人实时协同和App安装包不在首期。

Word／PDF是主研发手册，机器合同、完整数据库逐列字典、CSV和原型源文件以同包独立文件为权威，避免数万行OpenAPI／SQL被截断或只剩图片。ZIP保留docs目录结构与历史资料，离线链接可按原相对路径访问。
