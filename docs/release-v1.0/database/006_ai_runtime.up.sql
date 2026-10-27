BEGIN;
SET LOCAL search_path TO ai_album,public;
CREATE TABLE generation_quote_inputs (
 quote_id text PRIMARY KEY REFERENCES generation_quotes(id),
 user_id text NOT NULL REFERENCES users(id),
 input_json jsonb NOT NULL,
 context_json jsonb NOT NULL,
 accepted_job_id text REFERENCES jobs(id)
);
CREATE TABLE generation_provider_receipts (
 operation_id text PRIMARY KEY,
 result jsonb NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE generation_reviews (
 id text PRIMARY KEY,
 workspace_id text NOT NULL REFERENCES workspaces(id),
 job_id text NOT NULL REFERENCES jobs(id),
 state text NOT NULL CHECK(state IN ('approved','rejected','review','appealed')),
 reason_code text NOT NULL,
 policy_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE content_publications (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('template','font','preset','sku','filter_manifest')),
 version_id text NOT NULL,
 license_id text NOT NULL REFERENCES license_versions(id),
 review_evidence_ids jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('published','retired')),
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(kind,version_id)
);
CREATE TABLE ai_submission_slots (
 job_id text PRIMARY KEY REFERENCES jobs(id),
 connection_id text NOT NULL REFERENCES ai_provider_connections(id),
 billing_account_id text NOT NULL REFERENCES ai_billing_accounts(id),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz
);
CREATE INDEX ai_submission_slots_connection_time ON ai_submission_slots(connection_id,started_at);
CREATE TABLE generation_inline_objects (
  job_id opaque_id PRIMARY KEY REFERENCES jobs(id),
  locator jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE generation_staged_objects (
  job_id opaque_id NOT NULL REFERENCES jobs(id),
  object_key text PRIMARY KEY,
  locator jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE generation_provenance ADD COLUMN provider_output_sha256 sha256_hex;
COMMIT;
