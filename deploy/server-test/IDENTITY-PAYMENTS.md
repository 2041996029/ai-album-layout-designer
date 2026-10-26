# 邮箱、微信与真实支付部署联调

开发代码包含真实协议适配器。以下配置在 `/www/wwwroot/HuaNian_SheJi` 的服务器上操作；不要向聊天发送密钥，不要把完成的配置提交 Git。旧 GitHub Pages 只有静态页面，不运行这些服务。

## 1. 数据库升级

先备份数据库、对象卷与现有配置。在旧版已初始化 C4 数据库上只运行一次新增的 `docs/release-v1.0/database/005_identity_payments.up.sql`，使用 `psql -v ON_ERROR_STOP=1 -f ...`。SQL 在事务内升级邮箱身份、支付宝渠道和验证码表，不清空现有数据。**不要重放 001 初始 SQL，不要 `down -v`。** 新空卷的 Docker PostgreSQL 镜像已包含 005。升级后重建 API/Web 镜像并重启；不要认为旧卷会自动执行新增 initdb SQL。

## 2. 邮箱与小程序

复制 `.integrations.env.example` 为 `.integrations.env`，权限 0600，填写：

| 字段                                    | 来源                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| EMAIL_SMTP_HOST / PORT / SECURE         | 邮件服务商，465 隐式 TLS 或 587 STARTTLS                             |
| EMAIL_SMTP_USER / PASSWORD / EMAIL_FROM | 发信账号、授权密码、已验证发信地址                                   |
| EMAIL_ENCRYPTION_SECRET                 | 本地随机生成的独立 32 字节以上密钥；保留备份，改变后旧邮箱密文不可读 |
| WECHAT_MINI_APP_ID / APP_SECRET         | 微信公众平台小程序开发管理                                           |
| WECHAT_OPEN_PLATFORM_ID                 | 可选，实际绑定的开放平台范围；不确定时留空                           |

Compose 自动读取该文件。SMTP TLS 校验保持开启，禁止把邮箱密码写入 VITE_*、小程序配置或仓库。先验证发信域名 SPF/DKIM 等服务商要求。验证码五分钟过期、最多五次猜测、每邮箱每分钟一次/每小时十次、每来源每小时三十次。入口使用 TCP 对端 IP；不盲信客户端 X-Forwarded-For。反向代理后会共享来源额度，需要由受信任入口控制发送流量，不能直接信任用户可伪造的转发头。

Web 从编辑器云工作区邮箱登录。首次验证自动创建账号。小程序首页提供：

- 已有 Web 账号：邮箱验证码 + 当前微信代码，绑定同一账号。
- 已有微信相册、尚无邮箱账号：打开“已用当前微信创建过相册”，为当前账号添加新的邮箱。
- 若双方已各自创建账号，返回绑定冲突，不自动合并资产。

配置小程序 `src/config.ts` 的 HTTPS API 域名及工作区；工作区 ID 必须属于登录后的账号，不能复制另一账号的 ID。新账号可在 Web 创建个人工作区，再填入测试工作区。微信开发者工具设置服务器合法域名并编译 TypeScript，代码中不放 AppSecret。

邮箱账号敏感操作使用邮箱重新验证，旧部署注入的 SMS 验证适配器仍保留；后台没有默认管理员。邮箱登录成功后仍需由受信任的服务器管理员授予原有平台角色，不能通过普通登录自提权。

## 3. 商户配置

复制 `payment-bindings.json.example` 至 `.integrations/payment-bindings.json`。目录 0700、文件 0600，属主 UID/GID 1000:1000（API 运行用户）；Compose 只读挂载 `/run/album-integrations`。在 `.integrations.env` 设置 `ALBUM_PAYMENT_BINDINGS_FILE=/run/album-integrations/payment-bindings.json`。PEM 填写真实内容并以 JSON `\n` 表示换行。

微信需要 AppID、商户号、商户私钥、商户证书序列号、API v3 密钥、平台公钥及其证书序列号/公钥 ID。API v3 密钥须恰为 32 字节。支付宝需要应用 AppID、卖家 seller_id、应用私钥、支付宝公钥（公钥模式）、开通当面付；证书模式需先转换为本实现支持的商户接入方式，不把应用公钥错当支付宝公钥。

Web 产品为微信 Native 扫码和支付宝当面付预创建；普通商户号不代表已开通对应产品。小程序虚拟商品渠道 `wechat_virtual` 保持原有独立准入，不由本文件开启。

**支付启用还要求配置中心已有合法发布的商品与支付版本。** 运行时文件只登记真实适配器，不伪造配置测试结果、发布记录或价格；本版提供可选单服务器加密密钥仓、受信任依赖清单及官方签名查单探测，默认关闭。未完成配置发布的空库可以联调邮箱和微信登录，购买继续显示未配置，不能仅填商户密钥就宣称全站商业服务已上线。现有服务器已有可信发布配置时，以下字段必须严格匹配：

- 主渠道 bindingId = 已发布 payment 配置版本 ID。
- 另一个渠道放入 payment.additionalChannels，bindingId = 主配置版本 ID + `:` + 渠道（例如 `:alipay`）。两渠道各有 credential、verificationKeyRef、callbackUrl 和 platformCapabilityRef，均经过原有发布校验，不共用支付宝/微信凭据。
- 运行时 appId、merchantId、credentialRef/Version、verificationKeyRef、notifyUrl 与该发布配置一致；商品价格、退款规则和权益仍以不可变快照为准。

### 配置中心首次发布

设置 `ALBUM_CONFIG_VAULT_ROOT=/var/lib/album/objects/.config-vault` 和独立 `ALBUM_CONFIG_VAULT_SECRET`，重启后现有受权限保护的密钥 API 使用加密文件仓（AES-GCM、版本独立、0600）。密钥仓与对象卷一起备份。先通过已有 `platform_ops` 账号、邮箱新鲜验证和 `/admin/secrets` API 写入商户私钥及验证公钥；记录返回的引用 ID 和版本。不要在 SQL 手填成功测试记录。

复制 `approved-dependencies.json.example` 到私有目录，**只有已实际开通并核对的商户产品与已审核退款政策**才填写 approved:true，并设置 `ALBUM_CONFIG_DEPENDENCIES_FILE`。该清单由服务器管理员维护，HTTP 用户无法自行声明商户权限。环境、ID 和版本必须与 payment.platformCapabilityRef、sku.refundPolicyRef 相同。

填妥运行时商户文件的凭据引用（与配置 payload 一致）后重启，通过既有 C4 管理 API 创建 SKU/payment 草稿、运行 schema/connection/capability 检查并发布。payment 的连接/能力测试会比较密钥仓私钥版本与注册适配器并执行官方签名查单，不创建收费订单；这证明凭据及签名查单通路，商户 Native/当面付权限仍以依赖清单审核和后续真实小额联调为准。两种渠道的探测必须都通过，才能发布同一支付配置。

发布后把运行时 bindingId 更新为实际发布的 payment 版本 ID（附加渠道加 `:alipay` 等后缀），重启，再查询公开 SKU/能力。保留已有角色、审计、幂等、新鲜验证和发布检查；没有默认管理员，也没有跳过验签的开关。

回调必须是公网 HTTPS，原样转发请求体与 Wechatpay-* 头，不加网站登录验证。支付宝通知为 application/x-www-form-urlencoded，成功返回裸字符串 `success`；微信成功返回 JSON `{code:"SUCCESS",message:"成功"}`。微信签名核验在 AES 解密之前，平台签名时间容差五分钟；服务器校时。

支付宝原路退款通过签名退款接口提交并查询原退款，**不接收通用退款通知作为成功事实**。后台既有恢复任务持续查询；微信另有验签退款回调。两者均以服务端确认发放/回收权益，不以扫码页面返回认定成功。Native 订单自动将内部 UUID 映射为 32 位商户订单号，回调还原。

## 4. 联调与轮换

按顺序验证：邮件收码 → Web 登录 → 小程序绑定 → 两端同一 userId → 单次小额购买 → 重复通知只履约一次 → 查单/关单 → 原路退款 → 重启后恢复任务继续。先使用有权限的测试商品与商户环境；无真实凭据时自动测试只证明协议与状态机，不能证明实际商户权限、邮件送达或资金到账。

保留历史订单所需的原始商户绑定。轮换配置使用新 bindingId 和独立 callbackChannel 别名（字母/数字/下划线/短横线），新回调 URL 指向相应别名，旧适配器、证书和回调保持到待支付/退款义务结束；同一路径不覆盖为另一版本。微信平台验签密钥独立于不可变订单绑定轮换：本版会合并同一 merchantId 下各绑定声明的 serial/公钥，也可在每个微信条目配置 platformKeys（serial → PEM 公钥）。切换前把新旧受信任平台公钥同时部署到所有历史绑定，供应商切换后历史查单和退款仍可验签；同一 serial 的冲突公钥会拒绝启动，未知 serial 不会放行。新增支付版本仍使用新 bindingId，但不能只更新新绑定的验签能力而丢掉历史密钥。公开日志只输出内部错误码，不输出配置文件、私钥、验证码或完整邮箱。
