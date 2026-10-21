-- AI Album v1.0 database DESIGN CONTRACT; PostgreSQL 16/17; no production deployment.
-- Run with psql -X -v ON_ERROR_STOP=1 in an EMPTY DISPOSABLE database.
-- No credentials, seed accounts, vendor assertions, extensions or UUID requirements.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
CREATE SCHEMA ai_album;
SET LOCAL search_path TO ai_album, pg_catalog;
CREATE DOMAIN opaque_id AS text CONSTRAINT opaque_id__length_ck CHECK (char_length(VALUE) BETWEEN 1 AND 128);
CREATE DOMAIN sha256_hex AS text CONSTRAINT sha256_hex__format_ck CHECK (VALUE ~ '^[0-9a-f]{64}$');
CREATE DOMAIN safe_uint AS bigint CONSTRAINT safe_uint__bounds_ck CHECK (VALUE BETWEEN 0 AND 9007199254740991);

-- 内部用户与去标识状态
CREATE TABLE users (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  display_name text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  last_login_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT users__pk PRIMARY KEY (id),
  CONSTRAINT users__check_1 CHECK (status IN ('active','suspended','deleting','deleted')),
  CONSTRAINT users__check_2 CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT users__check_3 CHECK (revision > 0)
);
-- 外部身份；加密映射保管于秘密服务，匹配仅用摘要
CREATE TABLE auth_identities (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id opaque_id NOT NULL,
  provider text NOT NULL,
  app_id text NOT NULL,
  subject_digest sha256_hex NOT NULL,
  union_scope text,
  union_digest sha256_hex,
  verified_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT auth_identities__pk PRIMARY KEY (id),
  CONSTRAINT auth_identities__check_1 CHECK (provider IN ('wechat_mini','wechat_web','phone','app_reserved')),
  CONSTRAINT auth_identities__check_2 CHECK ((union_scope IS NULL) = (union_digest IS NULL)),
  CONSTRAINT auth_identities__unique_1 UNIQUE (provider, app_id, subject_digest),
  CONSTRAINT auth_identities__fk_1 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX auth_identities__ref_1_ix ON auth_identities (user_id);
-- 网页 cookie／小程序 bearer 的服务器会话
CREATE TABLE auth_sessions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id opaque_id NOT NULL,
  client_kind text NOT NULL,
  refresh_hash sha256_hex NOT NULL,
  csrf_hash sha256_hex,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_from_id opaque_id,
  CONSTRAINT auth_sessions__pk PRIMARY KEY (id),
  CONSTRAINT auth_sessions__check_1 CHECK (client_kind IN ('web','mini','app_reserved')),
  CONSTRAINT auth_sessions__check_2 CHECK (expires_at > created_at),
  CONSTRAINT auth_sessions__unique_1 UNIQUE (refresh_hash),
  CONSTRAINT auth_sessions__fk_1 FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT auth_sessions__fk_2 FOREIGN KEY (rotated_from_id) REFERENCES auth_sessions(id)
);
CREATE INDEX auth_sessions__ref_1_ix ON auth_sessions (user_id);
CREATE INDEX auth_sessions__ref_2_ix ON auth_sessions (rotated_from_id);
-- 二维码、登录和再认证一次性挑战
CREATE TABLE auth_challenges (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id opaque_id,
  kind text NOT NULL,
  token_hash sha256_hex NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT auth_challenges__pk PRIMARY KEY (id),
  CONSTRAINT auth_challenges__check_1 CHECK (kind IN ('web_qr','login','binding','deletion')),
  CONSTRAINT auth_challenges__check_2 CHECK (state IN ('pending','confirmed','consumed','expired','cancelled')),
  CONSTRAINT auth_challenges__check_3 CHECK (expires_at > created_at),
  CONSTRAINT auth_challenges__check_4 CHECK (revision > 0),
  CONSTRAINT auth_challenges__unique_1 UNIQUE (token_hash),
  CONSTRAINT auth_challenges__fk_1 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX auth_challenges__ref_1_ix ON auth_challenges (user_id);
-- 绑定需现有身份再认证；身份冲突不自动合并
CREATE TABLE binding_requests (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id opaque_id NOT NULL,
  challenge_id opaque_id NOT NULL,
  provider text NOT NULL,
  app_id text NOT NULL,
  subject_digest sha256_hex NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT binding_requests__pk PRIMARY KEY (id),
  CONSTRAINT binding_requests__check_1 CHECK (state IN ('pending','bound','conflict','expired','cancelled')),
  CONSTRAINT binding_requests__check_2 CHECK (expires_at > created_at),
  CONSTRAINT binding_requests__check_3 CHECK (revision > 0),
  CONSTRAINT binding_requests__fk_1 FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT binding_requests__fk_2 FOREIGN KEY (challenge_id) REFERENCES auth_challenges(id)
);
CREATE INDEX binding_requests__ref_1_ix ON binding_requests (user_id);
CREATE INDEX binding_requests__ref_2_ix ON binding_requests (challenge_id);
-- 账号删除工作流与法定留存检查
CREATE TABLE account_deletion_requests (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id opaque_id NOT NULL,
  state text NOT NULL DEFAULT 'requested',
  not_before timestamptz NOT NULL,
  confirmed_at timestamptz,
  completed_at timestamptz,
  reason_code text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT account_deletion_requests__pk PRIMARY KEY (id),
  CONSTRAINT account_deletion_requests__check_1 CHECK (state IN ('requested','confirmed','blocked','executing','completed','cancelled')),
  CONSTRAINT account_deletion_requests__check_2 CHECK (not_before >= created_at),
  CONSTRAINT account_deletion_requests__check_3 CHECK (revision > 0),
  CONSTRAINT account_deletion_requests__fk_1 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX account_deletion_requests__ref_1_ix ON account_deletion_requests (user_id);
-- 稳定资源归属；成员变动不改变资产 workspace
CREATE TABLE workspaces (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id opaque_id NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  CONSTRAINT workspaces__pk PRIMARY KEY (id),
  CONSTRAINT workspaces__check_1 CHECK (kind IN ('personal','studio','platform')),
  CONSTRAINT workspaces__check_2 CHECK (state IN ('active','suspended','deleting','deleted')),
  CONSTRAINT workspaces__check_3 CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT workspaces__check_4 CHECK (revision > 0),
  CONSTRAINT workspaces__fk_1 FOREIGN KEY (owner_user_id) REFERENCES users(id)
);
CREATE INDEX workspaces__ref_1_ix ON workspaces (owner_user_id);
-- 成员角色；唯一 owner 与席位由事务服务保证
CREATE TABLE workspace_members (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  user_id opaque_id NOT NULL,
  role text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT workspace_members__pk PRIMARY KEY (id),
  CONSTRAINT workspace_members__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT workspace_members__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT workspace_members__check_1 CHECK (role IN ('owner','admin','designer','viewer')),
  CONSTRAINT workspace_members__check_2 CHECK (state IN ('invited','active','removed')),
  CONSTRAINT workspace_members__check_3 CHECK (revision > 0),
  CONSTRAINT workspace_members__unique_1 UNIQUE (workspace_id, user_id),
  CONSTRAINT workspace_members__fk_1 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX workspace_members__ref_1_ix ON workspace_members (user_id);
-- 空间偏好不能提升平台配额
CREATE TABLE workspace_settings (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  default_width_mm numeric(10,4) NOT NULL DEFAULT 300,
  default_height_mm numeric(10,4) NOT NULL DEFAULT 300,
  share_enabled boolean NOT NULL DEFAULT false,
  notification_enabled boolean NOT NULL DEFAULT true,
  settings_json jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT workspace_settings__pk PRIMARY KEY (id),
  CONSTRAINT workspace_settings__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT workspace_settings__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT workspace_settings__check_1 CHECK (revision > 0),
  CONSTRAINT workspace_settings__check_2 CHECK (default_width_mm > 0 AND default_width_mm <= 2000),
  CONSTRAINT workspace_settings__check_3 CHECK (default_height_mm > 0 AND default_height_mm <= 2000),
  CONSTRAINT workspace_settings__check_4 CHECK (jsonb_typeof(settings_json) = 'object'),
  CONSTRAINT workspace_settings__unique_1 UNIQUE (workspace_id)
);
-- 个人界面偏好
CREATE TABLE user_preferences (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id opaque_id NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  locale text NOT NULL DEFAULT 'zh-CN',
  display_timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  preferences_json jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT user_preferences__pk PRIMARY KEY (id),
  CONSTRAINT user_preferences__check_1 CHECK (revision > 0),
  CONSTRAINT user_preferences__check_2 CHECK (jsonb_typeof(preferences_json) = 'object'),
  CONSTRAINT user_preferences__unique_1 UNIQUE (user_id),
  CONSTRAINT user_preferences__fk_1 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX user_preferences__ref_1_ix ON user_preferences (user_id);
-- 秘密版本引用；从不存原始密钥
CREATE TABLE secret_references (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  secret_ref text NOT NULL,
  secret_version text NOT NULL,
  purpose text NOT NULL,
  state text NOT NULL DEFAULT 'available',
  CONSTRAINT secret_references__pk PRIMARY KEY (id),
  CONSTRAINT secret_references__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT secret_references__check_2 CHECK (state IN ('available','revoked','retired')),
  CONSTRAINT secret_references__check_3 CHECK (char_length(secret_ref) BETWEEN 1 AND 512),
  CONSTRAINT secret_references__check_4 CHECK (char_length(secret_version) BETWEEN 1 AND 128),
  CONSTRAINT secret_references__unique_1 UNIQUE (environment, secret_ref, secret_version),
  CONSTRAINT secret_references__environment_pair_uq UNIQUE (id, environment)
);
-- 平台最小权限管理员
CREATE TABLE admin_role_assignments (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id opaque_id NOT NULL,
  role text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT admin_role_assignments__pk PRIMARY KEY (id),
  CONSTRAINT admin_role_assignments__check_1 CHECK (role IN ('platform_ops','finance','content','support','auditor')),
  CONSTRAINT admin_role_assignments__unique_1 UNIQUE (user_id, role),
  CONSTRAINT admin_role_assignments__fk_1 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX admin_role_assignments__ref_1_ix ON admin_role_assignments (user_id);
-- 动态配置草稿 CAS；发布前 schema 与连接测试
CREATE TABLE config_drafts (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  namespace text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  schema_version integer NOT NULL DEFAULT 1,
  body jsonb NOT NULL,
  body_hash sha256_hex NOT NULL,
  updated_by opaque_id NOT NULL,
  CONSTRAINT config_drafts__pk PRIMARY KEY (id),
  CONSTRAINT config_drafts__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT config_drafts__check_2 CHECK (revision > 0),
  CONSTRAINT config_drafts__check_3 CHECK (schema_version > 0),
  CONSTRAINT config_drafts__check_4 CHECK (jsonb_typeof(body) = 'object'),
  CONSTRAINT config_drafts__unique_1 UNIQUE (environment, namespace),
  CONSTRAINT config_drafts__fk_1 FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT config_drafts__environment_pair_uq UNIQUE (id, environment)
);
CREATE INDEX config_drafts__ref_1_ix ON config_drafts (updated_by);
-- 不可变配置发布；回滚是发布新指针
CREATE TABLE config_releases (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  release_number bigint NOT NULL,
  schema_version integer NOT NULL,
  manifest_hash sha256_hex NOT NULL,
  manifest jsonb NOT NULL,
  published_by opaque_id NOT NULL,
  previous_release_id opaque_id,
  CONSTRAINT config_releases__pk PRIMARY KEY (id),
  CONSTRAINT config_releases__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT config_releases__check_2 CHECK (release_number > 0),
  CONSTRAINT config_releases__check_3 CHECK (schema_version > 0),
  CONSTRAINT config_releases__check_4 CHECK (jsonb_typeof(manifest) = 'object'),
  CONSTRAINT config_releases__unique_1 UNIQUE (environment, release_number),
  CONSTRAINT config_releases__fk_1 FOREIGN KEY (published_by) REFERENCES users(id),
  CONSTRAINT config_releases__environment_pair_uq UNIQUE (id, environment),
  CONSTRAINT config_releases__previous_environment_fk FOREIGN KEY (previous_release_id, environment) REFERENCES config_releases(id, environment)
);
CREATE INDEX config_releases__ref_1_ix ON config_releases (published_by);
CREATE INDEX config_releases__ref_2_ix ON config_releases (previous_release_id);
-- 每环境原子生效指针
CREATE TABLE config_active_releases (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  release_id opaque_id NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT config_active_releases__pk PRIMARY KEY (id),
  CONSTRAINT config_active_releases__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT config_active_releases__check_2 CHECK (revision > 0),
  CONSTRAINT config_active_releases__unique_1 UNIQUE (environment),
  CONSTRAINT config_active_releases__release_environment_fk FOREIGN KEY (release_id, environment) REFERENCES config_releases(id, environment)
);
CREATE INDEX config_active_releases__ref_1_ix ON config_active_releases (release_id);
-- 发布中命名空间不可变快照
CREATE TABLE config_release_items (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  release_id opaque_id NOT NULL,
  namespace text NOT NULL,
  schema_version integer NOT NULL,
  body_hash sha256_hex NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT config_release_items__pk PRIMARY KEY (id),
  CONSTRAINT config_release_items__check_1 CHECK (schema_version > 0),
  CONSTRAINT config_release_items__check_2 CHECK (jsonb_typeof(body) = 'object'),
  CONSTRAINT config_release_items__unique_1 UNIQUE (release_id, namespace),
  CONSTRAINT config_release_items__fk_1 FOREIGN KEY (release_id) REFERENCES config_releases(id)
);
CREATE INDEX config_release_items__ref_1_ix ON config_release_items (release_id);
-- 明确测试目标 hash；报告不伪称已执行样图
CREATE TABLE config_tests (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  draft_id opaque_id,
  release_id opaque_id,
  subject_kind text NOT NULL,
  subject_id opaque_id NOT NULL,
  subject_hash sha256_hex NOT NULL,
  test_kind text NOT NULL,
  state text NOT NULL,
  report jsonb NOT NULL,
  estimated_cost_fen safe_uint NOT NULL DEFAULT 0,
  actual_cost_fen safe_uint NOT NULL DEFAULT 0,
  executed_by opaque_id NOT NULL,
  CONSTRAINT config_tests__pk PRIMARY KEY (id),
  CONSTRAINT config_tests__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT config_tests__check_2 CHECK (test_kind IN ('schema','connection','capability','sample','storage_roundtrip')),
  CONSTRAINT config_tests__check_3 CHECK (state IN ('passed','failed','cleanup_required')),
  CONSTRAINT config_tests__check_4 CHECK (jsonb_typeof(report) = 'object'),
  CONSTRAINT config_tests__fk_3 FOREIGN KEY (executed_by) REFERENCES users(id),
  CONSTRAINT config_tests__draft_environment_fk FOREIGN KEY (draft_id, environment) REFERENCES config_drafts(id, environment),
  CONSTRAINT config_tests__release_environment_fk FOREIGN KEY (release_id, environment) REFERENCES config_releases(id, environment)
);
CREATE INDEX config_tests__ref_1_ix ON config_tests (draft_id);
CREATE INDEX config_tests__ref_2_ix ON config_tests (release_id);
CREATE INDEX config_tests__ref_3_ix ON config_tests (executed_by);
-- 追加审计；禁止原图、完整提示词、密钥及令牌
CREATE TABLE audit_events (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id,
  actor_user_id opaque_id,
  action text NOT NULL,
  target_kind text NOT NULL,
  target_id opaque_id,
  request_id opaque_id NOT NULL,
  reason text NOT NULL,
  redacted_details jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT audit_events__pk PRIMARY KEY (id),
  CONSTRAINT audit_events__check_1 CHECK (jsonb_typeof(redacted_details) = 'object'),
  CONSTRAINT audit_events__fk_1 FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT audit_events__fk_2 FOREIGN KEY (actor_user_id) REFERENCES users(id)
);
CREATE INDEX audit_events__ref_1_ix ON audit_events (workspace_id);
CREATE INDEX audit_events__ref_2_ix ON audit_events (actor_user_id);
-- 字体、模板、模型与示例的不可变授权证据
CREATE TABLE license_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  license_key text NOT NULL,
  version integer NOT NULL,
  source_uri text NOT NULL,
  terms_hash sha256_hex NOT NULL,
  commercial_allowed boolean NOT NULL,
  embedding_allowed boolean NOT NULL DEFAULT false,
  reference_input_allowed boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  territories text[] NOT NULL,
  restrictions jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT license_versions__pk PRIMARY KEY (id),
  CONSTRAINT license_versions__check_1 CHECK (version > 0),
  CONSTRAINT license_versions__check_2 CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT license_versions__check_3 CHECK (jsonb_typeof(restrictions) = 'object'),
  CONSTRAINT license_versions__unique_1 UNIQUE (license_key, version)
);
-- 稳定存储连接身份；旧版本只读保留
CREATE TABLE storage_profiles (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT storage_profiles__pk PRIMARY KEY (id),
  CONSTRAINT storage_profiles__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT storage_profiles__check_2 CHECK (state IN ('draft','active','readonly','retired')),
  CONSTRAINT storage_profiles__check_3 CHECK (revision > 0),
  CONSTRAINT storage_profiles__unique_1 UNIQUE (environment, name),
  CONSTRAINT storage_profiles__unique_2 UNIQUE (id, environment)
);
-- 不可变存储定位配置，不随新根前缀改写旧对象
CREATE TABLE storage_profile_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  profile_id opaque_id NOT NULL,
  version integer NOT NULL,
  environment text NOT NULL,
  provider text NOT NULL,
  adapter_version text NOT NULL,
  region text NOT NULL,
  endpoint text NOT NULL,
  bucket text NOT NULL,
  base_prefix text NOT NULL,
  key_pattern_version text NOT NULL DEFAULT 'v1',
  secret_reference_id opaque_id NOT NULL,
  public_access boolean NOT NULL DEFAULT false,
  download_ttl_seconds integer NOT NULL DEFAULT 300,
  upload_ttl_seconds integer NOT NULL DEFAULT 900,
  encryption_mode text NOT NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT storage_profile_versions__pk PRIMARY KEY (id),
  CONSTRAINT storage_profile_versions__check_1 CHECK (version > 0),
  CONSTRAINT storage_profile_versions__check_2 CHECK (provider IN ('oss','cos','s3')),
  CONSTRAINT storage_profile_versions__check_3 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT storage_profile_versions__check_4 CHECK (endpoint ~ '^https://'),
  CONSTRAINT storage_profile_versions__check_5 CHECK (char_length(base_prefix) BETWEEN 1 AND 256 AND base_prefix !~ '(^/|\.\.|[[:cntrl:]])' AND position(chr(92) in base_prefix) = 0),
  CONSTRAINT storage_profile_versions__check_6 CHECK (key_pattern_version = 'v1'),
  CONSTRAINT storage_profile_versions__check_7 CHECK (NOT public_access),
  CONSTRAINT storage_profile_versions__check_8 CHECK (download_ttl_seconds BETWEEN 1 AND 3600),
  CONSTRAINT storage_profile_versions__check_9 CHECK (upload_ttl_seconds BETWEEN 1 AND 3600),
  CONSTRAINT storage_profile_versions__check_10 CHECK (encryption_mode IN ('providerManaged','kms')),
  CONSTRAINT storage_profile_versions__check_11 CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT storage_profile_versions__unique_1 UNIQUE (profile_id, version),
  CONSTRAINT storage_profile_versions__fk_1 FOREIGN KEY (profile_id, environment) REFERENCES storage_profiles(id, environment),
  CONSTRAINT storage_profile_versions__secret_environment_fk FOREIGN KEY (secret_reference_id, environment) REFERENCES secret_references(id, environment)
);
CREATE INDEX storage_profile_versions__ref_1_ix ON storage_profile_versions (profile_id, environment);
CREATE INDEX storage_profile_versions__ref_2_ix ON storage_profile_versions (secret_reference_id);
-- 物理对象与定位；迁移创建新对象，资产 locator 条件切换
CREATE TABLE storage_objects (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  profile_version_id opaque_id NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL,
  object_version_id text,
  kind text NOT NULL,
  sha256 sha256_hex NOT NULL,
  byte_size safe_uint NOT NULL,
  mime_type text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  locator_revision bigint NOT NULL DEFAULT 1,
  verified_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT storage_objects__pk PRIMARY KEY (id),
  CONSTRAINT storage_objects__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT storage_objects__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT storage_objects__check_1 CHECK (kind IN ('original','normalized','preview','document','font','template','generated','export','temporary')),
  CONSTRAINT storage_objects__check_2 CHECK (state IN ('pending','verified','quarantine','deleting','deleted','missing')),
  CONSTRAINT storage_objects__check_3 CHECK (locator_revision > 0),
  CONSTRAINT storage_objects__check_4 CHECK (char_length(object_key) BETWEEN 1 AND 1024 AND object_key !~ '(^/|[[:cntrl:]])'),
  CONSTRAINT storage_objects__unique_1 UNIQUE (profile_version_id, bucket, object_key),
  CONSTRAINT storage_objects__fk_1 FOREIGN KEY (profile_version_id) REFERENCES storage_profile_versions(id)
);
CREATE INDEX storage_objects__ref_1_ix ON storage_objects (profile_version_id);
-- 逻辑目录；根为 NULL，NFC casefold 由事务服务计算
CREATE TABLE asset_folders (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  parent_id opaque_id,
  name text NOT NULL,
  normalized_name text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_by opaque_id NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT asset_folders__pk PRIMARY KEY (id),
  CONSTRAINT asset_folders__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT asset_folders__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT asset_folders__check_1 CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT asset_folders__check_2 CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name) AND name NOT IN ('.','..') AND name !~ '[/[:cntrl:]]' AND position(chr(92) in name) = 0),
  CONSTRAINT asset_folders__check_3 CHECK (char_length(normalized_name) BETWEEN 1 AND 240),
  CONSTRAINT asset_folders__check_4 CHECK (revision > 0),
  CONSTRAINT asset_folders__fk_1 FOREIGN KEY (workspace_id, parent_id) REFERENCES asset_folders(workspace_id, id),
  CONSTRAINT asset_folders__fk_2 FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX asset_folders__ref_1_ix ON asset_folders (workspace_id, parent_id);
CREATE INDEX asset_folders__ref_2_ix ON asset_folders (created_by);
-- 稳定 assetId 与不可变字节内容；文件夹/定位可事务更新
CREATE TABLE assets (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  folder_id opaque_id,
  original_object_id opaque_id,
  original_filename text NOT NULL,
  sha256 sha256_hex,
  byte_size safe_uint NOT NULL,
  width integer,
  height integer,
  mime_type text NOT NULL,
  origin text NOT NULL,
  state text NOT NULL DEFAULT 'pending_upload',
  revision bigint NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  CONSTRAINT assets__pk PRIMARY KEY (id),
  CONSTRAINT assets__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT assets__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT assets__check_1 CHECK (byte_size BETWEEN 1 AND 25000000),
  CONSTRAINT assets__check_2 CHECK ((width IS NULL) = (height IS NULL)),
  CONSTRAINT assets__check_3 CHECK (state NOT IN ('ready','trashed') OR (original_object_id IS NOT NULL AND sha256 IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL)),
  CONSTRAINT assets__check_4 CHECK (width BETWEEN 1 AND 80000000 AND height BETWEEN 1 AND 80000000 AND width::bigint * height::bigint <= 80000000),
  CONSTRAINT assets__check_5 CHECK (mime_type IN ('image/jpeg','image/png')),
  CONSTRAINT assets__check_6 CHECK (origin IN ('upload','generated','import')),
  CONSTRAINT assets__check_7 CHECK (state IN ('pending_upload','pending_scan','quarantine','ready','rejected','trashed','missing','deleted')),
  CONSTRAINT assets__check_8 CHECK (revision > 0),
  CONSTRAINT assets__check_9 CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  CONSTRAINT assets__fk_1 FOREIGN KEY (workspace_id, folder_id) REFERENCES asset_folders(workspace_id, id),
  CONSTRAINT assets__fk_2 FOREIGN KEY (workspace_id, original_object_id) REFERENCES storage_objects(workspace_id, id)
);
CREATE INDEX assets__ref_1_ix ON assets (workspace_id, folder_id);
CREATE INDEX assets__ref_2_ix ON assets (workspace_id, original_object_id);
-- 归一化和预览不可变版本
CREATE TABLE asset_variants (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  asset_id opaque_id NOT NULL,
  variant text NOT NULL,
  storage_object_id opaque_id NOT NULL,
  pipeline_version text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  CONSTRAINT asset_variants__pk PRIMARY KEY (id),
  CONSTRAINT asset_variants__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT asset_variants__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT asset_variants__check_1 CHECK (variant IN ('normalized','preview','thumbnail')),
  CONSTRAINT asset_variants__check_2 CHECK (width > 0 AND height > 0),
  CONSTRAINT asset_variants__unique_1 UNIQUE (workspace_id, asset_id, variant, pipeline_version),
  CONSTRAINT asset_variants__fk_1 FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id),
  CONSTRAINT asset_variants__fk_2 FOREIGN KEY (workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)
);
CREATE INDEX asset_variants__ref_1_ix ON asset_variants (workspace_id, asset_id);
CREATE INDEX asset_variants__ref_2_ix ON asset_variants (workspace_id, storage_object_id);
-- 物理字节占用投影；回收站仍计量
CREATE TABLE storage_usage_accounts (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  category text NOT NULL,
  used_bytes safe_uint NOT NULL DEFAULT 0,
  reserved_bytes safe_uint NOT NULL DEFAULT 0,
  limit_bytes safe_uint NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT storage_usage_accounts__pk PRIMARY KEY (id),
  CONSTRAINT storage_usage_accounts__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT storage_usage_accounts__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT storage_usage_accounts__check_1 CHECK (category IN ('original','derived','document','generated','export')),
  CONSTRAINT storage_usage_accounts__check_2 CHECK (revision > 0),
  CONSTRAINT storage_usage_accounts__unique_1 UNIQUE (workspace_id, category)
);
-- 上传/产物并发容量预占
CREATE TABLE storage_quota_reservations (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  usage_account_id opaque_id NOT NULL,
  operation_id opaque_id NOT NULL,
  bytes safe_uint NOT NULL,
  state text NOT NULL DEFAULT 'held',
  expires_at timestamptz NOT NULL,
  CONSTRAINT storage_quota_reservations__pk PRIMARY KEY (id),
  CONSTRAINT storage_quota_reservations__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT storage_quota_reservations__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT storage_quota_reservations__check_1 CHECK (bytes > 0),
  CONSTRAINT storage_quota_reservations__check_2 CHECK (state IN ('held','consumed','released','expired')),
  CONSTRAINT storage_quota_reservations__check_3 CHECK (expires_at > created_at),
  CONSTRAINT storage_quota_reservations__unique_1 UNIQUE (workspace_id, operation_id),
  CONSTRAINT storage_quota_reservations__fk_1 FOREIGN KEY (workspace_id, usage_account_id) REFERENCES storage_usage_accounts(workspace_id, id)
);
CREATE INDEX storage_quota_reservations__ref_1_ix ON storage_quota_reservations (workspace_id, usage_account_id);
-- 受限上传凭据不入库；完成后 HEAD/magic/解码
CREATE TABLE upload_sessions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  asset_id opaque_id NOT NULL,
  quota_reservation_id opaque_id NOT NULL,
  profile_version_id opaque_id NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL,
  created_by opaque_id NOT NULL,
  expected_bytes safe_uint NOT NULL,
  expected_mime text NOT NULL,
  state text NOT NULL DEFAULT 'issued',
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT upload_sessions__pk PRIMARY KEY (id),
  CONSTRAINT upload_sessions__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT upload_sessions__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT upload_sessions__check_1 CHECK (expected_bytes BETWEEN 1 AND 25000000),
  CONSTRAINT upload_sessions__check_2 CHECK (expected_mime IN ('image/jpeg','image/png')),
  CONSTRAINT upload_sessions__check_3 CHECK (state IN ('issued','uploaded','verifying','ready','rejected','expired')),
  CONSTRAINT upload_sessions__check_4 CHECK (expires_at > created_at),
  CONSTRAINT upload_sessions__check_5 CHECK (revision > 0),
  CONSTRAINT upload_sessions__unique_1 UNIQUE (workspace_id, asset_id),
  CONSTRAINT upload_sessions__fk_1 FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id),
  CONSTRAINT upload_sessions__fk_2 FOREIGN KEY (workspace_id, quota_reservation_id) REFERENCES storage_quota_reservations(workspace_id, id),
  CONSTRAINT upload_sessions__fk_3 FOREIGN KEY (profile_version_id) REFERENCES storage_profile_versions(id),
  CONSTRAINT upload_sessions__fk_4 FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX upload_sessions__ref_1_ix ON upload_sessions (workspace_id, asset_id);
CREATE INDEX upload_sessions__ref_2_ix ON upload_sessions (workspace_id, quota_reservation_id);
CREATE INDEX upload_sessions__ref_3_ix ON upload_sessions (profile_version_id);
CREATE INDEX upload_sessions__ref_4_ix ON upload_sessions (created_by);
-- 整批删除/恢复操作日志；有引用则整批拒绝
CREATE TABLE trash_operations (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  operation_id opaque_id NOT NULL,
  created_by opaque_id NOT NULL,
  state text NOT NULL DEFAULT 'trashed',
  restore_until timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT trash_operations__pk PRIMARY KEY (id),
  CONSTRAINT trash_operations__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT trash_operations__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT trash_operations__check_1 CHECK (state IN ('trashed','restored','purging','purged')),
  CONSTRAINT trash_operations__check_2 CHECK (restore_until > created_at),
  CONSTRAINT trash_operations__check_3 CHECK (revision > 0),
  CONSTRAINT trash_operations__unique_1 UNIQUE (workspace_id, operation_id),
  CONSTRAINT trash_operations__fk_1 FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX trash_operations__ref_1_ix ON trash_operations (created_by);
-- 恢复原父级与名称；资产和目录二选一
CREATE TABLE trash_items (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  trash_operation_id opaque_id NOT NULL,
  asset_id opaque_id,
  folder_id opaque_id,
  original_parent_id opaque_id,
  original_name text NOT NULL,
  expected_revision bigint NOT NULL,
  CONSTRAINT trash_items__pk PRIMARY KEY (id),
  CONSTRAINT trash_items__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT trash_items__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT trash_items__check_1 CHECK (num_nonnulls(asset_id, folder_id) = 1),
  CONSTRAINT trash_items__check_2 CHECK (expected_revision > 0),
  CONSTRAINT trash_items__fk_1 FOREIGN KEY (workspace_id, trash_operation_id) REFERENCES trash_operations(workspace_id, id),
  CONSTRAINT trash_items__fk_2 FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id),
  CONSTRAINT trash_items__fk_3 FOREIGN KEY (workspace_id, folder_id) REFERENCES asset_folders(workspace_id, id),
  CONSTRAINT trash_items__fk_4 FOREIGN KEY (workspace_id, original_parent_id) REFERENCES asset_folders(workspace_id, id)
);
CREATE INDEX trash_items__ref_1_ix ON trash_items (workspace_id, trash_operation_id);
CREATE INDEX trash_items__ref_2_ix ON trash_items (workspace_id, asset_id);
CREATE INDEX trash_items__ref_3_ix ON trash_items (workspace_id, folder_id);
CREATE INDEX trash_items__ref_4_ix ON trash_items (workspace_id, original_parent_id);
-- 人工确认后复制/校验/切换，旧副本单独清理
CREATE TABLE storage_migrations (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  source_profile_version_id opaque_id NOT NULL,
  target_profile_version_id opaque_id NOT NULL,
  state text NOT NULL DEFAULT 'planned',
  confirmed_by opaque_id NOT NULL,
  estimated_bytes safe_uint NOT NULL,
  estimated_cost_fen safe_uint NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT storage_migrations__pk PRIMARY KEY (id),
  CONSTRAINT storage_migrations__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT storage_migrations__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT storage_migrations__check_1 CHECK (source_profile_version_id <> target_profile_version_id),
  CONSTRAINT storage_migrations__check_2 CHECK (state IN ('planned','copying','verifying','switching','retaining','completed','failed','cancelled')),
  CONSTRAINT storage_migrations__check_3 CHECK (revision > 0),
  CONSTRAINT storage_migrations__fk_1 FOREIGN KEY (source_profile_version_id) REFERENCES storage_profile_versions(id),
  CONSTRAINT storage_migrations__fk_2 FOREIGN KEY (target_profile_version_id) REFERENCES storage_profile_versions(id),
  CONSTRAINT storage_migrations__fk_3 FOREIGN KEY (confirmed_by) REFERENCES users(id)
);
CREATE INDEX storage_migrations__ref_1_ix ON storage_migrations (source_profile_version_id);
CREATE INDEX storage_migrations__ref_2_ix ON storage_migrations (target_profile_version_id);
CREATE INDEX storage_migrations__ref_3_ix ON storage_migrations (confirmed_by);
-- 逐对象可恢复检查点；pin 仍引用原对象
CREATE TABLE storage_migration_items (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  migration_id opaque_id NOT NULL,
  source_object_id opaque_id NOT NULL,
  target_object_id opaque_id,
  expected_locator_revision bigint NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  verified_hash sha256_hex,
  retain_source_until timestamptz,
  error_code text,
  CONSTRAINT storage_migration_items__pk PRIMARY KEY (id),
  CONSTRAINT storage_migration_items__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT storage_migration_items__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT storage_migration_items__check_1 CHECK (state IN ('pending','copied','verified','switched','retained','cleaned','failed')),
  CONSTRAINT storage_migration_items__check_2 CHECK (expected_locator_revision > 0),
  CONSTRAINT storage_migration_items__check_3 CHECK (target_object_id IS NULL OR target_object_id <> source_object_id),
  CONSTRAINT storage_migration_items__unique_1 UNIQUE (workspace_id, migration_id, source_object_id),
  CONSTRAINT storage_migration_items__fk_1 FOREIGN KEY (workspace_id, migration_id) REFERENCES storage_migrations(workspace_id, id),
  CONSTRAINT storage_migration_items__fk_2 FOREIGN KEY (workspace_id, source_object_id) REFERENCES storage_objects(workspace_id, id),
  CONSTRAINT storage_migration_items__fk_3 FOREIGN KEY (workspace_id, target_object_id) REFERENCES storage_objects(workspace_id, id)
);
CREATE INDEX storage_migration_items__ref_1_ix ON storage_migration_items (workspace_id, migration_id);
CREATE INDEX storage_migration_items__ref_2_ix ON storage_migration_items (workspace_id, source_object_id);
CREATE INDEX storage_migration_items__ref_3_ix ON storage_migration_items (workspace_id, target_object_id);
-- 项目当前版本 CAS；创建事务必须插入 revision 1
CREATE TABLE projects (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  name text NOT NULL,
  current_revision bigint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'active',
  created_by opaque_id NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT projects__pk PRIMARY KEY (id),
  CONSTRAINT projects__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT projects__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT projects__check_1 CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT projects__check_2 CHECK (current_revision >= 0),
  CONSTRAINT projects__check_3 CHECK (state IN ('active','archived','trashed','deleted')),
  CONSTRAINT projects__fk_1 FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX projects__ref_1_ix ON projects (created_by);
-- 不可变文档版本；对象承载 canonical document schema
CREATE TABLE project_revisions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  project_id opaque_id NOT NULL,
  number bigint NOT NULL,
  schema_version integer NOT NULL,
  storage_object_id opaque_id NOT NULL,
  document_hash sha256_hex NOT NULL,
  spread_count integer NOT NULL,
  photo_count integer NOT NULL,
  created_by opaque_id NOT NULL,
  command_id opaque_id NOT NULL,
  base_revision bigint NOT NULL,
  CONSTRAINT project_revisions__pk PRIMARY KEY (id),
  CONSTRAINT project_revisions__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT project_revisions__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT project_revisions__check_1 CHECK (number > 0),
  CONSTRAINT project_revisions__check_2 CHECK (schema_version > 0),
  CONSTRAINT project_revisions__check_3 CHECK (spread_count BETWEEN 1 AND 50),
  CONSTRAINT project_revisions__check_4 CHECK (photo_count BETWEEN 0 AND 500),
  CONSTRAINT project_revisions__check_5 CHECK (base_revision >= 0 AND number = base_revision + 1),
  CONSTRAINT project_revisions__unique_1 UNIQUE (workspace_id, project_id, number),
  CONSTRAINT project_revisions__unique_2 UNIQUE (workspace_id, project_id, command_id),
  CONSTRAINT project_revisions__unique_3 UNIQUE (workspace_id, project_id, id),
  CONSTRAINT project_revisions__fk_1 FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id),
  CONSTRAINT project_revisions__fk_2 FOREIGN KEY (workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id),
  CONSTRAINT project_revisions__fk_3 FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX project_revisions__ref_1_ix ON project_revisions (workspace_id, project_id);
CREATE INDEX project_revisions__ref_2_ix ON project_revisions (workspace_id, storage_object_id);
CREATE INDEX project_revisions__ref_3_ix ON project_revisions (created_by);
-- 文档资产引用索引支持引用阻断与回收
CREATE TABLE project_revision_assets (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  revision_id opaque_id NOT NULL,
  asset_id opaque_id NOT NULL,
  CONSTRAINT project_revision_assets__pk PRIMARY KEY (id),
  CONSTRAINT project_revision_assets__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT project_revision_assets__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT project_revision_assets__unique_1 UNIQUE (workspace_id, revision_id, asset_id),
  CONSTRAINT project_revision_assets__fk_1 FOREIGN KEY (workspace_id, revision_id) REFERENCES project_revisions(workspace_id, id),
  CONSTRAINT project_revision_assets__fk_2 FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id)
);
CREATE INDEX project_revision_assets__ref_1_ix ON project_revision_assets (workspace_id, revision_id);
CREATE INDEX project_revision_assets__ref_2_ix ON project_revision_assets (workspace_id, asset_id);
-- 冲突恢复草稿；不冒充已保存 revision
CREATE TABLE recovery_drafts (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  project_id opaque_id NOT NULL,
  user_id opaque_id NOT NULL,
  base_revision bigint NOT NULL,
  schema_version integer NOT NULL,
  storage_object_id opaque_id NOT NULL,
  body_hash sha256_hex NOT NULL,
  expires_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT recovery_drafts__pk PRIMARY KEY (id),
  CONSTRAINT recovery_drafts__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT recovery_drafts__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT recovery_drafts__check_1 CHECK (base_revision > 0),
  CONSTRAINT recovery_drafts__check_2 CHECK (schema_version > 0),
  CONSTRAINT recovery_drafts__check_3 CHECK (expires_at > created_at),
  CONSTRAINT recovery_drafts__check_4 CHECK (revision > 0),
  CONSTRAINT recovery_drafts__fk_1 FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id),
  CONSTRAINT recovery_drafts__fk_2 FOREIGN KEY (workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id),
  CONSTRAINT recovery_drafts__fk_3 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX recovery_drafts__ref_1_ix ON recovery_drafts (workspace_id, project_id);
CREATE INDEX recovery_drafts__ref_2_ix ON recovery_drafts (workspace_id, storage_object_id);
CREATE INDEX recovery_drafts__ref_3_ix ON recovery_drafts (user_id);
-- template 稳定目录项
CREATE TABLE templates (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT templates__pk PRIMARY KEY (id),
  CONSTRAINT templates__check_1 CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT templates__check_2 CHECK (state IN ('draft','review','published','retired')),
  CONSTRAINT templates__check_3 CHECK (revision > 0)
);
-- font 稳定目录项
CREATE TABLE fonts (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT fonts__pk PRIMARY KEY (id),
  CONSTRAINT fonts__check_1 CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT fonts__check_2 CHECK (state IN ('draft','review','published','retired')),
  CONSTRAINT fonts__check_3 CHECK (revision > 0)
);
-- filter 稳定目录项
CREATE TABLE filters (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT filters__pk PRIMARY KEY (id),
  CONSTRAINT filters__check_1 CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT filters__check_2 CHECK (state IN ('draft','review','published','retired')),
  CONSTRAINT filters__check_3 CHECK (revision > 0)
);
-- 不可变模板文档/槽位/小程序可改字段
CREATE TABLE template_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  template_id opaque_id NOT NULL,
  version integer NOT NULL,
  schema_version integer NOT NULL,
  license_version_id opaque_id NOT NULL,
  storage_workspace_id opaque_id NOT NULL,
  storage_object_id opaque_id NOT NULL,
  body_hash sha256_hex NOT NULL,
  slot_count integer NOT NULL,
  editable_fields jsonb NOT NULL,
  constraints_json jsonb NOT NULL,
  CONSTRAINT template_versions__pk PRIMARY KEY (id),
  CONSTRAINT template_versions__check_1 CHECK (version > 0 AND schema_version > 0),
  CONSTRAINT template_versions__check_2 CHECK (slot_count BETWEEN 0 AND 500),
  CONSTRAINT template_versions__check_3 CHECK (jsonb_typeof(editable_fields) = 'array'),
  CONSTRAINT template_versions__check_4 CHECK (jsonb_typeof(constraints_json) = 'object'),
  CONSTRAINT template_versions__unique_1 UNIQUE (template_id, version),
  CONSTRAINT template_versions__fk_1 FOREIGN KEY (template_id) REFERENCES templates(id),
  CONSTRAINT template_versions__fk_2 FOREIGN KEY (license_version_id) REFERENCES license_versions(id),
  CONSTRAINT template_versions__fk_3 FOREIGN KEY (storage_workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)
);
CREATE INDEX template_versions__ref_1_ix ON template_versions (template_id);
CREATE INDEX template_versions__ref_2_ix ON template_versions (license_version_id);
CREATE INDEX template_versions__ref_3_ix ON template_versions (storage_workspace_id, storage_object_id);
-- 不可变授权字体与字形覆盖清单
CREATE TABLE font_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  font_id opaque_id NOT NULL,
  version integer NOT NULL,
  license_version_id opaque_id NOT NULL,
  storage_workspace_id opaque_id NOT NULL,
  storage_object_id opaque_id NOT NULL,
  sha256 sha256_hex NOT NULL,
  family_name text NOT NULL,
  postscript_name text NOT NULL,
  weight integer NOT NULL,
  embedding_allowed boolean NOT NULL,
  coverage_hash sha256_hex NOT NULL,
  CONSTRAINT font_versions__pk PRIMARY KEY (id),
  CONSTRAINT font_versions__check_1 CHECK (version > 0),
  CONSTRAINT font_versions__check_2 CHECK (weight BETWEEN 1 AND 1000),
  CONSTRAINT font_versions__unique_1 UNIQUE (font_id, version),
  CONSTRAINT font_versions__fk_1 FOREIGN KEY (font_id) REFERENCES fonts(id),
  CONSTRAINT font_versions__fk_2 FOREIGN KEY (license_version_id) REFERENCES license_versions(id),
  CONSTRAINT font_versions__fk_3 FOREIGN KEY (storage_workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)
);
CREATE INDEX font_versions__ref_1_ix ON font_versions (font_id);
CREATE INDEX font_versions__ref_2_ix ON font_versions (license_version_id);
CREATE INDEX font_versions__ref_3_ix ON font_versions (storage_workspace_id, storage_object_id);
-- 33 滤镜配方不可变；CPU/GPU 共用版本
CREATE TABLE filter_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  filter_id opaque_id NOT NULL,
  version integer NOT NULL,
  recipe_hash sha256_hex NOT NULL,
  recipe jsonb NOT NULL,
  renderer_version text NOT NULL,
  seed_required boolean NOT NULL,
  license_version_id opaque_id NOT NULL,
  CONSTRAINT filter_versions__pk PRIMARY KEY (id),
  CONSTRAINT filter_versions__check_1 CHECK (version > 0),
  CONSTRAINT filter_versions__check_2 CHECK (jsonb_typeof(recipe) = 'object'),
  CONSTRAINT filter_versions__unique_1 UNIQUE (filter_id, version),
  CONSTRAINT filter_versions__fk_1 FOREIGN KEY (filter_id) REFERENCES filters(id),
  CONSTRAINT filter_versions__fk_2 FOREIGN KEY (license_version_id) REFERENCES license_versions(id)
);
CREATE INDEX filter_versions__ref_1_ix ON filter_versions (filter_id);
CREATE INDEX filter_versions__ref_2_ix ON filter_versions (license_version_id);
-- 商品目录与不可变定价版本分离
CREATE TABLE billing_skus (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  code text NOT NULL,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT billing_skus__pk PRIMARY KEY (id),
  CONSTRAINT billing_skus__check_1 CHECK (state IN ('draft','active','retired')),
  CONSTRAINT billing_skus__check_2 CHECK (revision > 0),
  CONSTRAINT billing_skus__unique_1 UNIQUE (code)
);
-- 订单冻结实际 SKU 版本
CREATE TABLE sku_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sku_id opaque_id NOT NULL,
  version integer NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  price_fen safe_uint NOT NULL,
  duration_days integer NOT NULL,
  credit_grant safe_uint NOT NULL,
  features jsonb NOT NULL,
  license_version_id opaque_id,
  CONSTRAINT sku_versions__pk PRIMARY KEY (id),
  CONSTRAINT sku_versions__check_1 CHECK (version > 0),
  CONSTRAINT sku_versions__check_2 CHECK (currency = 'CNY'),
  CONSTRAINT sku_versions__check_3 CHECK (price_fen <= 1000000000000),
  CONSTRAINT sku_versions__check_4 CHECK (duration_days BETWEEN 0 AND 36500),
  CONSTRAINT sku_versions__check_5 CHECK (jsonb_typeof(features) = 'object'),
  CONSTRAINT sku_versions__unique_1 UNIQUE (sku_id, version),
  CONSTRAINT sku_versions__fk_1 FOREIGN KEY (sku_id) REFERENCES billing_skus(id),
  CONSTRAINT sku_versions__fk_2 FOREIGN KEY (license_version_id) REFERENCES license_versions(id)
);
CREATE INDEX sku_versions__ref_1_ix ON sku_versions (sku_id);
CREATE INDEX sku_versions__ref_2_ix ON sku_versions (license_version_id);
-- 支付事实与权益履约状态分别记录
CREATE TABLE orders (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  sku_version_id opaque_id NOT NULL,
  buyer_user_id opaque_id NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  amount_fen safe_uint NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  fulfillment_state text NOT NULL DEFAULT 'unfulfilled',
  channel text NOT NULL,
  client_platform text NOT NULL,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT orders__pk PRIMARY KEY (id),
  CONSTRAINT orders__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT orders__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT orders__check_1 CHECK (currency = 'CNY'),
  CONSTRAINT orders__check_2 CHECK (amount_fen <= 1000000000000),
  CONSTRAINT orders__check_3 CHECK (state IN ('pending','paid','closed','refund_pending','partially_refunded','refunded')),
  CONSTRAINT orders__check_4 CHECK (fulfillment_state IN ('unfulfilled','fulfilled','reversed','manual_review')),
  CONSTRAINT orders__check_5 CHECK (channel IN ('wechat_pay','wechat_virtual')),
  CONSTRAINT orders__check_6 CHECK (client_platform IN ('web','mini','app_reserved')),
  CONSTRAINT orders__check_7 CHECK (expires_at > created_at),
  CONSTRAINT orders__check_8 CHECK (revision > 0),
  CONSTRAINT orders__fk_1 FOREIGN KEY (sku_version_id) REFERENCES sku_versions(id),
  CONSTRAINT orders__fk_2 FOREIGN KEY (buyer_user_id) REFERENCES users(id)
);
CREATE INDEX orders__ref_1_ix ON orders (sku_version_id);
CREATE INDEX orders__ref_2_ix ON orders (buyer_user_id);
-- 独立支付尝试与未知状态查询标识
CREATE TABLE payment_attempts (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  order_id opaque_id NOT NULL,
  attempt integer NOT NULL,
  channel text NOT NULL,
  merchant_account_ref text NOT NULL,
  provider_request_id text NOT NULL,
  provider_transaction_id text,
  state text NOT NULL DEFAULT 'created',
  amount_fen safe_uint NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT payment_attempts__pk PRIMARY KEY (id),
  CONSTRAINT payment_attempts__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT payment_attempts__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT payment_attempts__check_1 CHECK (attempt BETWEEN 1 AND 100),
  CONSTRAINT payment_attempts__check_2 CHECK (state IN ('created','submitted','unknown','paid','closed','failed')),
  CONSTRAINT payment_attempts__check_3 CHECK (revision > 0),
  CONSTRAINT payment_attempts__unique_1 UNIQUE (workspace_id, order_id, attempt),
  CONSTRAINT payment_attempts__unique_2 UNIQUE (channel, merchant_account_ref, provider_request_id),
  CONSTRAINT payment_attempts__unique_3 UNIQUE (workspace_id, order_id, id),
  CONSTRAINT payment_attempts__fk_1 FOREIGN KEY (workspace_id, order_id) REFERENCES orders(workspace_id, id)
);
CREATE INDEX payment_attempts__ref_1_ix ON payment_attempts (workspace_id, order_id);
-- 验签后的追加事实；事件去重不等于完成履约
CREATE TABLE payment_events (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  payment_attempt_id opaque_id NOT NULL,
  channel text NOT NULL,
  merchant_account_ref text NOT NULL,
  provider_event_id text NOT NULL,
  provider_transaction_id text NOT NULL,
  body_hash sha256_hex NOT NULL,
  verified_at timestamptz NOT NULL,
  amount_fen safe_uint NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  event_kind text NOT NULL,
  redacted_event jsonb NOT NULL,
  CONSTRAINT payment_events__pk PRIMARY KEY (id),
  CONSTRAINT payment_events__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT payment_events__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT payment_events__check_1 CHECK (currency = 'CNY'),
  CONSTRAINT payment_events__check_2 CHECK (event_kind IN ('paid','closed','refund_succeeded','refund_failed')),
  CONSTRAINT payment_events__check_3 CHECK (jsonb_typeof(redacted_event) = 'object'),
  CONSTRAINT payment_events__unique_1 UNIQUE (channel, merchant_account_ref, provider_event_id),
  CONSTRAINT payment_events__fk_1 FOREIGN KEY (workspace_id, payment_attempt_id) REFERENCES payment_attempts(workspace_id, id)
);
CREATE INDEX payment_events__ref_1_ix ON payment_events (workspace_id, payment_attempt_id);
-- 退款在订单锁下限制累计金额并反转权益
CREATE TABLE refunds (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  order_id opaque_id NOT NULL,
  payment_attempt_id opaque_id NOT NULL,
  operation_id opaque_id NOT NULL,
  provider_refund_id text,
  amount_fen safe_uint NOT NULL,
  state text NOT NULL DEFAULT 'requested',
  reason_code text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT refunds__pk PRIMARY KEY (id),
  CONSTRAINT refunds__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT refunds__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT refunds__check_1 CHECK (amount_fen > 0),
  CONSTRAINT refunds__check_2 CHECK (state IN ('requested','submitted','unknown','succeeded','failed','manual_review')),
  CONSTRAINT refunds__check_3 CHECK (revision > 0),
  CONSTRAINT refunds__unique_1 UNIQUE (workspace_id, operation_id),
  CONSTRAINT refunds__fk_1 FOREIGN KEY (workspace_id, order_id) REFERENCES orders(workspace_id, id),
  CONSTRAINT refunds__fk_2 FOREIGN KEY (workspace_id, order_id, payment_attempt_id) REFERENCES payment_attempts(workspace_id, order_id, id)
);
CREATE INDEX refunds__ref_1_ix ON refunds (workspace_id, order_id);
CREATE INDEX refunds__ref_2_ix ON refunds (workspace_id, order_id, payment_attempt_id);
-- 兑换批次；原始码仅生成时一次交付
CREATE TABLE redemption_batches (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sku_version_id opaque_id NOT NULL,
  name text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active',
  created_by opaque_id NOT NULL,
  CONSTRAINT redemption_batches__pk PRIMARY KEY (id),
  CONSTRAINT redemption_batches__check_1 CHECK (expires_at > created_at),
  CONSTRAINT redemption_batches__check_2 CHECK (state IN ('active','disabled','expired')),
  CONSTRAINT redemption_batches__fk_1 FOREIGN KEY (sku_version_id) REFERENCES sku_versions(id),
  CONSTRAINT redemption_batches__fk_2 FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX redemption_batches__ref_1_ix ON redemption_batches (sku_version_id);
CREATE INDEX redemption_batches__ref_2_ix ON redemption_batches (created_by);
-- 摘要码与行锁防双花
CREATE TABLE redemption_codes (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  batch_id opaque_id NOT NULL,
  code_hash sha256_hex NOT NULL,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'active',
  CONSTRAINT redemption_codes__pk PRIMARY KEY (id),
  CONSTRAINT redemption_codes__check_1 CHECK (max_uses BETWEEN 1 AND 1000000),
  CONSTRAINT redemption_codes__check_2 CHECK (used_count BETWEEN 0 AND max_uses),
  CONSTRAINT redemption_codes__check_3 CHECK (state IN ('active','disabled','exhausted')),
  CONSTRAINT redemption_codes__unique_1 UNIQUE (code_hash),
  CONSTRAINT redemption_codes__fk_1 FOREIGN KEY (batch_id) REFERENCES redemption_batches(id)
);
CREATE INDEX redemption_codes__ref_1_ix ON redemption_codes (batch_id);
-- 兑换成功追加事实
CREATE TABLE redemptions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  code_id opaque_id NOT NULL,
  user_id opaque_id NOT NULL,
  operation_id opaque_id NOT NULL,
  sku_version_id opaque_id NOT NULL,
  CONSTRAINT redemptions__pk PRIMARY KEY (id),
  CONSTRAINT redemptions__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT redemptions__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT redemptions__unique_1 UNIQUE (code_id, workspace_id),
  CONSTRAINT redemptions__unique_2 UNIQUE (workspace_id, operation_id),
  CONSTRAINT redemptions__fk_1 FOREIGN KEY (code_id) REFERENCES redemption_codes(id),
  CONSTRAINT redemptions__fk_2 FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT redemptions__fk_3 FOREIGN KEY (sku_version_id) REFERENCES sku_versions(id)
);
CREATE INDEX redemptions__ref_1_ix ON redemptions (code_id);
CREATE INDEX redemptions__ref_2_ix ON redemptions (user_id);
CREATE INDEX redemptions__ref_3_ix ON redemptions (sku_version_id);
-- 明确来源的权益；到期不删作品
CREATE TABLE entitlement_grants (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  source_order_id opaque_id,
  source_redemption_id opaque_id,
  grant_type text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  features jsonb NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT entitlement_grants__pk PRIMARY KEY (id),
  CONSTRAINT entitlement_grants__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT entitlement_grants__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT entitlement_grants__check_1 CHECK (num_nonnulls(source_order_id, source_redemption_id) = 1),
  CONSTRAINT entitlement_grants__check_2 CHECK (ends_at > starts_at),
  CONSTRAINT entitlement_grants__check_3 CHECK (jsonb_typeof(features) = 'object'),
  CONSTRAINT entitlement_grants__check_4 CHECK (state IN ('active','expired','revoked')),
  CONSTRAINT entitlement_grants__check_5 CHECK (revision > 0),
  CONSTRAINT entitlement_grants__unique_1 UNIQUE (workspace_id, source_order_id, grant_type),
  CONSTRAINT entitlement_grants__unique_2 UNIQUE (workspace_id, source_redemption_id, grant_type),
  CONSTRAINT entitlement_grants__fk_1 FOREIGN KEY (workspace_id, source_order_id) REFERENCES orders(workspace_id, id),
  CONSTRAINT entitlement_grants__fk_2 FOREIGN KEY (workspace_id, source_redemption_id) REFERENCES redemptions(workspace_id, id)
);
CREATE INDEX entitlement_grants__ref_1_ix ON entitlement_grants (workspace_id, source_order_id);
CREATE INDEX entitlement_grants__ref_2_ix ON entitlement_grants (workspace_id, source_redemption_id);
-- 首期固定周期会员；不隐含自动扣费续订
CREATE TABLE subscriptions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  entitlement_grant_id opaque_id NOT NULL,
  source_order_id opaque_id,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active',
  CONSTRAINT subscriptions__pk PRIMARY KEY (id),
  CONSTRAINT subscriptions__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT subscriptions__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT subscriptions__check_1 CHECK (ends_at > starts_at),
  CONSTRAINT subscriptions__check_2 CHECK (state IN ('active','expired','revoked')),
  CONSTRAINT subscriptions__unique_1 UNIQUE (workspace_id, entitlement_grant_id),
  CONSTRAINT subscriptions__fk_1 FOREIGN KEY (workspace_id, entitlement_grant_id) REFERENCES entitlement_grants(workspace_id, id),
  CONSTRAINT subscriptions__fk_2 FOREIGN KEY (workspace_id, source_order_id) REFERENCES orders(workspace_id, id)
);
CREATE INDEX subscriptions__ref_1_ix ON subscriptions (workspace_id, entitlement_grant_id);
CREATE INDEX subscriptions__ref_2_ix ON subscriptions (workspace_id, source_order_id);
-- 工作区余额投影，必须与 lot/ledger 同事务更新
CREATE TABLE credit_accounts (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  available safe_uint NOT NULL DEFAULT 0,
  reserved safe_uint NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT credit_accounts__pk PRIMARY KEY (id),
  CONSTRAINT credit_accounts__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT credit_accounts__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT credit_accounts__check_1 CHECK (revision > 0),
  CONSTRAINT credit_accounts__check_2 CHECK (available::numeric + reserved::numeric <= 9007199254740991),
  CONSTRAINT credit_accounts__unique_1 UNIQUE (workspace_id)
);
-- 按来源与到期日批次；预占可跨到期完成
CREATE TABLE credit_lots (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  source_grant_id opaque_id NOT NULL,
  granted safe_uint NOT NULL,
  available safe_uint NOT NULL,
  reserved safe_uint NOT NULL DEFAULT 0,
  consumed safe_uint NOT NULL DEFAULT 0,
  expired safe_uint NOT NULL DEFAULT 0,
  revoked safe_uint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT credit_lots__pk PRIMARY KEY (id),
  CONSTRAINT credit_lots__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT credit_lots__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT credit_lots__check_1 CHECK (granted > 0),
  CONSTRAINT credit_lots__check_2 CHECK (available::numeric + reserved::numeric + consumed::numeric + expired::numeric + revoked::numeric = granted::numeric),
  CONSTRAINT credit_lots__check_3 CHECK (expires_at > created_at),
  CONSTRAINT credit_lots__check_4 CHECK (revision > 0),
  CONSTRAINT credit_lots__unique_1 UNIQUE (workspace_id, source_grant_id),
  CONSTRAINT credit_lots__fk_1 FOREIGN KEY (workspace_id, source_grant_id) REFERENCES entitlement_grants(workspace_id, id)
);
CREATE INDEX credit_lots__ref_1_ix ON credit_lots (workspace_id, source_grant_id);
-- 稳定采购账户；连接/密钥版本变更不重置预算
CREATE TABLE ai_billing_accounts (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  account_billing_id opaque_id NOT NULL,
  provider_name text NOT NULL,
  daily_budget_fen safe_uint NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT ai_billing_accounts__pk PRIMARY KEY (id),
  CONSTRAINT ai_billing_accounts__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT ai_billing_accounts__check_2 CHECK (state IN ('active','stopped','retired')),
  CONSTRAINT ai_billing_accounts__check_3 CHECK (revision > 0),
  CONSTRAINT ai_billing_accounts__unique_1 UNIQUE (environment, account_billing_id),
  CONSTRAINT ai_billing_accounts__unique_2 UNIQUE (id, environment)
);
-- 供应商逻辑连接；禁用只停新任务
CREATE TABLE ai_provider_connections (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  billing_account_id opaque_id NOT NULL,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'unconfigured',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT ai_provider_connections__pk PRIMARY KEY (id),
  CONSTRAINT ai_provider_connections__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT ai_provider_connections__check_2 CHECK (state IN ('disabled','unconfigured','ready','degraded')),
  CONSTRAINT ai_provider_connections__check_3 CHECK (revision > 0),
  CONSTRAINT ai_provider_connections__unique_1 UNIQUE (environment, name),
  CONSTRAINT ai_provider_connections__unique_2 UNIQUE (id, billing_account_id, environment),
  CONSTRAINT ai_provider_connections__fk_1 FOREIGN KEY (billing_account_id, environment) REFERENCES ai_billing_accounts(id, environment),
  CONSTRAINT ai_provider_connections__billing_pair_uq UNIQUE (id, billing_account_id)
);
CREATE INDEX ai_provider_connections__ref_1_ix ON ai_provider_connections (billing_account_id, environment);
-- 不可变适配器/秘密/隐私能力版本
CREATE TABLE ai_provider_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  connection_id opaque_id NOT NULL,
  billing_account_id opaque_id NOT NULL,
  environment text NOT NULL,
  version integer NOT NULL,
  adapter_id text NOT NULL,
  adapter_version text NOT NULL,
  base_url text NOT NULL,
  secret_reference_id opaque_id NOT NULL,
  auth_mode text NOT NULL,
  connect_timeout_ms integer NOT NULL DEFAULT 5000,
  request_timeout_ms integer NOT NULL DEFAULT 60000,
  max_concurrent integer NOT NULL,
  requests_per_minute integer NOT NULL,
  daily_budget_fen safe_uint NOT NULL,
  allowed_data_use jsonb NOT NULL,
  capabilities jsonb NOT NULL,
  CONSTRAINT ai_provider_versions__pk PRIMARY KEY (id),
  CONSTRAINT ai_provider_versions__check_1 CHECK (version > 0),
  CONSTRAINT ai_provider_versions__check_2 CHECK (base_url ~ '^https://'),
  CONSTRAINT ai_provider_versions__check_3 CHECK (connect_timeout_ms BETWEEN 100 AND 60000),
  CONSTRAINT ai_provider_versions__check_4 CHECK (request_timeout_ms BETWEEN 100 AND 600000),
  CONSTRAINT ai_provider_versions__check_5 CHECK (max_concurrent BETWEEN 1 AND 10000),
  CONSTRAINT ai_provider_versions__check_6 CHECK (requests_per_minute BETWEEN 1 AND 1000000),
  CONSTRAINT ai_provider_versions__check_7 CHECK (auth_mode IN ('bearer','signature','adapter_defined')),
  CONSTRAINT ai_provider_versions__check_8 CHECK (jsonb_typeof(allowed_data_use) = 'object'),
  CONSTRAINT ai_provider_versions__check_9 CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT ai_provider_versions__unique_1 UNIQUE (connection_id, version),
  CONSTRAINT ai_provider_versions__unique_2 UNIQUE (id, connection_id, billing_account_id),
  CONSTRAINT ai_provider_versions__fk_1 FOREIGN KEY (connection_id, billing_account_id, environment) REFERENCES ai_provider_connections(id, billing_account_id, environment),
  CONSTRAINT ai_provider_versions__secret_environment_fk FOREIGN KEY (secret_reference_id, environment) REFERENCES secret_references(id, environment)
);
CREATE INDEX ai_provider_versions__ref_1_ix ON ai_provider_versions (connection_id, billing_account_id, environment);
CREATE INDEX ai_provider_versions__ref_2_ix ON ai_provider_versions (secret_reference_id);
-- 模型目录状态依实际契约测试启用
CREATE TABLE ai_models (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'unverified',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT ai_models__pk PRIMARY KEY (id),
  CONSTRAINT ai_models__check_1 CHECK (state IN ('unverified','ready','disabled','retired')),
  CONSTRAINT ai_models__check_2 CHECK (revision > 0)
);
-- 模型能力/限制/授权与契约测试冻结
CREATE TABLE ai_model_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  model_id opaque_id NOT NULL,
  version integer NOT NULL,
  provider_version_id opaque_id NOT NULL,
  provider_model_id text NOT NULL,
  provider_model_version text NOT NULL,
  license_version_id opaque_id NOT NULL,
  input_schema_version integer NOT NULL,
  output_schema_version integer NOT NULL,
  capabilities jsonb NOT NULL,
  parameter_schema jsonb NOT NULL,
  limits_json jsonb NOT NULL,
  moderation_policy_ref text NOT NULL,
  label_policy_ref text NOT NULL,
  test_report_id opaque_id NOT NULL,
  CONSTRAINT ai_model_versions__pk PRIMARY KEY (id),
  CONSTRAINT ai_model_versions__check_1 CHECK (version > 0 AND input_schema_version > 0 AND output_schema_version > 0),
  CONSTRAINT ai_model_versions__check_2 CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT ai_model_versions__check_3 CHECK (jsonb_typeof(parameter_schema) = 'object'),
  CONSTRAINT ai_model_versions__check_4 CHECK (jsonb_typeof(limits_json) = 'object'),
  CONSTRAINT ai_model_versions__unique_1 UNIQUE (model_id, version),
  CONSTRAINT ai_model_versions__unique_2 UNIQUE (id, provider_version_id),
  CONSTRAINT ai_model_versions__fk_1 FOREIGN KEY (model_id) REFERENCES ai_models(id),
  CONSTRAINT ai_model_versions__fk_2 FOREIGN KEY (provider_version_id) REFERENCES ai_provider_versions(id),
  CONSTRAINT ai_model_versions__fk_3 FOREIGN KEY (license_version_id) REFERENCES license_versions(id),
  CONSTRAINT ai_model_versions__fk_4 FOREIGN KEY (test_report_id) REFERENCES config_tests(id)
);
CREATE INDEX ai_model_versions__ref_1_ix ON ai_model_versions (model_id);
CREATE INDEX ai_model_versions__ref_2_ix ON ai_model_versions (provider_version_id);
CREATE INDEX ai_model_versions__ref_3_ix ON ai_model_versions (license_version_id);
CREATE INDEX ai_model_versions__ref_4_ix ON ai_model_versions (test_report_id);
-- 排版建议/生图/参考图/审核能力独立路由
CREATE TABLE ai_routes (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  capability text NOT NULL,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT ai_routes__pk PRIMARY KEY (id),
  CONSTRAINT ai_routes__check_1 CHECK (capability IN ('textSuggestion','textToImage','imageToImage','moderation')),
  CONSTRAINT ai_routes__check_2 CHECK (state IN ('draft','active','retired')),
  CONSTRAINT ai_routes__check_3 CHECK (revision > 0)
);
-- 备用仅在确定未接受且满足报价合同前允许
CREATE TABLE ai_route_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  route_id opaque_id NOT NULL,
  version integer NOT NULL,
  primary_model_version_id opaque_id NOT NULL,
  fallback_model_version_id opaque_id,
  fallback_policy text NOT NULL DEFAULT 'none',
  CONSTRAINT ai_route_versions__pk PRIMARY KEY (id),
  CONSTRAINT ai_route_versions__check_1 CHECK (version > 0),
  CONSTRAINT ai_route_versions__check_2 CHECK (fallback_policy IN ('none','definitely_not_accepted')),
  CONSTRAINT ai_route_versions__check_3 CHECK ((fallback_policy = 'none') = (fallback_model_version_id IS NULL)),
  CONSTRAINT ai_route_versions__check_4 CHECK (fallback_model_version_id IS NULL OR fallback_model_version_id <> primary_model_version_id),
  CONSTRAINT ai_route_versions__unique_1 UNIQUE (route_id, version),
  CONSTRAINT ai_route_versions__fk_1 FOREIGN KEY (route_id) REFERENCES ai_routes(id),
  CONSTRAINT ai_route_versions__fk_2 FOREIGN KEY (primary_model_version_id) REFERENCES ai_model_versions(id),
  CONSTRAINT ai_route_versions__fk_3 FOREIGN KEY (fallback_model_version_id) REFERENCES ai_model_versions(id)
);
CREATE INDEX ai_route_versions__ref_1_ix ON ai_route_versions (route_id);
CREATE INDEX ai_route_versions__ref_2_ix ON ai_route_versions (primary_model_version_id);
CREATE INDEX ai_route_versions__ref_3_ix ON ai_route_versions (fallback_model_version_id);
-- 风格目录；许可不明不得上架
CREATE TABLE ai_presets (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  category text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT ai_presets__pk PRIMARY KEY (id),
  CONSTRAINT ai_presets__check_1 CHECK (state IN ('draft','review','published','retired')),
  CONSTRAINT ai_presets__check_2 CHECK (revision > 0)
);
-- 用户点数与供应商采购价分开版本定价
CREATE TABLE cost_rule_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rule_key text NOT NULL,
  version integer NOT NULL,
  credit_cost safe_uint NOT NULL,
  estimated_cost_fen safe_uint NOT NULL,
  max_cost_fen safe_uint NOT NULL,
  parameters jsonb NOT NULL,
  CONSTRAINT cost_rule_versions__pk PRIMARY KEY (id),
  CONSTRAINT cost_rule_versions__check_1 CHECK (version > 0),
  CONSTRAINT cost_rule_versions__check_2 CHECK (estimated_cost_fen <= max_cost_fen),
  CONSTRAINT cost_rule_versions__check_3 CHECK (jsonb_typeof(parameters) = 'object'),
  CONSTRAINT cost_rule_versions__unique_1 UNIQUE (rule_key, version)
);
-- 不可变预设模板，仅白名单插值
CREATE TABLE ai_preset_versions (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  preset_id opaque_id NOT NULL,
  version integer NOT NULL,
  license_version_id opaque_id NOT NULL,
  cost_rule_version_id opaque_id NOT NULL,
  parameter_template jsonb NOT NULL,
  editable_parameters text[] NOT NULL,
  moderation_policy_ref text NOT NULL,
  label_policy_ref text NOT NULL,
  example_license_version_id opaque_id,
  CONSTRAINT ai_preset_versions__pk PRIMARY KEY (id),
  CONSTRAINT ai_preset_versions__check_1 CHECK (version > 0),
  CONSTRAINT ai_preset_versions__check_2 CHECK (jsonb_typeof(parameter_template) = 'object'),
  CONSTRAINT ai_preset_versions__unique_1 UNIQUE (preset_id, version),
  CONSTRAINT ai_preset_versions__fk_1 FOREIGN KEY (preset_id) REFERENCES ai_presets(id),
  CONSTRAINT ai_preset_versions__fk_2 FOREIGN KEY (license_version_id) REFERENCES license_versions(id),
  CONSTRAINT ai_preset_versions__fk_3 FOREIGN KEY (cost_rule_version_id) REFERENCES cost_rule_versions(id),
  CONSTRAINT ai_preset_versions__fk_4 FOREIGN KEY (example_license_version_id) REFERENCES license_versions(id)
);
CREATE INDEX ai_preset_versions__ref_1_ix ON ai_preset_versions (preset_id);
CREATE INDEX ai_preset_versions__ref_2_ix ON ai_preset_versions (license_version_id);
CREATE INDEX ai_preset_versions__ref_3_ix ON ai_preset_versions (cost_rule_version_id);
CREATE INDEX ai_preset_versions__ref_4_ix ON ai_preset_versions (example_license_version_id);
-- 预设所支持模型的显式白名单
CREATE TABLE ai_preset_models (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  preset_version_id opaque_id NOT NULL,
  model_version_id opaque_id NOT NULL,
  CONSTRAINT ai_preset_models__pk PRIMARY KEY (id),
  CONSTRAINT ai_preset_models__unique_1 UNIQUE (preset_version_id, model_version_id),
  CONSTRAINT ai_preset_models__fk_1 FOREIGN KEY (preset_version_id) REFERENCES ai_preset_versions(id),
  CONSTRAINT ai_preset_models__fk_2 FOREIGN KEY (model_version_id) REFERENCES ai_model_versions(id)
);
CREATE INDEX ai_preset_models__ref_1_ix ON ai_preset_models (preset_version_id);
CREATE INDEX ai_preset_models__ref_2_ix ON ai_preset_models (model_version_id);
-- Asia/Shanghai 采购账户日预算，旧日未知预占不清零
CREATE TABLE budget_days (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  billing_account_id opaque_id NOT NULL,
  budget_date date NOT NULL,
  limit_fen safe_uint NOT NULL,
  reserved_fen safe_uint NOT NULL DEFAULT 0,
  spent_fen safe_uint NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT budget_days__pk PRIMARY KEY (id),
  CONSTRAINT budget_days__check_1 CHECK (revision > 0),
  CONSTRAINT budget_days__check_2 CHECK (reserved_fen::numeric + spent_fen::numeric <= 9007199254740991),
  CONSTRAINT budget_days__unique_1 UNIQUE (billing_account_id, budget_date),
  CONSTRAINT budget_days__unique_2 UNIQUE (id, billing_account_id),
  CONSTRAINT budget_days__fk_1 FOREIGN KEY (billing_account_id) REFERENCES ai_billing_accounts(id)
);
CREATE INDEX budget_days__ref_1_ix ON budget_days (billing_account_id);
-- 同账户各连接叠加独立上限，密钥轮换不归零
CREATE TABLE provider_budget_days (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  connection_id opaque_id NOT NULL,
  billing_account_id opaque_id NOT NULL,
  budget_day_id opaque_id NOT NULL,
  limit_fen safe_uint NOT NULL,
  reserved_fen safe_uint NOT NULL DEFAULT 0,
  spent_fen safe_uint NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT provider_budget_days__pk PRIMARY KEY (id),
  CONSTRAINT provider_budget_days__check_1 CHECK (revision > 0),
  CONSTRAINT provider_budget_days__check_2 CHECK (reserved_fen::numeric + spent_fen::numeric <= 9007199254740991),
  CONSTRAINT provider_budget_days__unique_1 UNIQUE (connection_id, budget_day_id),
  CONSTRAINT provider_budget_days__unique_2 UNIQUE (id, budget_day_id, billing_account_id, connection_id),
  CONSTRAINT provider_budget_days__fk_2 FOREIGN KEY (budget_day_id, billing_account_id) REFERENCES budget_days(id, billing_account_id),
  CONSTRAINT provider_budget_days__connection_account_fk FOREIGN KEY (connection_id, billing_account_id) REFERENCES ai_provider_connections(id, billing_account_id)
);
CREATE INDEX provider_budget_days__ref_1_ix ON provider_budget_days (connection_id);
CREATE INDEX provider_budget_days__ref_2_ix ON provider_budget_days (budget_day_id, billing_account_id);
-- 明确选中参考图用途与授权，不默认全相册上传
CREATE TABLE generation_consents (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  user_id opaque_id NOT NULL,
  reference_asset_id opaque_id,
  policy_version text NOT NULL,
  purpose text NOT NULL,
  consented_at timestamptz NOT NULL,
  reference_authorization_ref text,
  input_hash sha256_hex NOT NULL,
  CONSTRAINT generation_consents__pk PRIMARY KEY (id),
  CONSTRAINT generation_consents__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT generation_consents__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT generation_consents__check_1 CHECK (char_length(purpose) BETWEEN 1 AND 240),
  CONSTRAINT generation_consents__check_2 CHECK (reference_asset_id IS NULL OR reference_authorization_ref IS NOT NULL),
  CONSTRAINT generation_consents__fk_1 FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT generation_consents__fk_2 FOREIGN KEY (workspace_id, reference_asset_id) REFERENCES assets(workspace_id, id)
);
CREATE INDEX generation_consents__ref_1_ix ON generation_consents (user_id);
CREATE INDEX generation_consents__ref_2_ix ON generation_consents (workspace_id, reference_asset_id);
-- 5分钟报价不预占；接受任务唯一消费此 quote
CREATE TABLE generation_quotes (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  config_release_id opaque_id NOT NULL,
  route_version_id opaque_id NOT NULL,
  model_version_id opaque_id NOT NULL,
  provider_version_id opaque_id NOT NULL,
  preset_version_id opaque_id,
  cost_rule_version_id opaque_id NOT NULL,
  consent_id opaque_id NOT NULL,
  reference_asset_id opaque_id,
  input_hash sha256_hex NOT NULL,
  credit_cost safe_uint NOT NULL,
  estimated_cost_fen safe_uint NOT NULL,
  max_cost_fen safe_uint NOT NULL,
  image_count integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  CONSTRAINT generation_quotes__pk PRIMARY KEY (id),
  CONSTRAINT generation_quotes__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT generation_quotes__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT generation_quotes__check_1 CHECK (estimated_cost_fen <= max_cost_fen),
  CONSTRAINT generation_quotes__check_2 CHECK (image_count = 1),
  CONSTRAINT generation_quotes__check_3 CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CONSTRAINT generation_quotes__fk_1 FOREIGN KEY (config_release_id) REFERENCES config_releases(id),
  CONSTRAINT generation_quotes__fk_2 FOREIGN KEY (route_version_id) REFERENCES ai_route_versions(id),
  CONSTRAINT generation_quotes__fk_3 FOREIGN KEY (model_version_id, provider_version_id) REFERENCES ai_model_versions(id, provider_version_id),
  CONSTRAINT generation_quotes__fk_4 FOREIGN KEY (preset_version_id) REFERENCES ai_preset_versions(id),
  CONSTRAINT generation_quotes__fk_5 FOREIGN KEY (cost_rule_version_id) REFERENCES cost_rule_versions(id),
  CONSTRAINT generation_quotes__fk_6 FOREIGN KEY (workspace_id, consent_id) REFERENCES generation_consents(workspace_id, id),
  CONSTRAINT generation_quotes__fk_7 FOREIGN KEY (workspace_id, reference_asset_id) REFERENCES assets(workspace_id, id)
);
CREATE INDEX generation_quotes__ref_1_ix ON generation_quotes (config_release_id);
CREATE INDEX generation_quotes__ref_2_ix ON generation_quotes (route_version_id);
CREATE INDEX generation_quotes__ref_3_ix ON generation_quotes (model_version_id, provider_version_id);
CREATE INDEX generation_quotes__ref_4_ix ON generation_quotes (preset_version_id);
CREATE INDEX generation_quotes__ref_5_ix ON generation_quotes (cost_rule_version_id);
CREATE INDEX generation_quotes__ref_6_ix ON generation_quotes (workspace_id, consent_id);
CREATE INDEX generation_quotes__ref_7_ix ON generation_quotes (workspace_id, reference_asset_id);
-- 导出阻断/警告与参数 hash 绑定，令牌仅摘要
CREATE TABLE export_preflights (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  project_id opaque_id NOT NULL,
  revision_id opaque_id NOT NULL,
  normalized_spec_hash sha256_hex NOT NULL,
  schema_version integer NOT NULL,
  format text NOT NULL,
  dpi integer NOT NULL,
  max_face_pixels safe_uint NOT NULL,
  warnings jsonb NOT NULL,
  blockers jsonb NOT NULL,
  token_hash sha256_hex NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT export_preflights__pk PRIMARY KEY (id),
  CONSTRAINT export_preflights__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT export_preflights__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT export_preflights__check_1 CHECK (schema_version = 1),
  CONSTRAINT export_preflights__check_2 CHECK (format IN ('jpeg','png','pdf')),
  CONSTRAINT export_preflights__check_3 CHECK (dpi IN (72,150,300)),
  CONSTRAINT export_preflights__check_4 CHECK (max_face_pixels BETWEEN 1 AND 50000000),
  CONSTRAINT export_preflights__check_5 CHECK (jsonb_typeof(warnings) = 'array'),
  CONSTRAINT export_preflights__check_6 CHECK (jsonb_typeof(blockers) = 'array'),
  CONSTRAINT export_preflights__check_7 CHECK (expires_at > created_at),
  CONSTRAINT export_preflights__unique_1 UNIQUE (token_hash),
  CONSTRAINT export_preflights__unique_2 UNIQUE (workspace_id, project_id, revision_id, id),
  CONSTRAINT export_preflights__fk_1 FOREIGN KEY (workspace_id, project_id, revision_id) REFERENCES project_revisions(workspace_id, project_id, id)
);
CREATE INDEX export_preflights__ref_1_ix ON export_preflights (workspace_id, project_id, revision_id);
-- 任务冻结所有参数、授权与版本；不是客户端任意 JSON
CREATE TABLE job_snapshots (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  kind text NOT NULL,
  project_id opaque_id,
  revision_id opaque_id,
  quote_id opaque_id,
  preflight_id opaque_id,
  config_release_id opaque_id NOT NULL,
  schema_version integer NOT NULL,
  normalized_spec_hash sha256_hex NOT NULL,
  manifest_hash sha256_hex NOT NULL,
  manifest jsonb NOT NULL,
  entitlement_snapshot jsonb NOT NULL,
  warnings_acknowledged jsonb NOT NULL,
  renderer_version text,
  renderer_image_digest text,
  CONSTRAINT job_snapshots__pk PRIMARY KEY (id),
  CONSTRAINT job_snapshots__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT job_snapshots__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT job_snapshots__check_1 CHECK (kind IN ('layout','generation','export','asset_analysis','storage_migration','deletion','privacy_export','config_test','reconciliation','backup_restore_drill')),
  CONSTRAINT job_snapshots__check_2 CHECK (schema_version > 0),
  CONSTRAINT job_snapshots__check_3 CHECK ((project_id IS NULL) = (revision_id IS NULL)),
  CONSTRAINT job_snapshots__check_4 CHECK (kind <> 'generation' OR quote_id IS NOT NULL),
  CONSTRAINT job_snapshots__check_5 CHECK (kind <> 'export' OR (preflight_id IS NOT NULL AND revision_id IS NOT NULL AND renderer_version IS NOT NULL AND renderer_image_digest ~ '^sha256:[0-9a-f]{64}$')),
  CONSTRAINT job_snapshots__check_6 CHECK (jsonb_typeof(manifest) = 'object'),
  CONSTRAINT job_snapshots__check_7 CHECK (jsonb_typeof(entitlement_snapshot) = 'object'),
  CONSTRAINT job_snapshots__check_8 CHECK (jsonb_typeof(warnings_acknowledged) = 'array'),
  CONSTRAINT job_snapshots__fk_1 FOREIGN KEY (workspace_id, project_id, revision_id) REFERENCES project_revisions(workspace_id, project_id, id),
  CONSTRAINT job_snapshots__fk_2 FOREIGN KEY (workspace_id, quote_id) REFERENCES generation_quotes(workspace_id, id),
  CONSTRAINT job_snapshots__fk_3 FOREIGN KEY (workspace_id, project_id, revision_id, preflight_id) REFERENCES export_preflights(workspace_id, project_id, revision_id, id),
  CONSTRAINT job_snapshots__fk_4 FOREIGN KEY (config_release_id) REFERENCES config_releases(id)
);
CREATE INDEX job_snapshots__ref_1_ix ON job_snapshots (workspace_id, project_id, revision_id);
CREATE INDEX job_snapshots__ref_2_ix ON job_snapshots (workspace_id, quote_id);
CREATE INDEX job_snapshots__ref_3_ix ON job_snapshots (workspace_id, project_id, revision_id, preflight_id);
CREATE INDEX job_snapshots__ref_4_ix ON job_snapshots (config_release_id);
-- PostgreSQL 任务事实；条件 fence/lease 写入，终态只一次
CREATE TABLE jobs (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  kind text NOT NULL,
  snapshot_id opaque_id NOT NULL,
  quote_id opaque_id,
  parent_job_id opaque_id,
  created_by opaque_id NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'queued',
  fence bigint NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 1,
  lease_owner opaque_id,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  provider_submission_state text NOT NULL DEFAULT 'not_submitted',
  provider_request_id text,
  next_attempt_at timestamptz,
  cancel_requested_at timestamptz,
  terminal_at timestamptz,
  error_code text,
  CONSTRAINT jobs__pk PRIMARY KEY (id),
  CONSTRAINT jobs__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT jobs__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT jobs__check_1 CHECK (kind IN ('layout','generation','export','asset_analysis','storage_migration','deletion','privacy_export','config_test','reconciliation','backup_restore_drill')),
  CONSTRAINT jobs__check_2 CHECK (state IN ('queued','running','packaging','retry_wait','cancel_requested','succeeded','failed','cancelled')),
  CONSTRAINT jobs__check_3 CHECK (progress BETWEEN 0 AND 100),
  CONSTRAINT jobs__check_4 CHECK (fence >= 0 AND revision > 0),
  CONSTRAINT jobs__check_5 CHECK (attempt_count BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 10),
  CONSTRAINT jobs__check_6 CHECK (provider_submission_state IN ('not_submitted','submitting','accepted','unknown','terminal')),
  CONSTRAINT jobs__check_7 CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT jobs__check_8 CHECK ((state IN ('succeeded','failed','cancelled')) = (terminal_at IS NOT NULL)),
  CONSTRAINT jobs__check_9 CHECK (kind <> 'generation' OR quote_id IS NOT NULL),
  CONSTRAINT jobs__unique_1 UNIQUE (workspace_id, snapshot_id),
  CONSTRAINT jobs__unique_2 UNIQUE (workspace_id, quote_id),
  CONSTRAINT jobs__unique_3 UNIQUE (workspace_id, id, fence),
  CONSTRAINT jobs__fk_1 FOREIGN KEY (workspace_id, snapshot_id) REFERENCES job_snapshots(workspace_id, id),
  CONSTRAINT jobs__fk_2 FOREIGN KEY (workspace_id, quote_id) REFERENCES generation_quotes(workspace_id, id),
  CONSTRAINT jobs__fk_3 FOREIGN KEY (workspace_id, parent_job_id) REFERENCES jobs(workspace_id, id),
  CONSTRAINT jobs__fk_4 FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT jobs__quote_pair_uq UNIQUE (workspace_id, id, quote_id)
);
CREATE INDEX jobs__ref_1_ix ON jobs (workspace_id, snapshot_id);
CREATE INDEX jobs__ref_2_ix ON jobs (workspace_id, quote_id);
CREATE INDEX jobs__ref_3_ix ON jobs (workspace_id, parent_job_id);
CREATE INDEX jobs__ref_4_ix ON jobs (created_by);
-- 逐次执行与未知上游查询；不把网络超时当失败
CREATE TABLE job_attempts (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  job_id opaque_id NOT NULL,
  attempt integer NOT NULL,
  fence bigint NOT NULL,
  worker_id opaque_id NOT NULL,
  state text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  provider_request_id text,
  provider_job_id text,
  submission_state text NOT NULL,
  error_code text,
  next_query_at timestamptz,
  CONSTRAINT job_attempts__pk PRIMARY KEY (id),
  CONSTRAINT job_attempts__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT job_attempts__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT job_attempts__check_1 CHECK (attempt BETWEEN 1 AND 10),
  CONSTRAINT job_attempts__check_2 CHECK (fence > 0),
  CONSTRAINT job_attempts__check_3 CHECK (state IN ('running','unknown','succeeded','failed','cancelled','superseded')),
  CONSTRAINT job_attempts__check_4 CHECK (submission_state IN ('not_submitted','submitting','accepted','unknown','terminal')),
  CONSTRAINT job_attempts__check_5 CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT job_attempts__unique_1 UNIQUE (workspace_id, job_id, attempt),
  CONSTRAINT job_attempts__unique_2 UNIQUE (workspace_id, job_id, fence),
  CONSTRAINT job_attempts__fk_1 FOREIGN KEY (workspace_id, job_id) REFERENCES jobs(workspace_id, id)
);
CREATE INDEX job_attempts__ref_1_ix ON job_attempts (workspace_id, job_id);
-- pin 精确旧 locator 与字体/模板版本；解 pin 后才能清理
CREATE TABLE resource_pins (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  job_id opaque_id NOT NULL,
  storage_workspace_id opaque_id NOT NULL,
  storage_object_id opaque_id NOT NULL,
  asset_id opaque_id,
  font_version_id opaque_id,
  template_version_id opaque_id,
  filter_version_id opaque_id,
  released_at timestamptz,
  CONSTRAINT resource_pins__pk PRIMARY KEY (id),
  CONSTRAINT resource_pins__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT resource_pins__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT resource_pins__unique_1 UNIQUE (workspace_id, job_id, storage_object_id),
  CONSTRAINT resource_pins__fk_1 FOREIGN KEY (workspace_id, job_id) REFERENCES jobs(workspace_id, id),
  CONSTRAINT resource_pins__fk_2 FOREIGN KEY (storage_workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id),
  CONSTRAINT resource_pins__fk_3 FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id),
  CONSTRAINT resource_pins__fk_4 FOREIGN KEY (font_version_id) REFERENCES font_versions(id),
  CONSTRAINT resource_pins__fk_5 FOREIGN KEY (template_version_id) REFERENCES template_versions(id),
  CONSTRAINT resource_pins__fk_6 FOREIGN KEY (filter_version_id) REFERENCES filter_versions(id)
);
CREATE INDEX resource_pins__ref_1_ix ON resource_pins (workspace_id, job_id);
CREATE INDEX resource_pins__ref_2_ix ON resource_pins (storage_workspace_id, storage_object_id);
CREATE INDEX resource_pins__ref_3_ix ON resource_pins (workspace_id, asset_id);
CREATE INDEX resource_pins__ref_4_ix ON resource_pins (font_version_id);
CREATE INDEX resource_pins__ref_5_ix ON resource_pins (template_version_id);
CREATE INDEX resource_pins__ref_6_ix ON resource_pins (filter_version_id);
-- 通过 fence 竞态后发布私有产物；迟到临时对象不绑定
CREATE TABLE job_outputs (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  job_id opaque_id NOT NULL,
  artifact_index integer NOT NULL,
  storage_object_id opaque_id NOT NULL,
  committed_fence bigint NOT NULL,
  format text NOT NULL,
  sha256 sha256_hex NOT NULL,
  byte_size safe_uint NOT NULL,
  width integer,
  height integer,
  expires_at timestamptz NOT NULL,
  CONSTRAINT job_outputs__pk PRIMARY KEY (id),
  CONSTRAINT job_outputs__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT job_outputs__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT job_outputs__check_1 CHECK (artifact_index BETWEEN 0 AND 999),
  CONSTRAINT job_outputs__check_2 CHECK (committed_fence > 0),
  CONSTRAINT job_outputs__check_3 CHECK (format IN ('jpeg','png','pdf','json','zip')),
  CONSTRAINT job_outputs__check_4 CHECK (byte_size > 0),
  CONSTRAINT job_outputs__check_5 CHECK ((width IS NULL) = (height IS NULL)),
  CONSTRAINT job_outputs__check_6 CHECK (width IS NULL OR (width > 0 AND height > 0 AND width::bigint * height::bigint <= 50000000)),
  CONSTRAINT job_outputs__check_7 CHECK (expires_at > created_at),
  CONSTRAINT job_outputs__unique_1 UNIQUE (workspace_id, job_id, artifact_index),
  CONSTRAINT job_outputs__fk_1 FOREIGN KEY (workspace_id, job_id) REFERENCES jobs(workspace_id, id),
  CONSTRAINT job_outputs__fk_2 FOREIGN KEY (workspace_id, storage_object_id) REFERENCES storage_objects(workspace_id, id)
);
CREATE INDEX job_outputs__ref_1_ix ON job_outputs (workspace_id, job_id);
CREATE INDEX job_outputs__ref_2_ix ON job_outputs (workspace_id, storage_object_id);
-- 规则排版候选不修改项目；应用候选需 revision CAS
CREATE TABLE layout_candidates (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  job_id opaque_id NOT NULL,
  project_id opaque_id NOT NULL,
  base_revision_id opaque_id NOT NULL,
  candidate_index integer NOT NULL,
  seed bigint NOT NULL,
  score numeric(8,6) NOT NULL,
  layout_hash sha256_hex NOT NULL,
  layout_json jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT layout_candidates__pk PRIMARY KEY (id),
  CONSTRAINT layout_candidates__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT layout_candidates__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT layout_candidates__check_1 CHECK (candidate_index BETWEEN 0 AND 19),
  CONSTRAINT layout_candidates__check_2 CHECK (score BETWEEN 0 AND 1),
  CONSTRAINT layout_candidates__check_3 CHECK (jsonb_typeof(layout_json) = 'object'),
  CONSTRAINT layout_candidates__check_4 CHECK (expires_at > created_at),
  CONSTRAINT layout_candidates__unique_1 UNIQUE (workspace_id, job_id, candidate_index),
  CONSTRAINT layout_candidates__fk_1 FOREIGN KEY (workspace_id, job_id) REFERENCES jobs(workspace_id, id),
  CONSTRAINT layout_candidates__fk_2 FOREIGN KEY (workspace_id, project_id, base_revision_id) REFERENCES project_revisions(workspace_id, project_id, id)
);
CREATE INDEX layout_candidates__ref_1_ix ON layout_candidates (workspace_id, job_id);
CREATE INDEX layout_candidates__ref_2_ix ON layout_candidates (workspace_id, project_id, base_revision_id);
-- 任务一次预占与一次终局；未知状态保留直到终局上限
CREATE TABLE credit_reservations (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  job_id opaque_id NOT NULL,
  quote_id opaque_id NOT NULL,
  amount safe_uint NOT NULL,
  state text NOT NULL DEFAULT 'held',
  expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT credit_reservations__pk PRIMARY KEY (id),
  CONSTRAINT credit_reservations__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT credit_reservations__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT credit_reservations__check_1 CHECK (state IN ('held','settled','released','expired')),
  CONSTRAINT credit_reservations__check_2 CHECK (expires_at > created_at),
  CONSTRAINT credit_reservations__check_3 CHECK ((state = 'held') = (settled_at IS NULL)),
  CONSTRAINT credit_reservations__check_4 CHECK (revision > 0),
  CONSTRAINT credit_reservations__unique_1 UNIQUE (workspace_id, job_id),
  CONSTRAINT credit_reservations__unique_2 UNIQUE (workspace_id, quote_id),
  CONSTRAINT credit_reservations__unique_3 UNIQUE (workspace_id, id, job_id, quote_id),
  CONSTRAINT credit_reservations__fk_2 FOREIGN KEY (workspace_id, quote_id) REFERENCES generation_quotes(workspace_id, id),
  CONSTRAINT credit_reservations__job_quote_fk FOREIGN KEY (workspace_id, job_id, quote_id) REFERENCES jobs(workspace_id, id, quote_id)
);
CREATE INDEX credit_reservations__ref_1_ix ON credit_reservations (workspace_id, job_id);
CREATE INDEX credit_reservations__ref_2_ix ON credit_reservations (workspace_id, quote_id);
-- 按最早到期分配；各批次金额总和由事务服务保证
CREATE TABLE credit_reservation_allocations (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  reservation_id opaque_id NOT NULL,
  lot_id opaque_id NOT NULL,
  amount safe_uint NOT NULL,
  CONSTRAINT credit_reservation_allocations__pk PRIMARY KEY (id),
  CONSTRAINT credit_reservation_allocations__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT credit_reservation_allocations__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT credit_reservation_allocations__check_1 CHECK (amount > 0),
  CONSTRAINT credit_reservation_allocations__unique_1 UNIQUE (workspace_id, reservation_id, lot_id),
  CONSTRAINT credit_reservation_allocations__fk_1 FOREIGN KEY (workspace_id, reservation_id) REFERENCES credit_reservations(workspace_id, id),
  CONSTRAINT credit_reservation_allocations__fk_2 FOREIGN KEY (workspace_id, lot_id) REFERENCES credit_lots(workspace_id, id)
);
CREATE INDEX credit_reservation_allocations__ref_1_ix ON credit_reservation_allocations (workspace_id, reservation_id);
CREATE INDEX credit_reservation_allocations__ref_2_ix ON credit_reservation_allocations (workspace_id, lot_id);
-- 追加非负金额流水；全局 operation_id 唯一，每批次一行
CREATE TABLE credit_ledger (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  operation_id opaque_id NOT NULL,
  operation_line integer NOT NULL DEFAULT 1,
  operation_group_id opaque_id NOT NULL,
  lot_id opaque_id NOT NULL,
  reservation_id opaque_id,
  entry_type text NOT NULL,
  amount safe_uint NOT NULL,
  from_bucket text NOT NULL,
  to_bucket text NOT NULL,
  balance_after safe_uint NOT NULL,
  reason_code text NOT NULL,
  CONSTRAINT credit_ledger__pk PRIMARY KEY (id),
  CONSTRAINT credit_ledger__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT credit_ledger__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT credit_ledger__check_1 CHECK (operation_line > 0),
  CONSTRAINT credit_ledger__check_2 CHECK (amount > 0),
  CONSTRAINT credit_ledger__check_3 CHECK (entry_type IN ('grant','reserve','settle','release','expire','revoke','adjustment')),
  CONSTRAINT credit_ledger__check_4 CHECK (from_bucket IN ('external','available','reserved','consumed','expired','revoked')),
  CONSTRAINT credit_ledger__check_5 CHECK (to_bucket IN ('external','available','reserved','consumed','expired','revoked')),
  CONSTRAINT credit_ledger__check_6 CHECK (from_bucket <> to_bucket),
  CONSTRAINT credit_ledger__check_7 CHECK ((entry_type = 'grant' AND from_bucket = 'external' AND to_bucket = 'available') OR (entry_type = 'reserve' AND from_bucket = 'available' AND to_bucket = 'reserved') OR (entry_type = 'settle' AND from_bucket = 'reserved' AND to_bucket = 'consumed') OR (entry_type = 'release' AND from_bucket = 'reserved' AND to_bucket IN ('available','expired','revoked')) OR (entry_type = 'expire' AND from_bucket = 'available' AND to_bucket = 'expired') OR (entry_type = 'revoke' AND from_bucket IN ('available','reserved') AND to_bucket = 'revoked') OR entry_type = 'adjustment'),
  CONSTRAINT credit_ledger__unique_1 UNIQUE (operation_id),
  CONSTRAINT credit_ledger__unique_2 UNIQUE (workspace_id, operation_group_id, operation_line),
  CONSTRAINT credit_ledger__fk_1 FOREIGN KEY (workspace_id, lot_id) REFERENCES credit_lots(workspace_id, id),
  CONSTRAINT credit_ledger__fk_2 FOREIGN KEY (workspace_id, reservation_id) REFERENCES credit_reservations(workspace_id, id)
);
CREATE INDEX credit_ledger__ref_1_ix ON credit_ledger (workspace_id, lot_id);
CREATE INDEX credit_ledger__ref_2_ix ON credit_ledger (workspace_id, reservation_id);
-- 采购预占绑定接受当天与稳定账户；连接与账户双锁
CREATE TABLE budget_reservations (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  job_id opaque_id NOT NULL,
  quote_id opaque_id NOT NULL,
  billing_account_id opaque_id NOT NULL,
  connection_id opaque_id NOT NULL,
  provider_version_id opaque_id NOT NULL,
  budget_day_id opaque_id NOT NULL,
  provider_budget_day_id opaque_id NOT NULL,
  reserved_fen safe_uint NOT NULL,
  actual_fen safe_uint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'held',
  expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT budget_reservations__pk PRIMARY KEY (id),
  CONSTRAINT budget_reservations__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT budget_reservations__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT budget_reservations__check_1 CHECK (state IN ('held','settled','released','expired')),
  CONSTRAINT budget_reservations__check_2 CHECK (expires_at > created_at),
  CONSTRAINT budget_reservations__check_3 CHECK ((state = 'held') = (settled_at IS NULL)),
  CONSTRAINT budget_reservations__check_4 CHECK (revision > 0),
  CONSTRAINT budget_reservations__unique_1 UNIQUE (workspace_id, job_id),
  CONSTRAINT budget_reservations__fk_1 FOREIGN KEY (workspace_id, job_id, quote_id) REFERENCES jobs(workspace_id, id, quote_id),
  CONSTRAINT budget_reservations__fk_2 FOREIGN KEY (provider_version_id, connection_id, billing_account_id) REFERENCES ai_provider_versions(id, connection_id, billing_account_id),
  CONSTRAINT budget_reservations__fk_3 FOREIGN KEY (budget_day_id, billing_account_id) REFERENCES budget_days(id, billing_account_id),
  CONSTRAINT budget_reservations__fk_4 FOREIGN KEY (provider_budget_day_id, budget_day_id, billing_account_id, connection_id) REFERENCES provider_budget_days(id, budget_day_id, billing_account_id, connection_id)
);
CREATE INDEX budget_reservations__ref_1_ix ON budget_reservations (workspace_id, job_id, quote_id);
CREATE INDEX budget_reservations__ref_2_ix ON budget_reservations (provider_version_id, connection_id, billing_account_id);
CREATE INDEX budget_reservations__ref_3_ix ON budget_reservations (budget_day_id, billing_account_id);
CREATE INDEX budget_reservations__ref_4_ix ON budget_reservations (provider_budget_day_id, budget_day_id, billing_account_id, connection_id);
-- 采购成本追加账本；查询费用与迟到费用单独对账
CREATE TABLE provider_cost_ledger (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  billing_account_id opaque_id NOT NULL,
  budget_day_id opaque_id NOT NULL,
  reservation_id opaque_id,
  operation_id opaque_id NOT NULL,
  entry_type text NOT NULL,
  amount_fen safe_uint NOT NULL,
  provider_charge_ref text,
  reason_code text NOT NULL,
  CONSTRAINT provider_cost_ledger__pk PRIMARY KEY (id),
  CONSTRAINT provider_cost_ledger__check_1 CHECK (entry_type IN ('reserve','release','settle','late_charge','reconcile')),
  CONSTRAINT provider_cost_ledger__unique_1 UNIQUE (operation_id),
  CONSTRAINT provider_cost_ledger__fk_1 FOREIGN KEY (budget_day_id, billing_account_id) REFERENCES budget_days(id, billing_account_id),
  CONSTRAINT provider_cost_ledger__fk_2 FOREIGN KEY (reservation_id) REFERENCES budget_reservations(id)
);
CREATE INDEX provider_cost_ledger__ref_1_ix ON provider_cost_ledger (budget_day_id, billing_account_id);
CREATE INDEX provider_cost_ledger__ref_2_ix ON provider_cost_ledger (reservation_id);
-- 生成来源不可变；输入授权、模型、标识、审核可追溯
CREATE TABLE generation_provenance (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  job_id opaque_id NOT NULL,
  asset_id opaque_id NOT NULL,
  quote_id opaque_id NOT NULL,
  consent_id opaque_id NOT NULL,
  provider_version_id opaque_id NOT NULL,
  model_version_id opaque_id NOT NULL,
  preset_version_id opaque_id,
  input_hash sha256_hex NOT NULL,
  provider_request_id text NOT NULL,
  provider_job_id text,
  seed bigint,
  license_version_id opaque_id NOT NULL,
  moderation_policy_ref text NOT NULL,
  label_policy_ref text NOT NULL,
  moderation_result text NOT NULL,
  label_applied boolean NOT NULL,
  CONSTRAINT generation_provenance__pk PRIMARY KEY (id),
  CONSTRAINT generation_provenance__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT generation_provenance__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT generation_provenance__check_1 CHECK (moderation_result IN ('approved','rejected','quarantined')),
  CONSTRAINT generation_provenance__unique_1 UNIQUE (workspace_id, asset_id),
  CONSTRAINT generation_provenance__fk_1 FOREIGN KEY (workspace_id, job_id, quote_id) REFERENCES jobs(workspace_id, id, quote_id),
  CONSTRAINT generation_provenance__fk_2 FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id),
  CONSTRAINT generation_provenance__fk_3 FOREIGN KEY (workspace_id, consent_id) REFERENCES generation_consents(workspace_id, id),
  CONSTRAINT generation_provenance__fk_4 FOREIGN KEY (model_version_id, provider_version_id) REFERENCES ai_model_versions(id, provider_version_id),
  CONSTRAINT generation_provenance__fk_5 FOREIGN KEY (preset_version_id) REFERENCES ai_preset_versions(id),
  CONSTRAINT generation_provenance__fk_6 FOREIGN KEY (license_version_id) REFERENCES license_versions(id)
);
CREATE INDEX generation_provenance__ref_1_ix ON generation_provenance (workspace_id, job_id, quote_id);
CREATE INDEX generation_provenance__ref_2_ix ON generation_provenance (workspace_id, asset_id);
CREATE INDEX generation_provenance__ref_3_ix ON generation_provenance (workspace_id, consent_id);
CREATE INDEX generation_provenance__ref_4_ix ON generation_provenance (model_version_id, provider_version_id);
CREATE INDEX generation_provenance__ref_5_ix ON generation_provenance (preset_version_id);
CREATE INDEX generation_provenance__ref_6_ix ON generation_provenance (license_version_id);
-- 主事务同时写出的可重投调度事实
CREATE TABLE outbox (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id,
  event_key opaque_id NOT NULL,
  aggregate_kind text NOT NULL,
  aggregate_id opaque_id NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_by opaque_id,
  claim_expires_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  last_error_code text,
  CONSTRAINT outbox__pk PRIMARY KEY (id),
  CONSTRAINT outbox__check_1 CHECK (delivery_attempts BETWEEN 0 AND 1000000),
  CONSTRAINT outbox__check_2 CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT outbox__check_3 CHECK ((claimed_by IS NULL) = (claim_expires_at IS NULL)),
  CONSTRAINT outbox__unique_1 UNIQUE (event_key),
  CONSTRAINT outbox__fk_1 FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);
CREATE INDEX outbox__ref_1_ix ON outbox (workspace_id);
-- 工作区/身份作用域幂等；同 key 异 payload 409
CREATE TABLE idempotency_keys (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id,
  principal_scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash sha256_hex NOT NULL,
  operation text NOT NULL,
  state text NOT NULL DEFAULT 'processing',
  response_status integer,
  response_json jsonb,
  resource_kind text,
  resource_id opaque_id,
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_keys__pk PRIMARY KEY (id),
  CONSTRAINT idempotency_keys__check_1 CHECK (char_length(principal_scope) BETWEEN 1 AND 200),
  CONSTRAINT idempotency_keys__check_2 CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT idempotency_keys__check_3 CHECK (state IN ('processing','completed')),
  CONSTRAINT idempotency_keys__check_4 CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  CONSTRAINT idempotency_keys__check_5 CHECK (expires_at >= created_at + interval '7 days'),
  CONSTRAINT idempotency_keys__check_6 CHECK (state <> 'completed' OR response_status IS NOT NULL),
  CONSTRAINT idempotency_keys__fk_1 FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);
CREATE INDEX idempotency_keys__ref_1_ix ON idempotency_keys (workspace_id);
-- 私有预览分享；撤销后不再发签名 URL
CREATE TABLE share_links (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  project_id opaque_id NOT NULL,
  revision_id opaque_id NOT NULL,
  created_by opaque_id NOT NULL,
  token_hash sha256_hex NOT NULL,
  password_hash text,
  scope text NOT NULL DEFAULT 'preview',
  state text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT share_links__pk PRIMARY KEY (id),
  CONSTRAINT share_links__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT share_links__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT share_links__check_1 CHECK (scope IN ('preview','preview_download')),
  CONSTRAINT share_links__check_2 CHECK (state IN ('active','revoked','expired')),
  CONSTRAINT share_links__check_3 CHECK (expires_at > created_at),
  CONSTRAINT share_links__check_4 CHECK (revision > 0),
  CONSTRAINT share_links__unique_1 UNIQUE (token_hash),
  CONSTRAINT share_links__fk_1 FOREIGN KEY (workspace_id, project_id, revision_id) REFERENCES project_revisions(workspace_id, project_id, id),
  CONSTRAINT share_links__fk_2 FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX share_links__ref_1_ix ON share_links (workspace_id, project_id, revision_id);
CREATE INDEX share_links__ref_2_ix ON share_links (created_by);
-- 分享限速与审计；不存原始 IP
CREATE TABLE share_access_events (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  share_link_id opaque_id NOT NULL,
  outcome text NOT NULL,
  request_id opaque_id NOT NULL,
  visitor_digest sha256_hex NOT NULL,
  CONSTRAINT share_access_events__pk PRIMARY KEY (id),
  CONSTRAINT share_access_events__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT share_access_events__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT share_access_events__check_1 CHECK (outcome IN ('granted','denied','expired','revoked')),
  CONSTRAINT share_access_events__fk_1 FOREIGN KEY (workspace_id, share_link_id) REFERENCES share_links(workspace_id, id)
);
CREATE INDEX share_access_events__ref_1_ix ON share_access_events (workspace_id, share_link_id);
-- 用户按渠道/类别通知偏好
CREATE TABLE notification_preferences (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  user_id opaque_id NOT NULL,
  channel text NOT NULL,
  category text NOT NULL,
  enabled boolean NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT notification_preferences__pk PRIMARY KEY (id),
  CONSTRAINT notification_preferences__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT notification_preferences__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT notification_preferences__check_1 CHECK (channel IN ('in_app','wechat','email_reserved')),
  CONSTRAINT notification_preferences__check_2 CHECK (category IN ('job','billing','security','workspace','system')),
  CONSTRAINT notification_preferences__check_3 CHECK (revision > 0),
  CONSTRAINT notification_preferences__unique_1 UNIQUE (workspace_id, user_id, channel, category),
  CONSTRAINT notification_preferences__fk_1 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX notification_preferences__ref_1_ix ON notification_preferences (user_id);
-- 站内通知稳定事实；不携带原图/秘密
CREATE TABLE notifications (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  recipient_user_id opaque_id NOT NULL,
  event_key opaque_id NOT NULL,
  category text NOT NULL,
  template_key text NOT NULL,
  template_version integer NOT NULL,
  redacted_payload jsonb NOT NULL,
  read_at timestamptz,
  expires_at timestamptz NOT NULL,
  CONSTRAINT notifications__pk PRIMARY KEY (id),
  CONSTRAINT notifications__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT notifications__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT notifications__check_1 CHECK (category IN ('job','billing','security','workspace','system')),
  CONSTRAINT notifications__check_2 CHECK (template_version > 0),
  CONSTRAINT notifications__check_3 CHECK (jsonb_typeof(redacted_payload) = 'object'),
  CONSTRAINT notifications__check_4 CHECK (expires_at > created_at),
  CONSTRAINT notifications__unique_1 UNIQUE (workspace_id, recipient_user_id, event_key),
  CONSTRAINT notifications__fk_1 FOREIGN KEY (recipient_user_id) REFERENCES users(id)
);
CREATE INDEX notifications__ref_1_ix ON notifications (recipient_user_id);
-- 渠道发送重试去重；App 仅保留 future 通道
CREATE TABLE notification_deliveries (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id NOT NULL,
  notification_id opaque_id NOT NULL,
  channel text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  next_attempt_at timestamptz,
  error_code text,
  CONSTRAINT notification_deliveries__pk PRIMARY KEY (id),
  CONSTRAINT notification_deliveries__tenant_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT notification_deliveries__workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT notification_deliveries__check_1 CHECK (channel IN ('in_app','wechat','email_reserved','app_reserved')),
  CONSTRAINT notification_deliveries__check_2 CHECK (attempt BETWEEN 1 AND 10),
  CONSTRAINT notification_deliveries__check_3 CHECK (state IN ('pending','sending','sent','failed','suppressed')),
  CONSTRAINT notification_deliveries__unique_1 UNIQUE (workspace_id, notification_id, channel, attempt),
  CONSTRAINT notification_deliveries__fk_1 FOREIGN KEY (workspace_id, notification_id) REFERENCES notifications(workspace_id, id)
);
CREATE INDEX notification_deliveries__ref_1_ix ON notification_deliveries (workspace_id, notification_id);
-- 备份恢复必须重放的删除标记，无原始 PII
CREATE TABLE deletion_tombstones (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id opaque_id,
  user_id opaque_id,
  target_kind text NOT NULL,
  target_id opaque_id NOT NULL,
  object_locator_hash sha256_hex,
  operation_id opaque_id NOT NULL,
  deleted_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL,
  reason_code text NOT NULL,
  CONSTRAINT deletion_tombstones__pk PRIMARY KEY (id),
  CONSTRAINT deletion_tombstones__check_1 CHECK (retain_until >= deleted_at),
  CONSTRAINT deletion_tombstones__check_2 CHECK (num_nonnulls(workspace_id, user_id) >= 1),
  CONSTRAINT deletion_tombstones__unique_1 UNIQUE (operation_id, target_kind, target_id),
  CONSTRAINT deletion_tombstones__fk_1 FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT deletion_tombstones__fk_2 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX deletion_tombstones__ref_1_ix ON deletion_tombstones (workspace_id);
CREATE INDEX deletion_tombstones__ref_2_ix ON deletion_tombstones (user_id);
-- 数据库和对象备份分开证据；不含凭据或声称已演练
CREATE TABLE backup_runs (
  id opaque_id NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL,
  kind text NOT NULL,
  state text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  backup_reference text NOT NULL,
  manifest_hash sha256_hex,
  restored_tombstone_watermark timestamptz,
  error_code text,
  CONSTRAINT backup_runs__pk PRIMARY KEY (id),
  CONSTRAINT backup_runs__check_1 CHECK (environment IN ('dev','staging','prod')),
  CONSTRAINT backup_runs__check_2 CHECK (kind IN ('database','objects','restore_drill')),
  CONSTRAINT backup_runs__check_3 CHECK (state IN ('running','succeeded','failed')),
  CONSTRAINT backup_runs__check_4 CHECK (completed_at IS NULL OR completed_at >= started_at)
);

-- PostgreSQL 16+ NULLS NOT DISTINCT gives virtual-root sibling uniqueness.
CREATE UNIQUE INDEX asset_folders__live_name_uq ON asset_folders (workspace_id, parent_id, normalized_name) NULLS NOT DISTINCT WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idempotency_keys__scope_key_uq ON idempotency_keys (workspace_id, principal_scope, idempotency_key) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX payment_attempts__provider_transaction_uq ON payment_attempts(channel, merchant_account_ref, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX assets__live_folder_ix ON assets(workspace_id, folder_id, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX assets__workspace_hash_ix ON assets(workspace_id, sha256) WHERE deleted_at IS NULL;
CREATE INDEX jobs__dispatch_ix ON jobs(state, next_attempt_at, created_at, id) WHERE state IN ('queued','retry_wait');
CREATE INDEX jobs__lease_expiry_ix ON jobs(lease_expires_at, id) WHERE state IN ('running','packaging','cancel_requested');
CREATE INDEX outbox__pending_ix ON outbox(available_at, created_at, id) WHERE sent_at IS NULL;
CREATE INDEX credit_lots__expiry_ix ON credit_lots(workspace_id, expires_at, id) WHERE available > 0;
CREATE INDEX credit_reservations__expiry_ix ON credit_reservations(expires_at, id) WHERE state = 'held';
CREATE INDEX budget_reservations__expiry_ix ON budget_reservations(expires_at, id) WHERE state = 'held';
CREATE INDEX resource_pins__active_object_ix ON resource_pins(workspace_id, storage_object_id) WHERE released_at IS NULL;
CREATE INDEX notifications__unread_ix ON notifications(workspace_id, recipient_user_id, created_at, id) WHERE read_at IS NULL;
CREATE INDEX deletion_tombstones__replay_ix ON deletion_tombstones(deleted_at, id);

CREATE FUNCTION reject_row_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = TG_TABLE_NAME || ' is append-only; insert a new version or compensating event';
END;
$$;
CREATE FUNCTION keep_identity_and_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'identity and creation time are immutable';
  END IF;
  IF to_jsonb(NEW)->'workspace_id' IS DISTINCT FROM to_jsonb(OLD)->'workspace_id' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'workspace ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION keep_asset_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sha256 IS NOT NULL AND (NEW.sha256, NEW.byte_size, NEW.width, NEW.height, NEW.mime_type, NEW.origin)
     IS DISTINCT FROM (OLD.sha256, OLD.byte_size, OLD.width, OLD.height, OLD.mime_type, OLD.origin) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'asset bytes and identity metadata are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION keep_storage_locator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.profile_version_id, NEW.bucket, NEW.object_key, NEW.object_version_id, NEW.kind, NEW.sha256, NEW.byte_size, NEW.mime_type)
     IS DISTINCT FROM (OLD.profile_version_id, OLD.bucket, OLD.object_key, OLD.object_version_id, OLD.kind, OLD.sha256, OLD.byte_size, OLD.mime_type) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'physical locator/content immutable; migration creates a new storage_object';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION guard_job_initial_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'queued' OR NEW.fence <> 0 OR NEW.revision <> 1 OR NEW.attempt_count <> 0 OR NEW.lease_owner IS NOT NULL OR NEW.terminal_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'new job must start queued without a lease or terminal fact';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION guard_job_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.snapshot_id, NEW.kind, NEW.quote_id, NEW.parent_job_id, NEW.created_by)
     IS DISTINCT FROM (OLD.snapshot_id, OLD.kind, OLD.quote_id, OLD.parent_job_id, OLD.created_by) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'frozen job inputs cannot change';
  END IF;
  IF OLD.state IN ('succeeded','failed','cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'terminal job cannot change';
  END IF;
  IF NEW.revision <> OLD.revision + 1 OR NEW.fence < OLD.fence OR NEW.fence > OLD.fence + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'job revision must advance once; fence monotonic by at most one';
  END IF;
  IF OLD.state = 'queued' AND NEW.state = 'running' THEN
    IF NEW.fence <> OLD.fence + 1 OR NEW.attempt_count <> OLD.attempt_count + 1 OR NEW.lease_owner IS NULL OR NEW.lease_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'claim must increment fence/attempt and install a live lease';
    END IF;
  ELSIF NEW.fence <> OLD.fence OR NEW.attempt_count <> OLD.attempt_count THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'only a queued-to-running claim can increment fence/attempt';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state = 'queued' AND NEW.state IN ('running','cancel_requested','failed','cancelled')) OR
    (OLD.state = 'running' AND NEW.state IN ('packaging','retry_wait','cancel_requested','succeeded','failed')) OR
    (OLD.state = 'packaging' AND NEW.state IN ('retry_wait','cancel_requested','succeeded','failed')) OR
    (OLD.state = 'retry_wait' AND NEW.state IN ('queued','cancel_requested','failed','cancelled')) OR
    (OLD.state = 'cancel_requested' AND NEW.state IN ('cancelled','failed'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'illegal job state transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION guard_output_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j record;
BEGIN
  SELECT state, fence, lease_expires_at INTO j FROM ai_album.jobs WHERE id=NEW.job_id AND workspace_id=NEW.workspace_id FOR UPDATE;
  IF NOT FOUND OR j.state NOT IN ('running','packaging') OR j.fence <> NEW.committed_fence OR j.lease_expires_at IS NULL OR j.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'output needs current live worker fence and publishable state';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assets__content_guard BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION keep_asset_content();
CREATE TRIGGER storage_objects__locator_guard BEFORE UPDATE ON storage_objects FOR EACH ROW EXECUTE FUNCTION keep_storage_locator();
CREATE TRIGGER jobs__initial_guard BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION guard_job_initial_state();
CREATE TRIGGER jobs__state_guard BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION guard_job_transition();
CREATE TRIGGER job_outputs__fence_guard BEFORE INSERT ON job_outputs FOR EACH ROW EXECUTE FUNCTION guard_output_commit();
CREATE TRIGGER users__identity_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER auth_identities__identity_guard BEFORE UPDATE ON auth_identities FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER auth_sessions__identity_guard BEFORE UPDATE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER auth_challenges__identity_guard BEFORE UPDATE ON auth_challenges FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER binding_requests__identity_guard BEFORE UPDATE ON binding_requests FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER account_deletion_requests__identity_guard BEFORE UPDATE ON account_deletion_requests FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER workspaces__identity_guard BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER workspace_members__identity_guard BEFORE UPDATE ON workspace_members FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER workspace_settings__identity_guard BEFORE UPDATE ON workspace_settings FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER user_preferences__identity_guard BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER secret_references__identity_guard BEFORE UPDATE ON secret_references FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER admin_role_assignments__identity_guard BEFORE UPDATE ON admin_role_assignments FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER config_drafts__identity_guard BEFORE UPDATE ON config_drafts FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER config_releases__append_guard BEFORE UPDATE OR DELETE ON config_releases FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER config_active_releases__identity_guard BEFORE UPDATE ON config_active_releases FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER config_release_items__append_guard BEFORE UPDATE OR DELETE ON config_release_items FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER config_tests__append_guard BEFORE UPDATE OR DELETE ON config_tests FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER audit_events__append_guard BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER license_versions__append_guard BEFORE UPDATE OR DELETE ON license_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER storage_profiles__identity_guard BEFORE UPDATE ON storage_profiles FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER storage_profile_versions__append_guard BEFORE UPDATE OR DELETE ON storage_profile_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER storage_objects__identity_guard BEFORE UPDATE ON storage_objects FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER asset_folders__identity_guard BEFORE UPDATE ON asset_folders FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER assets__identity_guard BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER asset_variants__append_guard BEFORE UPDATE OR DELETE ON asset_variants FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER storage_usage_accounts__identity_guard BEFORE UPDATE ON storage_usage_accounts FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER storage_quota_reservations__identity_guard BEFORE UPDATE ON storage_quota_reservations FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER upload_sessions__identity_guard BEFORE UPDATE ON upload_sessions FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER trash_operations__identity_guard BEFORE UPDATE ON trash_operations FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER trash_items__append_guard BEFORE UPDATE OR DELETE ON trash_items FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER storage_migrations__identity_guard BEFORE UPDATE ON storage_migrations FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER storage_migration_items__identity_guard BEFORE UPDATE ON storage_migration_items FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER projects__identity_guard BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER project_revisions__append_guard BEFORE UPDATE OR DELETE ON project_revisions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER project_revision_assets__append_guard BEFORE UPDATE OR DELETE ON project_revision_assets FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER recovery_drafts__identity_guard BEFORE UPDATE ON recovery_drafts FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER templates__identity_guard BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER fonts__identity_guard BEFORE UPDATE ON fonts FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER filters__identity_guard BEFORE UPDATE ON filters FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER template_versions__append_guard BEFORE UPDATE OR DELETE ON template_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER font_versions__append_guard BEFORE UPDATE OR DELETE ON font_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER filter_versions__append_guard BEFORE UPDATE OR DELETE ON filter_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER billing_skus__identity_guard BEFORE UPDATE ON billing_skus FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER sku_versions__append_guard BEFORE UPDATE OR DELETE ON sku_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER orders__identity_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER payment_attempts__identity_guard BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER payment_events__append_guard BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER refunds__identity_guard BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER redemption_batches__identity_guard BEFORE UPDATE ON redemption_batches FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER redemption_codes__identity_guard BEFORE UPDATE ON redemption_codes FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER redemptions__append_guard BEFORE UPDATE OR DELETE ON redemptions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER entitlement_grants__identity_guard BEFORE UPDATE ON entitlement_grants FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER subscriptions__identity_guard BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER credit_accounts__identity_guard BEFORE UPDATE ON credit_accounts FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER credit_lots__identity_guard BEFORE UPDATE ON credit_lots FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER ai_billing_accounts__identity_guard BEFORE UPDATE ON ai_billing_accounts FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER ai_provider_connections__identity_guard BEFORE UPDATE ON ai_provider_connections FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER ai_provider_versions__append_guard BEFORE UPDATE OR DELETE ON ai_provider_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER ai_models__identity_guard BEFORE UPDATE ON ai_models FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER ai_model_versions__append_guard BEFORE UPDATE OR DELETE ON ai_model_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER ai_routes__identity_guard BEFORE UPDATE ON ai_routes FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER ai_route_versions__append_guard BEFORE UPDATE OR DELETE ON ai_route_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER ai_presets__identity_guard BEFORE UPDATE ON ai_presets FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER cost_rule_versions__append_guard BEFORE UPDATE OR DELETE ON cost_rule_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER ai_preset_versions__append_guard BEFORE UPDATE OR DELETE ON ai_preset_versions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER ai_preset_models__append_guard BEFORE UPDATE OR DELETE ON ai_preset_models FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER budget_days__identity_guard BEFORE UPDATE ON budget_days FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER provider_budget_days__identity_guard BEFORE UPDATE ON provider_budget_days FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER generation_consents__append_guard BEFORE UPDATE OR DELETE ON generation_consents FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER generation_quotes__append_guard BEFORE UPDATE OR DELETE ON generation_quotes FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER export_preflights__append_guard BEFORE UPDATE OR DELETE ON export_preflights FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER job_snapshots__append_guard BEFORE UPDATE OR DELETE ON job_snapshots FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER jobs__identity_guard BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER job_attempts__identity_guard BEFORE UPDATE ON job_attempts FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER resource_pins__identity_guard BEFORE UPDATE ON resource_pins FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER job_outputs__append_guard BEFORE UPDATE OR DELETE ON job_outputs FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER layout_candidates__append_guard BEFORE UPDATE OR DELETE ON layout_candidates FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER credit_reservations__identity_guard BEFORE UPDATE ON credit_reservations FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER credit_reservation_allocations__append_guard BEFORE UPDATE OR DELETE ON credit_reservation_allocations FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER credit_ledger__append_guard BEFORE UPDATE OR DELETE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER budget_reservations__identity_guard BEFORE UPDATE ON budget_reservations FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER provider_cost_ledger__append_guard BEFORE UPDATE OR DELETE ON provider_cost_ledger FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER generation_provenance__append_guard BEFORE UPDATE OR DELETE ON generation_provenance FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER outbox__identity_guard BEFORE UPDATE ON outbox FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER idempotency_keys__identity_guard BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER share_links__identity_guard BEFORE UPDATE ON share_links FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER share_access_events__append_guard BEFORE UPDATE OR DELETE ON share_access_events FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER notification_preferences__identity_guard BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER notifications__identity_guard BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER notification_deliveries__identity_guard BEFORE UPDATE ON notification_deliveries FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();
CREATE TRIGGER deletion_tombstones__append_guard BEFORE UPDATE OR DELETE ON deletion_tombstones FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER backup_runs__identity_guard BEFORE UPDATE ON backup_runs FOR EACH ROW EXECUTE FUNCTION keep_identity_and_owner();

-- Role provisioning is deliberately deployment-owned. No service role may own this schema,
-- disable triggers, TRUNCATE, or ALTER tables. Immutable row retention needs a separate audited
-- maintenance migration; the normal service role has SELECT/INSERT only on immutable tables.
REVOKE ALL ON SCHEMA ai_album FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ai_album FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ai_album FROM PUBLIC;
COMMIT;
