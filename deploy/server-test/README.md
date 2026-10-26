# 华年设计 · 完整源码与服务器搭建测试

本目录是当前 C4 代码的**单机测试部署入口**。目标目录：`/www/wwwroot/HuaNian_SheJi`。由你的本地 Codex 在服务器上执行；云端开发会话不远程操作服务器。

## 交付内容与当前能力

源码包含网页编辑器、96 个原创跨页、模板导入、滤镜、图片/PDF 本地导出、C3/C4 API、后台运营控制台、任务与财务内核、共享包、真实 SQL、测试和锁文件。不是只有前端 dist。

这个测试栈启动 Nginx、Node24 API、PostgreSQL17、Redis7；同源访问编辑器、后台与 `/v1`，数据库/Redis/对象文件用独立 Docker 命名卷保存。API 使用现有 `dev` 本地存储模式。

**重要边界：** 新空库没有账号、角色、已发布商品或配置，也没有默认管理员密码。登录、二次验证、真实支付、私有云存储、云端渲染器及 AI 供应商需要部署适配器与相应配置。仅添加随意命名的环境变量不会启用它们。本包不增加登录后门，不模拟收款成功，不把未接入 AI 的规则排版说成生成式 AI。可以先验收编辑器、本地导出、后台布局、API 能力与权限拒绝；认证后的云业务须接上可信适配器后再验收。该栈不宣称生产就绪。

## 服务器前置条件

- Linux，Docker Engine 与 Docker Compose v2；初始化脚本需要 Node.js 24（仅初始化，不要求在宿主机安装 npm 依赖）。
- 建议至少 4 核 / 8 GiB 内存 / 15 GiB 空闲磁盘；实际容量按照片和任务负载测量。
- 允许访问 Docker Hub、npm registry；镜像和依赖下载失败时保留完整错误，不关闭 TLS 验证。
- 宝塔仅负责域名、HTTPS、反向代理。不要同时让宝塔与本测试栈占用同一个监听端口。
- 域名、证书、供应商账号与密钥由经营者提供；不要把秘密粘贴进聊天或提交 Git。

## 给本地 Codex 的交接提示

> 请在 `/www/wwwroot/HuaNian_SheJi` 搭建此仓库的 server-test 栈。先检查目录、现有站点、监听端口、Docker 和磁盘；保留已有文件、数据库与密钥，不删除或重建卷。读取本说明、compose.yaml、Dockerfile 和 .env.example。确认访问域名或仅本机测试；初始化缺失密钥，校验 Compose，构建后启动并等待健康。按照下方验收清单逐项验证，敏感输出脱敏。失败时记录具体步骤与完整错误后停止，不通过关闭 TLS、绕过权限或创建登录后门来让检查通过。生产上线和真实渠道联调需另行验收。

## 1. 上传或拉取完整源码

把源码 ZIP 解压后，确认以下文件直接位于目标目录，避免出现重复套目录：

```text
/www/wwwroot/HuaNian_SheJi/
  package.json
  package-lock.json
  apps/
  packages/
  deploy/server-test/
  docs/release-v1.0/database/
```

也可以由本地 Codex 克隆当前交付分支/提交。若目录非空，先辨认原项目和备份，不覆盖未知文件。定制 ZIP 带 `DEPLOYMENT-MANIFEST.json` 与独立 `.sha256`，用于核对内容；GitHub 自动源码 ZIP 则以提交号为依据。

## 2. 初始化私有配置

在项目根目录执行；本机测试默认监听 `127.0.0.1:8080`：

```bash
cd /www/wwwroot/HuaNian_SheJi
node deploy/server-test/init-env.mjs
```

若通过宝塔域名测试，在首次初始化时传**最终浏览器访问来源**：

```bash
node deploy/server-test/init-env.mjs --origin https://design.example.com --port 8080
```

将示例域名替换成实际域名。来源不得带 `/admin/`、路径、查询或凭据。HTTP 本机默认是 `http://127.0.0.1:8080`；`localhost` 与 `127.0.0.1` 是不同来源，访问时必须匹配。

脚本生成 `deploy/server-test/.env` 与 `.secrets/` 下的数据库密码、会话签名、对象签名及兑换保护值，不展示明文；文件权限为仅所有者可读写。重复运行保留原配置和秘密。已有来源与新参数冲突时明确拒绝覆盖，请核对后编辑 `.env`；**不要删除密钥来修改来源**。

`.env.example` 只有非秘密示例。实际 `.env` 和 `.secrets` 不上传 Git、不进入源码包。备份、迁移服务器时需以私有方式保留它们，否则旧会话、签名链接及兑换保护会失效。

## 3. 构建并启动

```bash
docker compose --env-file deploy/server-test/.env -f deploy/server-test/compose.yaml config --quiet
docker compose --env-file deploy/server-test/.env -f deploy/server-test/compose.yaml build
docker compose --env-file deploy/server-test/.env -f deploy/server-test/compose.yaml up -d --wait --wait-timeout 180
```

不要去掉 `config --quiet` 的 `--quiet` 后把结果公开；部署配置和日志仍应按敏感数据处理。

PostgreSQL **仅在全新空数据卷**执行初始合同、C3 运行表和 002/003/004 SQL。重启与重新构建不会重新执行初始化，也不会升级已有数据库。已有数据的后续版本须先备份，再按交付的增量迁移执行，不能用 `down -v` 或删卷冒充升级。

## 4. 宝塔域名与 HTTPS

默认仅暴露本机 `127.0.0.1:8080`，不对公网开放数据库、Redis 或 API 端口。在宝塔创建对应域名的反向代理站点，目标为 `http://127.0.0.1:8080`；通过面板配置正式证书。

浏览器与 API 保持同源，宝塔反代保留原 `Origin`、Cookie 和请求头。不要重写 Origin 来绕过 CSRF 校验。`ALBUM_ORIGIN` 必须是浏览器实际使用的 `https://域名`。

访问入口：

- 编辑器：`https://域名/`
- 会员 / 任务：`https://域名/commerce.html`
- 后台：`https://域名/admin/`
- 能力接口：`https://域名/v1/capabilities?platform=web`

若仅本机测试，把域名替换为 `http://127.0.0.1:8080`。后台本身不是登录系统；未登录、未分配财务角色或未接入身份验证时，应显示对应提示并拒绝敏感操作。

## 5. 验收清单

1. `docker compose ... ps` 显示四个服务运行/健康。
2. 编辑器、commerce.html、admin/ HTTP 200，静态 JS/CSS 无 404，手机宽度能导航。
3. `/v1/capabilities?platform=web` HTTP 200；未接入的能力是 unconfigured，而不是假成功。
4. 导入自己的照片，应用模板、移动裁切、整册滤镜、本地保存/恢复、72DPI 小样导出。
5. 后台无权限时拒绝读取财务数据；空表不伪造订单和营业额。
6. 正常 restart 后，数据库和对象卷仍存在，秘密文件摘要未变化；确认没有跑删除卷命令。
7. 接入身份/支付/渲染适配器后，再单独执行真实授权、云保存、导出队列、订单、验证码、退款与对账验收。当前默认栈不能替代这些联调。

## 6. 诊断、备份、升级与停止

```bash
docker compose --env-file deploy/server-test/.env -f deploy/server-test/compose.yaml ps
docker compose --env-file deploy/server-test/.env -f deploy/server-test/compose.yaml logs --tail=100 api web
# 数据库备份输出文件须保存在受限、可恢复的位置：
docker compose --env-file deploy/server-test/.env -f deploy/server-test/compose.yaml exec -T postgres pg_dump -U album album_dev > /受限备份目录/album-backup.sql
# 正常停止，保留数据卷：
docker compose --env-file deploy/server-test/.env -f deploy/server-test/compose.yaml stop
```

日志和备份可能含业务数据，分享前脱敏。源码更新前记录提交号并备份数据库/私有配置/对象卷。新版本先在隔离测试库验收；有迁移时按其说明前向升级。代码回退不能删除财务事实或自动执行 down SQL。

测试结束前由你确认保留或清理资源；本说明不自动删除卷、站点或照片。需要改成生产架构时，独立配置身份、最小数据库权限、HTTPS、安全 Cookie、真实对象存储、密钥服务、渲染 worker、限额和备份恢复。

本测试镜像的应用源码由运行用户持有，以兼容来源文件权限；生产容器还需将应用代码改为只读／root 所有，并单独授予对象存储写权限。
