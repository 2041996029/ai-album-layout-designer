# 数据字典（v1.0 设计合同）

2026-10-21；继承 v0.1 架构实体与 v0.4 配置、目录、AI 增补。本文与迁移共同定义设计；不是已部署服务。
共 **92 张表**。跨身份、租户、不可变内容、配置版本、财务、供应商成本、任务、分享与运维归一化拆分；数量大于60是为避免将订单、尝试、回调、点数、采购成本和任务合并为无法约束的 JSON。首期可按模块实施，但首个生产数据库不得只落部分财务约束。
## 类型、所有权和引用约定

- `opaque_id` 是带 1–128 Unicode 字符约束的 PostgreSQL `text` domain；不是 UUID，不解析 ID 前缀。全部主键均为此类型，无自增。`safe_uint` 是 `bigint`，范围 0–9007199254740991；对外 JSON 永远不超过此界限。`sha256_hex` 为64位小写十六进制。
- 所有 `created_at` 默认 `now()`，时间列均 `timestamptz`；会话设置 UTC，驱动按 UTC 序列化。PostgreSQL 存储瞬时值，预算日 `date` 是按 Asia/Shanghai 计算后的业务日。
- 每表 `id` 主键和 `created_at` 创建时间不可改。含 `workspace_id` 的业务表同时 UNIQUE(workspace_id,id)，所有其下租户资源采用复合 FK，禁止单改 workspace 进行迁移。审计/墓碑/幂等等可含可空 workspace，表示平台或个人作用域，不作为资源越权入口。
- `workspace_members.role` 只授工作区角色，`admin_role_assignments` 为独立平台 RBAC。owner 成员与 workspaces.owner_user_id 的一致性在持有工作区锁的事务内保证。平台字体/模板的字节放入专用 kind=platform 工作区；用户引用全局已授权版本，不获得该工作区访问权。
- `body/manifest/features/recipe/layout_json` 等 JSON 仅承载有独立 JSON Schema 的可变结构；金额、状态、版本、归属、引用与关键索引均为关系列。JSON Schema、授权、大小限制和 manifest 引用一致性由服务验证，SQL 的 object/array CHECK 不替代它们。
- `revision` 为 bigint 乐观锁字段；应用接受十进制字符串 If-Match，按 expectedRevision 条件更新。job 的状态 trigger 额外要求每次 revision+1；其他表需服务执行 CAS。项目 `current_revision` 是版本序号而非公开 ID。
- 所有 FK 默认 NO ACTION、不级联删财务/作品。不可变表在 UPDATE/DELETE 时拒绝；TRUNCATE 和所有者禁用 trigger 不在业务权限内。不可变记录的到期脱敏/清除需单独维护权限和审计迁移。
- `secret_references` 仅存密钥服务 locator、版本、用途、状态；不存密码、token、微信 session_key、支付凭据。会话和分享 token、兑换码只存摘要；外部身份 subject 用带服务端 pepper 的稳定摘要匹配，pepper 的版本及可回收加密映射由秘密服务托管，账户删除时同步销毁。
- 状态 CHECK 限制可用值；除 jobs 明确状态 trigger 外，跨表状态机、金额相等、支付验签、时效和授权均由事务服务实施，详见 transaction-safety.md。`config_tests`、`backup_runs` 是将来运行证据表，不是本次测试记录。

## 表和字段

以下逐列列出精确类型、NOT NULL 和默认值；`id`/`created_at` 在每表显式列出。唯一键、CHECK、FK 的权威表达式在相邻 SQL，ERD 展示所有 FK。
### `users`

内部用户与去标识状态。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `status` | `text NOT NULL DEFAULT 'active'` |
| `display_name` | `text NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |
| `last_login_at` | `timestamptz` |
| `deleted_at` | `timestamptz` |

关系与唯一性：`CHECK (status IN ('active','suspended','deleting','deleted'))`; `CHECK (char_length(display_name) BETWEEN 1 AND 120)`; `CHECK (revision > 0)`。

### `auth_identities`

外部身份；加密映射保管于秘密服务，匹配仅用摘要。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `user_id` | `opaque_id NOT NULL` |
| `provider` | `text NOT NULL` |
| `app_id` | `text NOT NULL` |
| `subject_digest` | `sha256_hex NOT NULL` |
| `union_scope` | `text` |
| `union_digest` | `sha256_hex` |
| `verified_at` | `timestamptz NOT NULL` |
| `revoked_at` | `timestamptz` |

关系与唯一性：`CHECK (provider IN ('wechat_mini','wechat_web','phone','app_reserved'))`; `CHECK ((union_scope IS NULL) = (union_digest IS NULL))`; `UNIQUE (provider, app_id, subject_digest)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `auth_sessions`

网页 cookie／小程序 bearer 的服务器会话。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `user_id` | `opaque_id NOT NULL` |
| `client_kind` | `text NOT NULL` |
| `refresh_hash` | `sha256_hex NOT NULL` |
| `csrf_hash` | `sha256_hex` |
| `expires_at` | `timestamptz NOT NULL` |
| `revoked_at` | `timestamptz` |
| `rotated_from_id` | `opaque_id` |

关系与唯一性：`CHECK (client_kind IN ('web','mini','app_reserved'))`; `CHECK (expires_at > created_at)`; `UNIQUE (refresh_hash)`; `FOREIGN KEY (user_id) REFERENCES users(id)`; `FOREIGN KEY (rotated_from_id) REFERENCES auth_sessions(id)`。

### `auth_challenges`

二维码、登录和再认证一次性挑战。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `user_id` | `opaque_id` |
| `kind` | `text NOT NULL` |
| `token_hash` | `sha256_hex NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending'` |
| `expires_at` | `timestamptz NOT NULL` |
| `consumed_at` | `timestamptz` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (kind IN ('web_qr','login','binding','deletion'))`; `CHECK (state IN ('pending','confirmed','consumed','expired','cancelled'))`; `CHECK (expires_at > created_at)`; `CHECK (revision > 0)`; `UNIQUE (token_hash)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `binding_requests`

绑定需现有身份再认证；身份冲突不自动合并。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `user_id` | `opaque_id NOT NULL` |
| `challenge_id` | `opaque_id NOT NULL` |
| `provider` | `text NOT NULL` |
| `app_id` | `text NOT NULL` |
| `subject_digest` | `sha256_hex NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending'` |
| `expires_at` | `timestamptz NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (state IN ('pending','bound','conflict','expired','cancelled'))`; `CHECK (expires_at > created_at)`; `CHECK (revision > 0)`; `FOREIGN KEY (user_id) REFERENCES users(id)`; `FOREIGN KEY (challenge_id) REFERENCES auth_challenges(id)`。

### `account_deletion_requests`

账号删除工作流与法定留存检查。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `user_id` | `opaque_id NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'requested'` |
| `not_before` | `timestamptz NOT NULL` |
| `confirmed_at` | `timestamptz` |
| `completed_at` | `timestamptz` |
| `reason_code` | `text NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (state IN ('requested','confirmed','blocked','executing','completed','cancelled'))`; `CHECK (not_before >= created_at)`; `CHECK (revision > 0)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `workspaces`

稳定资源归属；成员变动不改变资产 workspace。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `owner_user_id` | `opaque_id NOT NULL` |
| `kind` | `text NOT NULL` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'active'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |
| `deleted_at` | `timestamptz` |

关系与唯一性：`CHECK (kind IN ('personal','studio','platform'))`; `CHECK (state IN ('active','suspended','deleting','deleted'))`; `CHECK (char_length(name) BETWEEN 1 AND 120)`; `CHECK (revision > 0)`; `FOREIGN KEY (owner_user_id) REFERENCES users(id)`。

### `workspace_members`

成员角色；唯一 owner 与席位由事务服务保证。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `user_id` | `opaque_id NOT NULL` |
| `role` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'active'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (role IN ('owner','admin','designer','viewer'))`; `CHECK (state IN ('invited','active','removed'))`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, user_id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `workspace_settings`

空间偏好不能提升平台配额。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |
| `default_width_mm` | `numeric(10,4) NOT NULL DEFAULT 300` |
| `default_height_mm` | `numeric(10,4) NOT NULL DEFAULT 300` |
| `share_enabled` | `boolean NOT NULL DEFAULT false` |
| `notification_enabled` | `boolean NOT NULL DEFAULT true` |
| `settings_json` | `jsonb NOT NULL DEFAULT '{}'` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (revision > 0)`; `CHECK (default_width_mm > 0 AND default_width_mm <= 2000)`; `CHECK (default_height_mm > 0 AND default_height_mm <= 2000)`; `CHECK (jsonb_typeof(settings_json) = 'object')`; `UNIQUE (workspace_id)`。

### `user_preferences`

个人界面偏好。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `user_id` | `opaque_id NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |
| `locale` | `text NOT NULL DEFAULT 'zh-CN'` |
| `display_timezone` | `text NOT NULL DEFAULT 'Asia/Shanghai'` |
| `preferences_json` | `jsonb NOT NULL DEFAULT '{}'` |

关系与唯一性：`CHECK (revision > 0)`; `CHECK (jsonb_typeof(preferences_json) = 'object')`; `UNIQUE (user_id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `secret_references`

秘密版本引用；从不存原始密钥。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `secret_ref` | `text NOT NULL` |
| `secret_version` | `text NOT NULL` |
| `purpose` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'available'` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (state IN ('available','revoked','retired'))`; `CHECK (char_length(secret_ref) BETWEEN 1 AND 512)`; `CHECK (char_length(secret_version) BETWEEN 1 AND 128)`; `UNIQUE (environment, secret_ref, secret_version)`; `UNIQUE (id, environment)`。

### `admin_role_assignments`

平台最小权限管理员。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `user_id` | `opaque_id NOT NULL` |
| `role` | `text NOT NULL` |
| `expires_at` | `timestamptz` |
| `revoked_at` | `timestamptz` |

关系与唯一性：`CHECK (role IN ('platform_ops','finance','content','support','auditor'))`; `UNIQUE (user_id, role)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `config_drafts`

动态配置草稿 CAS；发布前 schema 与连接测试。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `namespace` | `text NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |
| `schema_version` | `integer NOT NULL DEFAULT 1` |
| `body` | `jsonb NOT NULL` |
| `body_hash` | `sha256_hex NOT NULL` |
| `updated_by` | `opaque_id NOT NULL` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (revision > 0)`; `CHECK (schema_version > 0)`; `CHECK (jsonb_typeof(body) = 'object')`; `UNIQUE (environment, namespace)`; `FOREIGN KEY (updated_by) REFERENCES users(id)`; `UNIQUE (id, environment)`。

### `config_releases`

不可变配置发布；回滚是发布新指针。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `release_number` | `bigint NOT NULL` |
| `schema_version` | `integer NOT NULL` |
| `manifest_hash` | `sha256_hex NOT NULL` |
| `manifest` | `jsonb NOT NULL` |
| `published_by` | `opaque_id NOT NULL` |
| `previous_release_id` | `opaque_id` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (release_number > 0)`; `CHECK (schema_version > 0)`; `CHECK (jsonb_typeof(manifest) = 'object')`; `UNIQUE (environment, release_number)`; `FOREIGN KEY (published_by) REFERENCES users(id)`; `UNIQUE (id, environment)`; `FOREIGN KEY (previous_release_id, environment) REFERENCES config_releases(id, environment)`。

### `config_active_releases`

每环境原子生效指针。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `release_id` | `opaque_id NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (revision > 0)`; `UNIQUE (environment)`; `FOREIGN KEY (release_id, environment) REFERENCES config_releases(id, environment)`。

### `config_release_items`

发布中命名空间不可变快照。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `release_id` | `opaque_id NOT NULL` |
| `namespace` | `text NOT NULL` |
| `schema_version` | `integer NOT NULL` |
| `body_hash` | `sha256_hex NOT NULL` |
| `body` | `jsonb NOT NULL` |

关系与唯一性：`CHECK (schema_version > 0)`; `CHECK (jsonb_typeof(body) = 'object')`; `UNIQUE (release_id, namespace)`; `FOREIGN KEY (release_id) REFERENCES config_releases(id)`。

### `config_tests`

明确测试目标 hash；报告不伪称已执行样图。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `draft_id` | `opaque_id` |
| `release_id` | `opaque_id` |
| `subject_kind` | `text NOT NULL` |
| `subject_id` | `opaque_id NOT NULL` |
| `subject_hash` | `sha256_hex NOT NULL` |
| `test_kind` | `text NOT NULL` |
| `state` | `text NOT NULL` |
| `report` | `jsonb NOT NULL` |
| `estimated_cost_fen` | `safe_uint NOT NULL DEFAULT 0` |
| `actual_cost_fen` | `safe_uint NOT NULL DEFAULT 0` |
| `executed_by` | `opaque_id NOT NULL` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (test_kind IN ('schema','connection','capability','sample','storage_roundtrip'))`; `CHECK (state IN ('passed','failed','cleanup_required'))`; `CHECK (jsonb_typeof(report) = 'object')`; `FOREIGN KEY (executed_by) REFERENCES users(id)`; `FOREIGN KEY (draft_id, environment) REFERENCES config_drafts(id, environment)`; `FOREIGN KEY (release_id, environment) REFERENCES config_releases(id, environment)`。

### `audit_events`

追加审计；禁止原图、完整提示词、密钥及令牌。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id` |
| `actor_user_id` | `opaque_id` |
| `action` | `text NOT NULL` |
| `target_kind` | `text NOT NULL` |
| `target_id` | `opaque_id` |
| `request_id` | `opaque_id NOT NULL` |
| `reason` | `text NOT NULL` |
| `redacted_details` | `jsonb NOT NULL DEFAULT '{}'` |

关系与唯一性：`CHECK (jsonb_typeof(redacted_details) = 'object')`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `FOREIGN KEY (actor_user_id) REFERENCES users(id)`。

### `license_versions`

字体、模板、模型与示例的不可变授权证据。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `license_key` | `text NOT NULL` |
| `version` | `integer NOT NULL` |
| `source_uri` | `text NOT NULL` |
| `terms_hash` | `sha256_hex NOT NULL` |
| `commercial_allowed` | `boolean NOT NULL` |
| `embedding_allowed` | `boolean NOT NULL DEFAULT false` |
| `reference_input_allowed` | `boolean NOT NULL DEFAULT false` |
| `valid_from` | `timestamptz NOT NULL` |
| `valid_until` | `timestamptz` |
| `territories` | `text[] NOT NULL` |
| `restrictions` | `jsonb NOT NULL DEFAULT '{}'` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (valid_until IS NULL OR valid_until > valid_from)`; `CHECK (jsonb_typeof(restrictions) = 'object')`; `UNIQUE (license_key, version)`。

### `storage_profiles`

稳定存储连接身份；旧版本只读保留。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (state IN ('draft','active','readonly','retired'))`; `CHECK (revision > 0)`; `UNIQUE (environment, name)`; `UNIQUE (id, environment)`。

### `storage_profile_versions`

不可变存储定位配置，不随新根前缀改写旧对象。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `profile_id` | `opaque_id NOT NULL` |
| `version` | `integer NOT NULL` |
| `environment` | `text NOT NULL` |
| `provider` | `text NOT NULL` |
| `adapter_version` | `text NOT NULL` |
| `region` | `text NOT NULL` |
| `endpoint` | `text NOT NULL` |
| `bucket` | `text NOT NULL` |
| `base_prefix` | `text NOT NULL` |
| `key_pattern_version` | `text NOT NULL DEFAULT 'v1'` |
| `secret_reference_id` | `opaque_id NOT NULL` |
| `public_access` | `boolean NOT NULL DEFAULT false` |
| `download_ttl_seconds` | `integer NOT NULL DEFAULT 300` |
| `upload_ttl_seconds` | `integer NOT NULL DEFAULT 900` |
| `encryption_mode` | `text NOT NULL` |
| `allowed_origins` | `text[] NOT NULL DEFAULT '{}'` |
| `capabilities` | `jsonb NOT NULL DEFAULT '{}'` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (provider IN ('oss','cos','s3'))`; `CHECK (environment IN ('dev','staging','prod'))`; `CHECK (endpoint ~ '^https://')`; `CHECK (char_length(base_prefix) BETWEEN 1 AND 256 AND base_prefix !~ '(^/|\.\.|[[:cntrl:]])' AND position(chr(92) in base_prefix) = 0)`; `CHECK (key_pattern_version = 'v1')`; `CHECK (NOT public_access)`; `CHECK (download_ttl_seconds BETWEEN 1 AND 3600)`; `CHECK (upload_ttl_seconds BETWEEN 1 AND 3600)`; `CHECK (encryption_mode IN ('providerManaged','kms'))`; `CHECK (jsonb_typeof(capabilities) = 'object')`; `UNIQUE (profile_id, version)`; `FOREIGN KEY (profile_id, environment) REFERENCES storage_profiles(id, environment)`; `FOREIGN KEY (secret_reference_id, environment) REFERENCES secret_references(id, environment)`。

### `storage_objects`

物理对象与定位；迁移创建新对象，资产 locator 条件切换。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `profile_version_id` | `opaque_id NOT NULL` |
| `bucket` | `text NOT NULL` |
| `object_key` | `text NOT NULL` |
| `object_version_id` | `text` |
| `kind` | `text NOT NULL` |
| `sha256` | `sha256_hex NOT NULL` |
| `byte_size` | `safe_uint NOT NULL` |
| `mime_type` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending'` |
| `locator_revision` | `bigint NOT NULL DEFAULT 1` |
| `verified_at` | `timestamptz` |
| `deleted_at` | `timestamptz` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (kind IN ('original','normalized','preview','document','font','template','generated','export','temporary'))`; `CHECK (state IN ('pending','verified','quarantine','deleting','deleted','missing'))`; `CHECK (locator_revision > 0)`; `CHECK (char_length(object_key) BETWEEN 1 AND 1024 AND object_key !~ '(^/|[[:cntrl:]])')`; `UNIQUE (profile_version_id, bucket, object_key)`; `FOREIGN KEY (profile_version_id) REFERENCES storage_profile_versions(id)`。

### `asset_folders`

逻辑目录；根为 NULL，NFC casefold 由事务服务计算。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `parent_id` | `opaque_id` |
| `name` | `text NOT NULL` |
| `normalized_name` | `text NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |
| `created_by` | `opaque_id NOT NULL` |
| `deleted_at` | `timestamptz` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (parent_id IS NULL OR parent_id <> id)`; `CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name) AND name NOT IN ('.','..') AND name !~ '[/[:cntrl:]]' AND position(chr(92) in name) = 0)`; `CHECK (char_length(normalized_name) BETWEEN 1 AND 240)`; `CHECK (revision > 0)`; `FOREIGN KEY (workspace_id, parent_id) REFERENCES asset_folders(workspace_id, id)`; `FOREIGN KEY (created_by) REFERENCES users(id)`。

### `assets`

稳定 assetId 与不可变字节内容；文件夹/定位可事务更新。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `folder_id` | `opaque_id` |
| `original_object_id` | `opaque_id` |
| `original_filename` | `text NOT NULL` |
| `sha256` | `sha256_hex` |
| `byte_size` | `safe_uint NOT NULL` |
| `width` | `integer` |
| `height` | `integer` |
| `mime_type` | `text NOT NULL` |
| `origin` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending_upload'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |
| `deleted_at` | `timestamptz` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (byte_size BETWEEN 1 AND 25000000)`; `CHECK ((width IS NULL) = (height IS NULL))`; `CHECK (state NOT IN ('ready','trashed') OR (original_object_id IS NOT NULL AND sha256 IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL))`; `CHECK (width BETWEEN 1 AND 80000000 AND height BETWEEN 1 AND 80000000 AND width::bigint * height::bigint <= 80000000)`; `CHECK (mime_type IN ('image/jpeg','image/png'))`; `CHECK (origin IN ('upload','generated','import'))`; `CHECK (state IN ('pending_upload','pending_scan','quarantine','ready','rejected','trashed','missing','deleted'))`; `CHECK (revision > 0)`; `CHECK (char_length(original_filename) BETWEEN 1 AND 255)`; `FOREIGN KEY (workspace_id, folder_id) REFERENCES asset_folders(workspace_id, id)`; `FOREIGN KEY (workspace_id, original_object_id) REFERENCES storage_objects(workspace_id, id)`。

### `asset_variants`

归一化和预览不可变版本。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `asset_id` | `opaque_id NOT NULL` |
| `variant` | `text NOT NULL` |
| `storage_object_id` | `opaque_id NOT NULL` |
| `pipeline_version` | `text NOT NULL` |
| `width` | `integer NOT NULL` |
| `height` | `integer NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (variant IN ('normalized','preview','thumbnail'))`; `CHECK (width > 0 AND height > 0)`; `UNIQUE (workspace_id, asset_id, variant, pipeline_version)`; `FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id)`; `FOREIGN KEY (workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)`。

### `storage_usage_accounts`

物理字节占用投影；回收站仍计量。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `category` | `text NOT NULL` |
| `used_bytes` | `safe_uint NOT NULL DEFAULT 0` |
| `reserved_bytes` | `safe_uint NOT NULL DEFAULT 0` |
| `limit_bytes` | `safe_uint NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (category IN ('original','derived','document','generated','export'))`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, category)`。

### `storage_quota_reservations`

上传/产物并发容量预占。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `usage_account_id` | `opaque_id NOT NULL` |
| `operation_id` | `opaque_id NOT NULL` |
| `bytes` | `safe_uint NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'held'` |
| `expires_at` | `timestamptz NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (bytes > 0)`; `CHECK (state IN ('held','consumed','released','expired'))`; `CHECK (expires_at > created_at)`; `UNIQUE (workspace_id, operation_id)`; `FOREIGN KEY (workspace_id, usage_account_id) REFERENCES storage_usage_accounts(workspace_id, id)`。

### `upload_sessions`

受限上传凭据不入库；完成后 HEAD/magic/解码。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `asset_id` | `opaque_id NOT NULL` |
| `quota_reservation_id` | `opaque_id NOT NULL` |
| `profile_version_id` | `opaque_id NOT NULL` |
| `bucket` | `text NOT NULL` |
| `object_key` | `text NOT NULL` |
| `created_by` | `opaque_id NOT NULL` |
| `expected_bytes` | `safe_uint NOT NULL` |
| `expected_mime` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'issued'` |
| `expires_at` | `timestamptz NOT NULL` |
| `completed_at` | `timestamptz` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (expected_bytes BETWEEN 1 AND 25000000)`; `CHECK (expected_mime IN ('image/jpeg','image/png'))`; `CHECK (state IN ('issued','uploaded','verifying','ready','rejected','expired'))`; `CHECK (expires_at > created_at)`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, asset_id)`; `FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id)`; `FOREIGN KEY (workspace_id, quota_reservation_id) REFERENCES storage_quota_reservations(workspace_id, id)`; `FOREIGN KEY (profile_version_id) REFERENCES storage_profile_versions(id)`; `FOREIGN KEY (created_by) REFERENCES users(id)`。

### `trash_operations`

整批删除/恢复操作日志；有引用则整批拒绝。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `operation_id` | `opaque_id NOT NULL` |
| `created_by` | `opaque_id NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'trashed'` |
| `restore_until` | `timestamptz NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (state IN ('trashed','restored','purging','purged'))`; `CHECK (restore_until > created_at)`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, operation_id)`; `FOREIGN KEY (created_by) REFERENCES users(id)`。

### `trash_items`

恢复原父级与名称；资产和目录二选一。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `trash_operation_id` | `opaque_id NOT NULL` |
| `asset_id` | `opaque_id` |
| `folder_id` | `opaque_id` |
| `original_parent_id` | `opaque_id` |
| `original_name` | `text NOT NULL` |
| `expected_revision` | `bigint NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (num_nonnulls(asset_id, folder_id) = 1)`; `CHECK (expected_revision > 0)`; `FOREIGN KEY (workspace_id, trash_operation_id) REFERENCES trash_operations(workspace_id, id)`; `FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id)`; `FOREIGN KEY (workspace_id, folder_id) REFERENCES asset_folders(workspace_id, id)`; `FOREIGN KEY (workspace_id, original_parent_id) REFERENCES asset_folders(workspace_id, id)`。

### `storage_migrations`

人工确认后复制/校验/切换，旧副本单独清理。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `source_profile_version_id` | `opaque_id NOT NULL` |
| `target_profile_version_id` | `opaque_id NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'planned'` |
| `confirmed_by` | `opaque_id NOT NULL` |
| `estimated_bytes` | `safe_uint NOT NULL` |
| `estimated_cost_fen` | `safe_uint NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (source_profile_version_id <> target_profile_version_id)`; `CHECK (state IN ('planned','copying','verifying','switching','retaining','completed','failed','cancelled'))`; `CHECK (revision > 0)`; `FOREIGN KEY (source_profile_version_id) REFERENCES storage_profile_versions(id)`; `FOREIGN KEY (target_profile_version_id) REFERENCES storage_profile_versions(id)`; `FOREIGN KEY (confirmed_by) REFERENCES users(id)`。

### `storage_migration_items`

逐对象可恢复检查点；pin 仍引用原对象。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `migration_id` | `opaque_id NOT NULL` |
| `source_object_id` | `opaque_id NOT NULL` |
| `target_object_id` | `opaque_id` |
| `expected_locator_revision` | `bigint NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending'` |
| `verified_hash` | `sha256_hex` |
| `retain_source_until` | `timestamptz` |
| `error_code` | `text` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (state IN ('pending','copied','verified','switched','retained','cleaned','failed'))`; `CHECK (expected_locator_revision > 0)`; `CHECK (target_object_id IS NULL OR target_object_id <> source_object_id)`; `UNIQUE (workspace_id, migration_id, source_object_id)`; `FOREIGN KEY (workspace_id, migration_id) REFERENCES storage_migrations(workspace_id, id)`; `FOREIGN KEY (workspace_id, source_object_id) REFERENCES storage_objects(workspace_id, id)`; `FOREIGN KEY (workspace_id, target_object_id) REFERENCES storage_objects(workspace_id, id)`。

### `projects`

项目当前版本 CAS；创建事务必须插入 revision 1。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `name` | `text NOT NULL` |
| `current_revision` | `bigint NOT NULL DEFAULT 0` |
| `state` | `text NOT NULL DEFAULT 'active'` |
| `created_by` | `opaque_id NOT NULL` |
| `deleted_at` | `timestamptz` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (char_length(name) BETWEEN 1 AND 120)`; `CHECK (current_revision >= 0)`; `CHECK (state IN ('active','archived','trashed','deleted'))`; `FOREIGN KEY (created_by) REFERENCES users(id)`。

### `project_revisions`

不可变文档版本；对象承载 canonical document schema。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `project_id` | `opaque_id NOT NULL` |
| `number` | `bigint NOT NULL` |
| `schema_version` | `integer NOT NULL` |
| `storage_object_id` | `opaque_id NOT NULL` |
| `document_hash` | `sha256_hex NOT NULL` |
| `spread_count` | `integer NOT NULL` |
| `photo_count` | `integer NOT NULL` |
| `created_by` | `opaque_id NOT NULL` |
| `command_id` | `opaque_id NOT NULL` |
| `base_revision` | `bigint NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (number > 0)`; `CHECK (schema_version > 0)`; `CHECK (spread_count BETWEEN 1 AND 50)`; `CHECK (photo_count BETWEEN 0 AND 500)`; `CHECK (base_revision >= 0 AND number = base_revision + 1)`; `UNIQUE (workspace_id, project_id, number)`; `UNIQUE (workspace_id, project_id, command_id)`; `UNIQUE (workspace_id, project_id, id)`; `FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id)`; `FOREIGN KEY (workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)`; `FOREIGN KEY (created_by) REFERENCES users(id)`。

### `project_revision_assets`

文档资产引用索引支持引用阻断与回收。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `revision_id` | `opaque_id NOT NULL` |
| `asset_id` | `opaque_id NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `UNIQUE (workspace_id, revision_id, asset_id)`; `FOREIGN KEY (workspace_id, revision_id) REFERENCES project_revisions(workspace_id, id)`; `FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id)`。

### `recovery_drafts`

冲突恢复草稿；不冒充已保存 revision。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `project_id` | `opaque_id NOT NULL` |
| `user_id` | `opaque_id NOT NULL` |
| `base_revision` | `bigint NOT NULL` |
| `schema_version` | `integer NOT NULL` |
| `storage_object_id` | `opaque_id NOT NULL` |
| `body_hash` | `sha256_hex NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (base_revision > 0)`; `CHECK (schema_version > 0)`; `CHECK (expires_at > created_at)`; `CHECK (revision > 0)`; `FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id)`; `FOREIGN KEY (workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `templates`

template 稳定目录项。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (char_length(name) BETWEEN 1 AND 120)`; `CHECK (state IN ('draft','review','published','retired'))`; `CHECK (revision > 0)`。

### `fonts`

font 稳定目录项。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (char_length(name) BETWEEN 1 AND 120)`; `CHECK (state IN ('draft','review','published','retired'))`; `CHECK (revision > 0)`。

### `filters`

filter 稳定目录项。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (char_length(name) BETWEEN 1 AND 120)`; `CHECK (state IN ('draft','review','published','retired'))`; `CHECK (revision > 0)`。

### `template_versions`

不可变模板文档/槽位/小程序可改字段。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `template_id` | `opaque_id NOT NULL` |
| `version` | `integer NOT NULL` |
| `schema_version` | `integer NOT NULL` |
| `license_version_id` | `opaque_id NOT NULL` |
| `storage_workspace_id` | `opaque_id NOT NULL` |
| `storage_object_id` | `opaque_id NOT NULL` |
| `body_hash` | `sha256_hex NOT NULL` |
| `slot_count` | `integer NOT NULL` |
| `editable_fields` | `jsonb NOT NULL` |
| `constraints_json` | `jsonb NOT NULL` |

关系与唯一性：`CHECK (version > 0 AND schema_version > 0)`; `CHECK (slot_count BETWEEN 0 AND 500)`; `CHECK (jsonb_typeof(editable_fields) = 'array')`; `CHECK (jsonb_typeof(constraints_json) = 'object')`; `UNIQUE (template_id, version)`; `FOREIGN KEY (template_id) REFERENCES templates(id)`; `FOREIGN KEY (license_version_id) REFERENCES license_versions(id)`; `FOREIGN KEY (storage_workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)`。

### `font_versions`

不可变授权字体与字形覆盖清单。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `font_id` | `opaque_id NOT NULL` |
| `version` | `integer NOT NULL` |
| `license_version_id` | `opaque_id NOT NULL` |
| `storage_workspace_id` | `opaque_id NOT NULL` |
| `storage_object_id` | `opaque_id NOT NULL` |
| `sha256` | `sha256_hex NOT NULL` |
| `family_name` | `text NOT NULL` |
| `postscript_name` | `text NOT NULL` |
| `weight` | `integer NOT NULL` |
| `embedding_allowed` | `boolean NOT NULL` |
| `coverage_hash` | `sha256_hex NOT NULL` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (weight BETWEEN 1 AND 1000)`; `UNIQUE (font_id, version)`; `FOREIGN KEY (font_id) REFERENCES fonts(id)`; `FOREIGN KEY (license_version_id) REFERENCES license_versions(id)`; `FOREIGN KEY (storage_workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)`。

### `filter_versions`

33 滤镜配方不可变；CPU/GPU 共用版本。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `filter_id` | `opaque_id NOT NULL` |
| `version` | `integer NOT NULL` |
| `recipe_hash` | `sha256_hex NOT NULL` |
| `recipe` | `jsonb NOT NULL` |
| `renderer_version` | `text NOT NULL` |
| `seed_required` | `boolean NOT NULL` |
| `license_version_id` | `opaque_id NOT NULL` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (jsonb_typeof(recipe) = 'object')`; `UNIQUE (filter_id, version)`; `FOREIGN KEY (filter_id) REFERENCES filters(id)`; `FOREIGN KEY (license_version_id) REFERENCES license_versions(id)`。

### `billing_skus`

商品目录与不可变定价版本分离。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `code` | `text NOT NULL` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (state IN ('draft','active','retired'))`; `CHECK (revision > 0)`; `UNIQUE (code)`。

### `sku_versions`

订单冻结实际 SKU 版本。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `sku_id` | `opaque_id NOT NULL` |
| `version` | `integer NOT NULL` |
| `currency` | `text NOT NULL DEFAULT 'CNY'` |
| `price_fen` | `safe_uint NOT NULL` |
| `duration_days` | `integer NOT NULL` |
| `credit_grant` | `safe_uint NOT NULL` |
| `features` | `jsonb NOT NULL` |
| `license_version_id` | `opaque_id` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (currency = 'CNY')`; `CHECK (price_fen <= 1000000000000)`; `CHECK (duration_days BETWEEN 0 AND 36500)`; `CHECK (jsonb_typeof(features) = 'object')`; `UNIQUE (sku_id, version)`; `FOREIGN KEY (sku_id) REFERENCES billing_skus(id)`; `FOREIGN KEY (license_version_id) REFERENCES license_versions(id)`。

### `orders`

支付事实与权益履约状态分别记录。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `sku_version_id` | `opaque_id NOT NULL` |
| `buyer_user_id` | `opaque_id NOT NULL` |
| `currency` | `text NOT NULL DEFAULT 'CNY'` |
| `amount_fen` | `safe_uint NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending'` |
| `fulfillment_state` | `text NOT NULL DEFAULT 'unfulfilled'` |
| `channel` | `text NOT NULL` |
| `client_platform` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `paid_at` | `timestamptz` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (currency = 'CNY')`; `CHECK (amount_fen <= 1000000000000)`; `CHECK (state IN ('pending','paid','closed','refund_pending','partially_refunded','refunded'))`; `CHECK (fulfillment_state IN ('unfulfilled','fulfilled','reversed','manual_review'))`; `CHECK (channel IN ('wechat_pay','wechat_virtual'))`; `CHECK (client_platform IN ('web','mini','app_reserved'))`; `CHECK (expires_at > created_at)`; `CHECK (revision > 0)`; `FOREIGN KEY (sku_version_id) REFERENCES sku_versions(id)`; `FOREIGN KEY (buyer_user_id) REFERENCES users(id)`。

### `payment_attempts`

独立支付尝试与未知状态查询标识。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `order_id` | `opaque_id NOT NULL` |
| `attempt` | `integer NOT NULL` |
| `channel` | `text NOT NULL` |
| `merchant_account_ref` | `text NOT NULL` |
| `provider_request_id` | `text NOT NULL` |
| `provider_transaction_id` | `text` |
| `state` | `text NOT NULL DEFAULT 'created'` |
| `amount_fen` | `safe_uint NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (attempt BETWEEN 1 AND 100)`; `CHECK (state IN ('created','submitted','unknown','paid','closed','failed'))`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, order_id, attempt)`; `UNIQUE (channel, merchant_account_ref, provider_request_id)`; `UNIQUE (workspace_id, order_id, id)`; `FOREIGN KEY (workspace_id, order_id) REFERENCES orders(workspace_id, id)`。

### `payment_events`

验签后的追加事实；事件去重不等于完成履约。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `payment_attempt_id` | `opaque_id NOT NULL` |
| `channel` | `text NOT NULL` |
| `merchant_account_ref` | `text NOT NULL` |
| `provider_event_id` | `text NOT NULL` |
| `provider_transaction_id` | `text NOT NULL` |
| `body_hash` | `sha256_hex NOT NULL` |
| `verified_at` | `timestamptz NOT NULL` |
| `amount_fen` | `safe_uint NOT NULL` |
| `currency` | `text NOT NULL DEFAULT 'CNY'` |
| `event_kind` | `text NOT NULL` |
| `redacted_event` | `jsonb NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (currency = 'CNY')`; `CHECK (event_kind IN ('paid','closed','refund_succeeded','refund_failed'))`; `CHECK (jsonb_typeof(redacted_event) = 'object')`; `UNIQUE (channel, merchant_account_ref, provider_event_id)`; `FOREIGN KEY (workspace_id, payment_attempt_id) REFERENCES payment_attempts(workspace_id, id)`。

### `refunds`

退款在订单锁下限制累计金额并反转权益。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `order_id` | `opaque_id NOT NULL` |
| `payment_attempt_id` | `opaque_id NOT NULL` |
| `operation_id` | `opaque_id NOT NULL` |
| `provider_refund_id` | `text` |
| `amount_fen` | `safe_uint NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'requested'` |
| `reason_code` | `text NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (amount_fen > 0)`; `CHECK (state IN ('requested','submitted','unknown','succeeded','failed','manual_review'))`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, operation_id)`; `FOREIGN KEY (workspace_id, order_id) REFERENCES orders(workspace_id, id)`; `FOREIGN KEY (workspace_id, order_id, payment_attempt_id) REFERENCES payment_attempts(workspace_id, order_id, id)`。

### `redemption_batches`

兑换批次；原始码仅生成时一次交付。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `sku_version_id` | `opaque_id NOT NULL` |
| `name` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'active'` |
| `created_by` | `opaque_id NOT NULL` |

关系与唯一性：`CHECK (expires_at > created_at)`; `CHECK (state IN ('active','disabled','expired'))`; `FOREIGN KEY (sku_version_id) REFERENCES sku_versions(id)`; `FOREIGN KEY (created_by) REFERENCES users(id)`。

### `redemption_codes`

摘要码与行锁防双花。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `batch_id` | `opaque_id NOT NULL` |
| `code_hash` | `sha256_hex NOT NULL` |
| `max_uses` | `integer NOT NULL DEFAULT 1` |
| `used_count` | `integer NOT NULL DEFAULT 0` |
| `state` | `text NOT NULL DEFAULT 'active'` |

关系与唯一性：`CHECK (max_uses BETWEEN 1 AND 1000000)`; `CHECK (used_count BETWEEN 0 AND max_uses)`; `CHECK (state IN ('active','disabled','exhausted'))`; `UNIQUE (code_hash)`; `FOREIGN KEY (batch_id) REFERENCES redemption_batches(id)`。

### `redemptions`

兑换成功追加事实。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `code_id` | `opaque_id NOT NULL` |
| `user_id` | `opaque_id NOT NULL` |
| `operation_id` | `opaque_id NOT NULL` |
| `sku_version_id` | `opaque_id NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `UNIQUE (code_id, workspace_id)`; `UNIQUE (workspace_id, operation_id)`; `FOREIGN KEY (code_id) REFERENCES redemption_codes(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`; `FOREIGN KEY (sku_version_id) REFERENCES sku_versions(id)`。

### `entitlement_grants`

明确来源的权益；到期不删作品。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `source_order_id` | `opaque_id` |
| `source_redemption_id` | `opaque_id` |
| `grant_type` | `text NOT NULL` |
| `starts_at` | `timestamptz NOT NULL` |
| `ends_at` | `timestamptz NOT NULL` |
| `features` | `jsonb NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'active'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (num_nonnulls(source_order_id, source_redemption_id) = 1)`; `CHECK (ends_at > starts_at)`; `CHECK (jsonb_typeof(features) = 'object')`; `CHECK (state IN ('active','expired','revoked'))`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, source_order_id, grant_type)`; `UNIQUE (workspace_id, source_redemption_id, grant_type)`; `FOREIGN KEY (workspace_id, source_order_id) REFERENCES orders(workspace_id, id)`; `FOREIGN KEY (workspace_id, source_redemption_id) REFERENCES redemptions(workspace_id, id)`。

### `subscriptions`

首期固定周期会员；不隐含自动扣费续订。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `entitlement_grant_id` | `opaque_id NOT NULL` |
| `source_order_id` | `opaque_id` |
| `starts_at` | `timestamptz NOT NULL` |
| `ends_at` | `timestamptz NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'active'` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (ends_at > starts_at)`; `CHECK (state IN ('active','expired','revoked'))`; `UNIQUE (workspace_id, entitlement_grant_id)`; `FOREIGN KEY (workspace_id, entitlement_grant_id) REFERENCES entitlement_grants(workspace_id, id)`; `FOREIGN KEY (workspace_id, source_order_id) REFERENCES orders(workspace_id, id)`。

### `credit_accounts`

工作区余额投影，必须与 lot/ledger 同事务更新。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `available` | `safe_uint NOT NULL DEFAULT 0` |
| `reserved` | `safe_uint NOT NULL DEFAULT 0` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (revision > 0)`; `CHECK (available::numeric + reserved::numeric <= 9007199254740991)`; `UNIQUE (workspace_id)`。

### `credit_lots`

按来源与到期日批次；预占可跨到期完成。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `source_grant_id` | `opaque_id NOT NULL` |
| `granted` | `safe_uint NOT NULL` |
| `available` | `safe_uint NOT NULL` |
| `reserved` | `safe_uint NOT NULL DEFAULT 0` |
| `consumed` | `safe_uint NOT NULL DEFAULT 0` |
| `expired` | `safe_uint NOT NULL DEFAULT 0` |
| `revoked` | `safe_uint NOT NULL DEFAULT 0` |
| `expires_at` | `timestamptz NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (granted > 0)`; `CHECK (available::numeric + reserved::numeric + consumed::numeric + expired::numeric + revoked::numeric = granted::numeric)`; `CHECK (expires_at > created_at)`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, source_grant_id)`; `FOREIGN KEY (workspace_id, source_grant_id) REFERENCES entitlement_grants(workspace_id, id)`。

### `ai_billing_accounts`

稳定采购账户；连接/密钥版本变更不重置预算。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `account_billing_id` | `opaque_id NOT NULL` |
| `provider_name` | `text NOT NULL` |
| `daily_budget_fen` | `safe_uint NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'active'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (state IN ('active','stopped','retired'))`; `CHECK (revision > 0)`; `UNIQUE (environment, account_billing_id)`; `UNIQUE (id, environment)`。

### `ai_provider_connections`

供应商逻辑连接；禁用只停新任务。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `billing_account_id` | `opaque_id NOT NULL` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'unconfigured'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (state IN ('disabled','unconfigured','ready','degraded'))`; `CHECK (revision > 0)`; `UNIQUE (environment, name)`; `UNIQUE (id, billing_account_id, environment)`; `FOREIGN KEY (billing_account_id, environment) REFERENCES ai_billing_accounts(id, environment)`; `UNIQUE (id, billing_account_id)`。

### `ai_provider_versions`

不可变适配器/秘密/隐私能力版本。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `connection_id` | `opaque_id NOT NULL` |
| `billing_account_id` | `opaque_id NOT NULL` |
| `environment` | `text NOT NULL` |
| `version` | `integer NOT NULL` |
| `adapter_id` | `text NOT NULL` |
| `adapter_version` | `text NOT NULL` |
| `base_url` | `text NOT NULL` |
| `secret_reference_id` | `opaque_id NOT NULL` |
| `auth_mode` | `text NOT NULL` |
| `connect_timeout_ms` | `integer NOT NULL DEFAULT 5000` |
| `request_timeout_ms` | `integer NOT NULL DEFAULT 60000` |
| `max_concurrent` | `integer NOT NULL` |
| `requests_per_minute` | `integer NOT NULL` |
| `daily_budget_fen` | `safe_uint NOT NULL` |
| `allowed_data_use` | `jsonb NOT NULL` |
| `capabilities` | `jsonb NOT NULL` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (base_url ~ '^https://')`; `CHECK (connect_timeout_ms BETWEEN 100 AND 60000)`; `CHECK (request_timeout_ms BETWEEN 100 AND 600000)`; `CHECK (max_concurrent BETWEEN 1 AND 10000)`; `CHECK (requests_per_minute BETWEEN 1 AND 1000000)`; `CHECK (auth_mode IN ('bearer','signature','adapter_defined'))`; `CHECK (jsonb_typeof(allowed_data_use) = 'object')`; `CHECK (jsonb_typeof(capabilities) = 'object')`; `UNIQUE (connection_id, version)`; `UNIQUE (id, connection_id, billing_account_id)`; `FOREIGN KEY (connection_id, billing_account_id, environment) REFERENCES ai_provider_connections(id, billing_account_id, environment)`; `FOREIGN KEY (secret_reference_id, environment) REFERENCES secret_references(id, environment)`。

### `ai_models`

模型目录状态依实际契约测试启用。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'unverified'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (state IN ('unverified','ready','disabled','retired'))`; `CHECK (revision > 0)`。

### `ai_model_versions`

模型能力/限制/授权与契约测试冻结。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `model_id` | `opaque_id NOT NULL` |
| `version` | `integer NOT NULL` |
| `provider_version_id` | `opaque_id NOT NULL` |
| `provider_model_id` | `text NOT NULL` |
| `provider_model_version` | `text NOT NULL` |
| `license_version_id` | `opaque_id NOT NULL` |
| `input_schema_version` | `integer NOT NULL` |
| `output_schema_version` | `integer NOT NULL` |
| `capabilities` | `jsonb NOT NULL` |
| `parameter_schema` | `jsonb NOT NULL` |
| `limits_json` | `jsonb NOT NULL` |
| `moderation_policy_ref` | `text NOT NULL` |
| `label_policy_ref` | `text NOT NULL` |
| `test_report_id` | `opaque_id NOT NULL` |

关系与唯一性：`CHECK (version > 0 AND input_schema_version > 0 AND output_schema_version > 0)`; `CHECK (jsonb_typeof(capabilities) = 'object')`; `CHECK (jsonb_typeof(parameter_schema) = 'object')`; `CHECK (jsonb_typeof(limits_json) = 'object')`; `UNIQUE (model_id, version)`; `UNIQUE (id, provider_version_id)`; `FOREIGN KEY (model_id) REFERENCES ai_models(id)`; `FOREIGN KEY (provider_version_id) REFERENCES ai_provider_versions(id)`; `FOREIGN KEY (license_version_id) REFERENCES license_versions(id)`; `FOREIGN KEY (test_report_id) REFERENCES config_tests(id)`。

### `ai_routes`

排版建议/生图/参考图/审核能力独立路由。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `capability` | `text NOT NULL` |
| `name` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (capability IN ('textSuggestion','textToImage','imageToImage','moderation'))`; `CHECK (state IN ('draft','active','retired'))`; `CHECK (revision > 0)`。

### `ai_route_versions`

备用仅在确定未接受且满足报价合同前允许。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `route_id` | `opaque_id NOT NULL` |
| `version` | `integer NOT NULL` |
| `primary_model_version_id` | `opaque_id NOT NULL` |
| `fallback_model_version_id` | `opaque_id` |
| `fallback_policy` | `text NOT NULL DEFAULT 'none'` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (fallback_policy IN ('none','definitely_not_accepted'))`; `CHECK ((fallback_policy = 'none') = (fallback_model_version_id IS NULL))`; `CHECK (fallback_model_version_id IS NULL OR fallback_model_version_id <> primary_model_version_id)`; `UNIQUE (route_id, version)`; `FOREIGN KEY (route_id) REFERENCES ai_routes(id)`; `FOREIGN KEY (primary_model_version_id) REFERENCES ai_model_versions(id)`; `FOREIGN KEY (fallback_model_version_id) REFERENCES ai_model_versions(id)`。

### `ai_presets`

风格目录；许可不明不得上架。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `name` | `text NOT NULL` |
| `category` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft'` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (state IN ('draft','review','published','retired'))`; `CHECK (revision > 0)`。

### `cost_rule_versions`

用户点数与供应商采购价分开版本定价。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `rule_key` | `text NOT NULL` |
| `version` | `integer NOT NULL` |
| `credit_cost` | `safe_uint NOT NULL` |
| `estimated_cost_fen` | `safe_uint NOT NULL` |
| `max_cost_fen` | `safe_uint NOT NULL` |
| `parameters` | `jsonb NOT NULL` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (estimated_cost_fen <= max_cost_fen)`; `CHECK (jsonb_typeof(parameters) = 'object')`; `UNIQUE (rule_key, version)`。

### `ai_preset_versions`

不可变预设模板，仅白名单插值。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `preset_id` | `opaque_id NOT NULL` |
| `version` | `integer NOT NULL` |
| `license_version_id` | `opaque_id NOT NULL` |
| `cost_rule_version_id` | `opaque_id NOT NULL` |
| `parameter_template` | `jsonb NOT NULL` |
| `editable_parameters` | `text[] NOT NULL` |
| `moderation_policy_ref` | `text NOT NULL` |
| `label_policy_ref` | `text NOT NULL` |
| `example_license_version_id` | `opaque_id` |

关系与唯一性：`CHECK (version > 0)`; `CHECK (jsonb_typeof(parameter_template) = 'object')`; `UNIQUE (preset_id, version)`; `FOREIGN KEY (preset_id) REFERENCES ai_presets(id)`; `FOREIGN KEY (license_version_id) REFERENCES license_versions(id)`; `FOREIGN KEY (cost_rule_version_id) REFERENCES cost_rule_versions(id)`; `FOREIGN KEY (example_license_version_id) REFERENCES license_versions(id)`。

### `ai_preset_models`

预设所支持模型的显式白名单。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `preset_version_id` | `opaque_id NOT NULL` |
| `model_version_id` | `opaque_id NOT NULL` |

关系与唯一性：`UNIQUE (preset_version_id, model_version_id)`; `FOREIGN KEY (preset_version_id) REFERENCES ai_preset_versions(id)`; `FOREIGN KEY (model_version_id) REFERENCES ai_model_versions(id)`。

### `budget_days`

Asia/Shanghai 采购账户日预算，旧日未知预占不清零。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `billing_account_id` | `opaque_id NOT NULL` |
| `budget_date` | `date NOT NULL` |
| `limit_fen` | `safe_uint NOT NULL` |
| `reserved_fen` | `safe_uint NOT NULL DEFAULT 0` |
| `spent_fen` | `safe_uint NOT NULL DEFAULT 0` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (revision > 0)`; `CHECK (reserved_fen::numeric + spent_fen::numeric <= 9007199254740991)`; `UNIQUE (billing_account_id, budget_date)`; `UNIQUE (id, billing_account_id)`; `FOREIGN KEY (billing_account_id) REFERENCES ai_billing_accounts(id)`。

### `provider_budget_days`

同账户各连接叠加独立上限，密钥轮换不归零。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `connection_id` | `opaque_id NOT NULL` |
| `billing_account_id` | `opaque_id NOT NULL` |
| `budget_day_id` | `opaque_id NOT NULL` |
| `limit_fen` | `safe_uint NOT NULL` |
| `reserved_fen` | `safe_uint NOT NULL DEFAULT 0` |
| `spent_fen` | `safe_uint NOT NULL DEFAULT 0` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`CHECK (revision > 0)`; `CHECK (reserved_fen::numeric + spent_fen::numeric <= 9007199254740991)`; `UNIQUE (connection_id, budget_day_id)`; `UNIQUE (id, budget_day_id, billing_account_id, connection_id)`; `FOREIGN KEY (budget_day_id, billing_account_id) REFERENCES budget_days(id, billing_account_id)`; `FOREIGN KEY (connection_id, billing_account_id) REFERENCES ai_provider_connections(id, billing_account_id)`。

### `generation_consents`

明确选中参考图用途与授权，不默认全相册上传。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `user_id` | `opaque_id NOT NULL` |
| `reference_asset_id` | `opaque_id` |
| `policy_version` | `text NOT NULL` |
| `purpose` | `text NOT NULL` |
| `consented_at` | `timestamptz NOT NULL` |
| `reference_authorization_ref` | `text` |
| `input_hash` | `sha256_hex NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (char_length(purpose) BETWEEN 1 AND 240)`; `CHECK (reference_asset_id IS NULL OR reference_authorization_ref IS NOT NULL)`; `FOREIGN KEY (user_id) REFERENCES users(id)`; `FOREIGN KEY (workspace_id, reference_asset_id) REFERENCES assets(workspace_id, id)`。

### `generation_quotes`

5分钟报价不预占；接受任务唯一消费此 quote。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `config_release_id` | `opaque_id NOT NULL` |
| `route_version_id` | `opaque_id NOT NULL` |
| `model_version_id` | `opaque_id NOT NULL` |
| `provider_version_id` | `opaque_id NOT NULL` |
| `preset_version_id` | `opaque_id` |
| `cost_rule_version_id` | `opaque_id NOT NULL` |
| `consent_id` | `opaque_id NOT NULL` |
| `reference_asset_id` | `opaque_id` |
| `input_hash` | `sha256_hex NOT NULL` |
| `credit_cost` | `safe_uint NOT NULL` |
| `estimated_cost_fen` | `safe_uint NOT NULL` |
| `max_cost_fen` | `safe_uint NOT NULL` |
| `image_count` | `integer NOT NULL DEFAULT 1` |
| `expires_at` | `timestamptz NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (estimated_cost_fen <= max_cost_fen)`; `CHECK (image_count = 1)`; `CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')`; `FOREIGN KEY (config_release_id) REFERENCES config_releases(id)`; `FOREIGN KEY (route_version_id) REFERENCES ai_route_versions(id)`; `FOREIGN KEY (model_version_id, provider_version_id) REFERENCES ai_model_versions(id, provider_version_id)`; `FOREIGN KEY (preset_version_id) REFERENCES ai_preset_versions(id)`; `FOREIGN KEY (cost_rule_version_id) REFERENCES cost_rule_versions(id)`; `FOREIGN KEY (workspace_id, consent_id) REFERENCES generation_consents(workspace_id, id)`; `FOREIGN KEY (workspace_id, reference_asset_id) REFERENCES assets(workspace_id, id)`。

### `export_preflights`

导出阻断/警告与参数 hash 绑定，令牌仅摘要。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `project_id` | `opaque_id NOT NULL` |
| `revision_id` | `opaque_id NOT NULL` |
| `normalized_spec_hash` | `sha256_hex NOT NULL` |
| `schema_version` | `integer NOT NULL` |
| `format` | `text NOT NULL` |
| `dpi` | `integer NOT NULL` |
| `max_face_pixels` | `safe_uint NOT NULL` |
| `warnings` | `jsonb NOT NULL` |
| `blockers` | `jsonb NOT NULL` |
| `token_hash` | `sha256_hex NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (schema_version = 1)`; `CHECK (format IN ('jpeg','png','pdf'))`; `CHECK (dpi IN (72,150,300))`; `CHECK (max_face_pixels BETWEEN 1 AND 50000000)`; `CHECK (jsonb_typeof(warnings) = 'array')`; `CHECK (jsonb_typeof(blockers) = 'array')`; `CHECK (expires_at > created_at)`; `UNIQUE (token_hash)`; `UNIQUE (workspace_id, project_id, revision_id, id)`; `FOREIGN KEY (workspace_id, project_id, revision_id) REFERENCES project_revisions(workspace_id, project_id, id)`。

### `job_snapshots`

任务冻结所有参数、授权与版本；不是客户端任意 JSON。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `kind` | `text NOT NULL` |
| `project_id` | `opaque_id` |
| `revision_id` | `opaque_id` |
| `quote_id` | `opaque_id` |
| `preflight_id` | `opaque_id` |
| `config_release_id` | `opaque_id NOT NULL` |
| `schema_version` | `integer NOT NULL` |
| `normalized_spec_hash` | `sha256_hex NOT NULL` |
| `manifest_hash` | `sha256_hex NOT NULL` |
| `manifest` | `jsonb NOT NULL` |
| `entitlement_snapshot` | `jsonb NOT NULL` |
| `warnings_acknowledged` | `jsonb NOT NULL` |
| `renderer_version` | `text` |
| `renderer_image_digest` | `text` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (kind IN ('layout','generation','export','asset_analysis','storage_migration','deletion','privacy_export','config_test','reconciliation','backup_restore_drill'))`; `CHECK (schema_version > 0)`; `CHECK ((project_id IS NULL) = (revision_id IS NULL))`; `CHECK (kind <> 'generation' OR quote_id IS NOT NULL)`; `CHECK (kind <> 'export' OR (preflight_id IS NOT NULL AND revision_id IS NOT NULL AND renderer_version IS NOT NULL AND renderer_image_digest ~ '^sha256:[0-9a-f]{64}$'))`; `CHECK (jsonb_typeof(manifest) = 'object')`; `CHECK (jsonb_typeof(entitlement_snapshot) = 'object')`; `CHECK (jsonb_typeof(warnings_acknowledged) = 'array')`; `FOREIGN KEY (workspace_id, project_id, revision_id) REFERENCES project_revisions(workspace_id, project_id, id)`; `FOREIGN KEY (workspace_id, quote_id) REFERENCES generation_quotes(workspace_id, id)`; `FOREIGN KEY (workspace_id, project_id, revision_id, preflight_id) REFERENCES export_preflights(workspace_id, project_id, revision_id, id)`; `FOREIGN KEY (config_release_id) REFERENCES config_releases(id)`。

### `jobs`

PostgreSQL 任务事实；条件 fence/lease 写入，终态只一次。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `kind` | `text NOT NULL` |
| `snapshot_id` | `opaque_id NOT NULL` |
| `quote_id` | `opaque_id` |
| `parent_job_id` | `opaque_id` |
| `created_by` | `opaque_id NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'queued'` |
| `progress` | `integer NOT NULL DEFAULT 0` |
| `stage` | `text NOT NULL DEFAULT 'queued'` |
| `fence` | `bigint NOT NULL DEFAULT 0` |
| `revision` | `bigint NOT NULL DEFAULT 1` |
| `lease_owner` | `opaque_id` |
| `lease_expires_at` | `timestamptz` |
| `attempt_count` | `integer NOT NULL DEFAULT 0` |
| `max_attempts` | `integer NOT NULL DEFAULT 3` |
| `provider_submission_state` | `text NOT NULL DEFAULT 'not_submitted'` |
| `provider_request_id` | `text` |
| `next_attempt_at` | `timestamptz` |
| `cancel_requested_at` | `timestamptz` |
| `terminal_at` | `timestamptz` |
| `error_code` | `text` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (kind IN ('layout','generation','export','asset_analysis','storage_migration','deletion','privacy_export','config_test','reconciliation','backup_restore_drill'))`; `CHECK (state IN ('queued','running','packaging','retry_wait','cancel_requested','succeeded','failed','cancelled'))`; `CHECK (progress BETWEEN 0 AND 100)`; `CHECK (fence >= 0 AND revision > 0)`; `CHECK (attempt_count BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 10)`; `CHECK (provider_submission_state IN ('not_submitted','submitting','accepted','unknown','terminal'))`; `CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))`; `CHECK ((state IN ('succeeded','failed','cancelled')) = (terminal_at IS NOT NULL))`; `CHECK (kind <> 'generation' OR quote_id IS NOT NULL)`; `UNIQUE (workspace_id, snapshot_id)`; `UNIQUE (workspace_id, quote_id)`; `UNIQUE (workspace_id, id, fence)`; `FOREIGN KEY (workspace_id, snapshot_id) REFERENCES job_snapshots(workspace_id, id)`; `FOREIGN KEY (workspace_id, quote_id) REFERENCES generation_quotes(workspace_id, id)`; `FOREIGN KEY (workspace_id, parent_job_id) REFERENCES jobs(workspace_id, id)`; `FOREIGN KEY (created_by) REFERENCES users(id)`; `UNIQUE (workspace_id, id, quote_id)`。

### `job_attempts`

逐次执行与未知上游查询；不把网络超时当失败。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `job_id` | `opaque_id NOT NULL` |
| `attempt` | `integer NOT NULL` |
| `fence` | `bigint NOT NULL` |
| `worker_id` | `opaque_id NOT NULL` |
| `state` | `text NOT NULL` |
| `started_at` | `timestamptz NOT NULL` |
| `ended_at` | `timestamptz` |
| `provider_request_id` | `text` |
| `provider_job_id` | `text` |
| `submission_state` | `text NOT NULL` |
| `error_code` | `text` |
| `next_query_at` | `timestamptz` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (attempt BETWEEN 1 AND 10)`; `CHECK (fence > 0)`; `CHECK (state IN ('running','unknown','succeeded','failed','cancelled','superseded'))`; `CHECK (submission_state IN ('not_submitted','submitting','accepted','unknown','terminal'))`; `CHECK (ended_at IS NULL OR ended_at >= started_at)`; `UNIQUE (workspace_id, job_id, attempt)`; `UNIQUE (workspace_id, job_id, fence)`; `FOREIGN KEY (workspace_id, job_id) REFERENCES jobs(workspace_id, id)`。

### `resource_pins`

pin 精确旧 locator 与字体/模板版本；解 pin 后才能清理。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `job_id` | `opaque_id NOT NULL` |
| `storage_workspace_id` | `opaque_id NOT NULL` |
| `storage_object_id` | `opaque_id NOT NULL` |
| `asset_id` | `opaque_id` |
| `font_version_id` | `opaque_id` |
| `template_version_id` | `opaque_id` |
| `filter_version_id` | `opaque_id` |
| `released_at` | `timestamptz` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `UNIQUE (workspace_id, job_id, storage_object_id)`; `FOREIGN KEY (workspace_id, job_id) REFERENCES jobs(workspace_id, id)`; `FOREIGN KEY (storage_workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)`; `FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id)`; `FOREIGN KEY (font_version_id) REFERENCES font_versions(id)`; `FOREIGN KEY (template_version_id) REFERENCES template_versions(id)`; `FOREIGN KEY (filter_version_id) REFERENCES filter_versions(id)`。

### `job_outputs`

通过 fence 竞态后发布私有产物；迟到临时对象不绑定。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `job_id` | `opaque_id NOT NULL` |
| `artifact_index` | `integer NOT NULL` |
| `storage_object_id` | `opaque_id NOT NULL` |
| `committed_fence` | `bigint NOT NULL` |
| `format` | `text NOT NULL` |
| `sha256` | `sha256_hex NOT NULL` |
| `byte_size` | `safe_uint NOT NULL` |
| `width` | `integer` |
| `height` | `integer` |
| `expires_at` | `timestamptz NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (artifact_index BETWEEN 0 AND 999)`; `CHECK (committed_fence > 0)`; `CHECK (format IN ('jpeg','png','pdf','json','zip'))`; `CHECK (byte_size > 0)`; `CHECK ((width IS NULL) = (height IS NULL))`; `CHECK (width IS NULL OR (width > 0 AND height > 0 AND width::bigint * height::bigint <= 50000000))`; `CHECK (expires_at > created_at)`; `UNIQUE (workspace_id, job_id, artifact_index)`; `FOREIGN KEY (workspace_id, job_id) REFERENCES jobs(workspace_id, id)`; `FOREIGN KEY (workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)`。

### `layout_candidates`

规则排版候选不修改项目；应用候选需 revision CAS。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `job_id` | `opaque_id NOT NULL` |
| `project_id` | `opaque_id NOT NULL` |
| `base_revision_id` | `opaque_id NOT NULL` |
| `candidate_index` | `integer NOT NULL` |
| `seed` | `bigint NOT NULL` |
| `score` | `numeric(8,6) NOT NULL` |
| `layout_hash` | `sha256_hex NOT NULL` |
| `layout_json` | `jsonb NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (candidate_index BETWEEN 0 AND 19)`; `CHECK (score BETWEEN 0 AND 1)`; `CHECK (jsonb_typeof(layout_json) = 'object')`; `CHECK (expires_at > created_at)`; `UNIQUE (workspace_id, job_id, candidate_index)`; `FOREIGN KEY (workspace_id, job_id) REFERENCES jobs(workspace_id, id)`; `FOREIGN KEY (workspace_id, project_id, base_revision_id) REFERENCES project_revisions(workspace_id, project_id, id)`。

### `credit_reservations`

任务一次预占与一次终局；未知状态保留直到终局上限。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `job_id` | `opaque_id NOT NULL` |
| `quote_id` | `opaque_id NOT NULL` |
| `amount` | `safe_uint NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'held'` |
| `expires_at` | `timestamptz NOT NULL` |
| `settled_at` | `timestamptz` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (state IN ('held','settled','released','expired'))`; `CHECK (expires_at > created_at)`; `CHECK ((state = 'held') = (settled_at IS NULL))`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, job_id)`; `UNIQUE (workspace_id, quote_id)`; `UNIQUE (workspace_id, id, job_id, quote_id)`; `FOREIGN KEY (workspace_id, quote_id) REFERENCES generation_quotes(workspace_id, id)`; `FOREIGN KEY (workspace_id, job_id, quote_id) REFERENCES jobs(workspace_id, id, quote_id)`。

### `credit_reservation_allocations`

按最早到期分配；各批次金额总和由事务服务保证。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `reservation_id` | `opaque_id NOT NULL` |
| `lot_id` | `opaque_id NOT NULL` |
| `amount` | `safe_uint NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (amount > 0)`; `UNIQUE (workspace_id, reservation_id, lot_id)`; `FOREIGN KEY (workspace_id, reservation_id) REFERENCES credit_reservations(workspace_id, id)`; `FOREIGN KEY (workspace_id, lot_id) REFERENCES credit_lots(workspace_id, id)`。

### `credit_ledger`

追加非负金额流水；全局 operation_id 唯一，每批次一行。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `operation_id` | `opaque_id NOT NULL` |
| `operation_line` | `integer NOT NULL DEFAULT 1` |
| `operation_group_id` | `opaque_id NOT NULL` |
| `lot_id` | `opaque_id NOT NULL` |
| `reservation_id` | `opaque_id` |
| `entry_type` | `text NOT NULL` |
| `amount` | `safe_uint NOT NULL` |
| `from_bucket` | `text NOT NULL` |
| `to_bucket` | `text NOT NULL` |
| `balance_after` | `safe_uint NOT NULL` |
| `reason_code` | `text NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (operation_line > 0)`; `CHECK (amount > 0)`; `CHECK (entry_type IN ('grant','reserve','settle','release','expire','revoke','adjustment'))`; `CHECK (from_bucket IN ('external','available','reserved','consumed','expired','revoked'))`; `CHECK (to_bucket IN ('external','available','reserved','consumed','expired','revoked'))`; `CHECK (from_bucket <> to_bucket)`; `CHECK ((entry_type = 'grant' AND from_bucket = 'external' AND to_bucket = 'available') OR (entry_type = 'reserve' AND from_bucket = 'available' AND to_bucket = 'reserved') OR (entry_type = 'settle' AND from_bucket = 'reserved' AND to_bucket = 'consumed') OR (entry_type = 'release' AND from_bucket = 'reserved' AND to_bucket IN ('available','expired','revoked')) OR (entry_type = 'expire' AND from_bucket = 'available' AND to_bucket = 'expired') OR (entry_type = 'revoke' AND from_bucket IN ('available','reserved') AND to_bucket = 'revoked') OR entry_type = 'adjustment')`; `UNIQUE (operation_id)`; `UNIQUE (workspace_id, operation_group_id, operation_line)`; `FOREIGN KEY (workspace_id, lot_id) REFERENCES credit_lots(workspace_id, id)`; `FOREIGN KEY (workspace_id, reservation_id) REFERENCES credit_reservations(workspace_id, id)`。

### `budget_reservations`

采购预占绑定接受当天与稳定账户；连接与账户双锁。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `job_id` | `opaque_id NOT NULL` |
| `quote_id` | `opaque_id NOT NULL` |
| `billing_account_id` | `opaque_id NOT NULL` |
| `connection_id` | `opaque_id NOT NULL` |
| `provider_version_id` | `opaque_id NOT NULL` |
| `budget_day_id` | `opaque_id NOT NULL` |
| `provider_budget_day_id` | `opaque_id NOT NULL` |
| `reserved_fen` | `safe_uint NOT NULL` |
| `actual_fen` | `safe_uint NOT NULL DEFAULT 0` |
| `state` | `text NOT NULL DEFAULT 'held'` |
| `expires_at` | `timestamptz NOT NULL` |
| `settled_at` | `timestamptz` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (state IN ('held','settled','released','expired'))`; `CHECK (expires_at > created_at)`; `CHECK ((state = 'held') = (settled_at IS NULL))`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, job_id)`; `FOREIGN KEY (workspace_id, job_id, quote_id) REFERENCES jobs(workspace_id, id, quote_id)`; `FOREIGN KEY (provider_version_id, connection_id, billing_account_id) REFERENCES ai_provider_versions(id, connection_id, billing_account_id)`; `FOREIGN KEY (budget_day_id, billing_account_id) REFERENCES budget_days(id, billing_account_id)`; `FOREIGN KEY (provider_budget_day_id, budget_day_id, billing_account_id, connection_id) REFERENCES provider_budget_days(id, budget_day_id, billing_account_id, connection_id)`。

### `provider_cost_ledger`

采购成本追加账本；查询费用与迟到费用单独对账。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `billing_account_id` | `opaque_id NOT NULL` |
| `budget_day_id` | `opaque_id NOT NULL` |
| `reservation_id` | `opaque_id` |
| `operation_id` | `opaque_id NOT NULL` |
| `entry_type` | `text NOT NULL` |
| `amount_fen` | `safe_uint NOT NULL` |
| `provider_charge_ref` | `text` |
| `reason_code` | `text NOT NULL` |

关系与唯一性：`CHECK (entry_type IN ('reserve','release','settle','late_charge','reconcile'))`; `UNIQUE (operation_id)`; `FOREIGN KEY (budget_day_id, billing_account_id) REFERENCES budget_days(id, billing_account_id)`; `FOREIGN KEY (reservation_id) REFERENCES budget_reservations(id)`。

### `generation_provenance`

生成来源不可变；输入授权、模型、标识、审核可追溯。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `job_id` | `opaque_id NOT NULL` |
| `asset_id` | `opaque_id NOT NULL` |
| `quote_id` | `opaque_id NOT NULL` |
| `consent_id` | `opaque_id NOT NULL` |
| `provider_version_id` | `opaque_id NOT NULL` |
| `model_version_id` | `opaque_id NOT NULL` |
| `preset_version_id` | `opaque_id` |
| `input_hash` | `sha256_hex NOT NULL` |
| `provider_request_id` | `text NOT NULL` |
| `provider_job_id` | `text` |
| `seed` | `bigint` |
| `license_version_id` | `opaque_id NOT NULL` |
| `moderation_policy_ref` | `text NOT NULL` |
| `label_policy_ref` | `text NOT NULL` |
| `moderation_result` | `text NOT NULL` |
| `label_applied` | `boolean NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (moderation_result IN ('approved','rejected','quarantined'))`; `UNIQUE (workspace_id, asset_id)`; `FOREIGN KEY (workspace_id, job_id, quote_id) REFERENCES jobs(workspace_id, id, quote_id)`; `FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id)`; `FOREIGN KEY (workspace_id, consent_id) REFERENCES generation_consents(workspace_id, id)`; `FOREIGN KEY (model_version_id, provider_version_id) REFERENCES ai_model_versions(id, provider_version_id)`; `FOREIGN KEY (preset_version_id) REFERENCES ai_preset_versions(id)`; `FOREIGN KEY (license_version_id) REFERENCES license_versions(id)`。

### `outbox`

主事务同时写出的可重投调度事实。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id` |
| `event_key` | `opaque_id NOT NULL` |
| `aggregate_kind` | `text NOT NULL` |
| `aggregate_id` | `opaque_id NOT NULL` |
| `event_type` | `text NOT NULL` |
| `payload` | `jsonb NOT NULL` |
| `available_at` | `timestamptz NOT NULL DEFAULT now()` |
| `claimed_by` | `opaque_id` |
| `claim_expires_at` | `timestamptz` |
| `delivery_attempts` | `integer NOT NULL DEFAULT 0` |
| `sent_at` | `timestamptz` |
| `last_error_code` | `text` |

关系与唯一性：`CHECK (delivery_attempts BETWEEN 0 AND 1000000)`; `CHECK (jsonb_typeof(payload) = 'object')`; `CHECK ((claimed_by IS NULL) = (claim_expires_at IS NULL))`; `UNIQUE (event_key)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`。

### `idempotency_keys`

工作区/身份作用域幂等；同 key 异 payload 409。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id` |
| `principal_scope` | `text NOT NULL` |
| `idempotency_key` | `text NOT NULL` |
| `request_hash` | `sha256_hex NOT NULL` |
| `operation` | `text NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'processing'` |
| `response_status` | `integer` |
| `response_json` | `jsonb` |
| `resource_kind` | `text` |
| `resource_id` | `opaque_id` |
| `expires_at` | `timestamptz NOT NULL` |

关系与唯一性：`CHECK (char_length(principal_scope) BETWEEN 1 AND 200)`; `CHECK (char_length(idempotency_key) BETWEEN 1 AND 128)`; `CHECK (state IN ('processing','completed'))`; `CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)`; `CHECK (expires_at >= created_at + interval '7 days')`; `CHECK (state <> 'completed' OR response_status IS NOT NULL)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`。

### `share_links`

私有预览分享；撤销后不再发签名 URL。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `project_id` | `opaque_id NOT NULL` |
| `revision_id` | `opaque_id NOT NULL` |
| `created_by` | `opaque_id NOT NULL` |
| `token_hash` | `sha256_hex NOT NULL` |
| `password_hash` | `text` |
| `scope` | `text NOT NULL DEFAULT 'preview'` |
| `state` | `text NOT NULL DEFAULT 'active'` |
| `expires_at` | `timestamptz NOT NULL` |
| `revoked_at` | `timestamptz` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (scope IN ('preview','preview_download'))`; `CHECK (state IN ('active','revoked','expired'))`; `CHECK (expires_at > created_at)`; `CHECK (revision > 0)`; `UNIQUE (token_hash)`; `FOREIGN KEY (workspace_id, project_id, revision_id) REFERENCES project_revisions(workspace_id, project_id, id)`; `FOREIGN KEY (created_by) REFERENCES users(id)`。

### `share_access_events`

分享限速与审计；不存原始 IP。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `share_link_id` | `opaque_id NOT NULL` |
| `outcome` | `text NOT NULL` |
| `request_id` | `opaque_id NOT NULL` |
| `visitor_digest` | `sha256_hex NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (outcome IN ('granted','denied','expired','revoked'))`; `FOREIGN KEY (workspace_id, share_link_id) REFERENCES share_links(workspace_id, id)`。

### `notification_preferences`

用户按渠道/类别通知偏好。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `user_id` | `opaque_id NOT NULL` |
| `channel` | `text NOT NULL` |
| `category` | `text NOT NULL` |
| `enabled` | `boolean NOT NULL` |
| `revision` | `bigint NOT NULL DEFAULT 1` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (channel IN ('in_app','wechat','email_reserved'))`; `CHECK (category IN ('job','billing','security','workspace','system'))`; `CHECK (revision > 0)`; `UNIQUE (workspace_id, user_id, channel, category)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `notifications`

站内通知稳定事实；不携带原图/秘密。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `recipient_user_id` | `opaque_id NOT NULL` |
| `event_key` | `opaque_id NOT NULL` |
| `category` | `text NOT NULL` |
| `template_key` | `text NOT NULL` |
| `template_version` | `integer NOT NULL` |
| `redacted_payload` | `jsonb NOT NULL` |
| `read_at` | `timestamptz` |
| `expires_at` | `timestamptz NOT NULL` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (category IN ('job','billing','security','workspace','system'))`; `CHECK (template_version > 0)`; `CHECK (jsonb_typeof(redacted_payload) = 'object')`; `CHECK (expires_at > created_at)`; `UNIQUE (workspace_id, recipient_user_id, event_key)`; `FOREIGN KEY (recipient_user_id) REFERENCES users(id)`。

### `notification_deliveries`

渠道发送重试去重；App 仅保留 future 通道。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id NOT NULL` |
| `notification_id` | `opaque_id NOT NULL` |
| `channel` | `text NOT NULL` |
| `attempt` | `integer NOT NULL DEFAULT 1` |
| `state` | `text NOT NULL DEFAULT 'pending'` |
| `provider_message_id` | `text` |
| `next_attempt_at` | `timestamptz` |
| `error_code` | `text` |

关系与唯一性：`UNIQUE (workspace_id, id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `CHECK (channel IN ('in_app','wechat','email_reserved','app_reserved'))`; `CHECK (attempt BETWEEN 1 AND 10)`; `CHECK (state IN ('pending','sending','sent','failed','suppressed'))`; `UNIQUE (workspace_id, notification_id, channel, attempt)`; `FOREIGN KEY (workspace_id, notification_id) REFERENCES notifications(workspace_id, id)`。

### `deletion_tombstones`

备份恢复必须重放的删除标记，无原始 PII。 **行不可变/追加。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `workspace_id` | `opaque_id` |
| `user_id` | `opaque_id` |
| `target_kind` | `text NOT NULL` |
| `target_id` | `opaque_id NOT NULL` |
| `object_locator_hash` | `sha256_hex` |
| `operation_id` | `opaque_id NOT NULL` |
| `deleted_at` | `timestamptz NOT NULL` |
| `retain_until` | `timestamptz NOT NULL` |
| `reason_code` | `text NOT NULL` |

关系与唯一性：`CHECK (retain_until >= deleted_at)`; `CHECK (num_nonnulls(workspace_id, user_id) >= 1)`; `UNIQUE (operation_id, target_kind, target_id)`; `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`; `FOREIGN KEY (user_id) REFERENCES users(id)`。

### `backup_runs`

数据库和对象备份分开证据；不含凭据或声称已演练。 **状态或元信息可变；CAS/权限按服务合同。**

| 字段 | SQL 类型与约束 |
|---|---|
| `id` | `opaque_id NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `environment` | `text NOT NULL` |
| `kind` | `text NOT NULL` |
| `state` | `text NOT NULL` |
| `started_at` | `timestamptz NOT NULL` |
| `completed_at` | `timestamptz` |
| `backup_reference` | `text NOT NULL` |
| `manifest_hash` | `sha256_hex` |
| `restored_tombstone_watermark` | `timestamptz` |
| `error_code` | `text` |

关系与唯一性：`CHECK (environment IN ('dev','staging','prod'))`; `CHECK (kind IN ('database','objects','restore_drill'))`; `CHECK (state IN ('running','succeeded','failed'))`; `CHECK (completed_at IS NULL OR completed_at >= started_at)`。
