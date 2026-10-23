-- Additive runtime state; canonical contract tables remain the source of truth.
CREATE TABLE ai_album.auth_qr_context (
 challenge_id text PRIMARY KEY REFERENCES ai_album.auth_challenges(id),
 nonce_hash text NOT NULL, poll_hash text NOT NULL
);
CREATE TABLE ai_album.project_revision_payloads (
 revision_id text PRIMARY KEY REFERENCES ai_album.project_revisions(id),
 document jsonb NOT NULL, resources jsonb NOT NULL
);
CREATE FUNCTION ai_album.c3_immutable_payload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable revision payload'; END $$;
CREATE TRIGGER project_payload_immutable BEFORE UPDATE OR DELETE ON ai_album.project_revision_payloads FOR EACH ROW EXECUTE FUNCTION ai_album.c3_immutable_payload();
CREATE TABLE ai_album.share_outputs(workspace_id text NOT NULL,share_id text NOT NULL,output_id text NOT NULL,PRIMARY KEY(share_id,output_id),FOREIGN KEY(workspace_id,share_id) REFERENCES ai_album.share_links(workspace_id,id),FOREIGN KEY(workspace_id,output_id) REFERENCES ai_album.job_outputs(workspace_id,id));
CREATE TABLE ai_album.share_sessions(token_hash text PRIMARY KEY,workspace_id text NOT NULL,share_id text NOT NULL,expires_at timestamptz NOT NULL,FOREIGN KEY(workspace_id,share_id) REFERENCES ai_album.share_links(workspace_id,id));
CREATE TABLE ai_album.notification_consents(workspace_id text NOT NULL REFERENCES ai_album.workspaces(id),user_id text NOT NULL REFERENCES ai_album.users(id),template_key text NOT NULL,template_version integer NOT NULL CHECK(template_version>0),enabled boolean NOT NULL,destination_verified boolean NOT NULL,proof_digest text NOT NULL,PRIMARY KEY(workspace_id,user_id,template_key));
CREATE TABLE ai_album.project_revision_resources (
 revision_id ai_album.opaque_id NOT NULL REFERENCES ai_album.project_revisions(id),
 storage_workspace_id ai_album.opaque_id NOT NULL,
 storage_object_id ai_album.opaque_id NOT NULL,
 font_version_id ai_album.opaque_id REFERENCES ai_album.font_versions(id),
 PRIMARY KEY(revision_id,storage_object_id),
 FOREIGN KEY(storage_workspace_id,storage_object_id) REFERENCES ai_album.storage_objects(workspace_id,id)
);
CREATE TRIGGER project_resources_immutable BEFORE UPDATE OR DELETE ON ai_album.project_revision_resources FOR EACH ROW EXECUTE FUNCTION ai_album.c3_immutable_payload();
ALTER TABLE ai_album.upload_sessions ADD COLUMN expected_sha256 ai_album.sha256_hex;
ALTER TABLE ai_album.storage_profile_versions DROP CONSTRAINT storage_profile_versions__check_2;
ALTER TABLE ai_album.storage_profile_versions ADD CONSTRAINT storage_profile_versions__check_2 CHECK (provider IN ('oss','cos','s3','local'));
ALTER TABLE ai_album.storage_profile_versions ADD CONSTRAINT storage_profile_versions_local_dev_only CHECK(provider <> 'local' OR environment='dev');
ALTER TABLE ai_album.auth_qr_context ADD COLUMN last_polled_at timestamptz;
ALTER TABLE ai_album.auth_qr_context ADD COLUMN consumed_session_id text REFERENCES ai_album.auth_sessions(id);
ALTER TABLE ai_album.auth_qr_context ADD COLUMN consumed_key_hash text;
CREATE TABLE ai_album.editor_font_bundles(workspace_id ai_album.opaque_id NOT NULL REFERENCES ai_album.workspaces(id),id ai_album.opaque_id NOT NULL,version integer NOT NULL CHECK(version>0),sha256 ai_album.sha256_hex NOT NULL,record jsonb NOT NULL,license_version_id ai_album.opaque_id NOT NULL REFERENCES ai_album.license_versions(id),state text NOT NULL DEFAULT 'published' CHECK(state IN('published','retired')),PRIMARY KEY(workspace_id,id,version));
CREATE TABLE ai_album.editor_font_faces(workspace_id ai_album.opaque_id NOT NULL,bundle_id ai_album.opaque_id NOT NULL,bundle_version integer NOT NULL,face_id ai_album.opaque_id NOT NULL,storage_object_id ai_album.opaque_id NOT NULL,record jsonb NOT NULL,PRIMARY KEY(workspace_id,bundle_id,bundle_version,face_id),FOREIGN KEY(workspace_id,bundle_id,bundle_version) REFERENCES ai_album.editor_font_bundles(workspace_id,id,version),FOREIGN KEY(workspace_id,storage_object_id) REFERENCES ai_album.storage_objects(workspace_id,id));
CREATE TRIGGER font_bundle_immutable BEFORE UPDATE OR DELETE ON ai_album.editor_font_bundles FOR EACH ROW EXECUTE FUNCTION ai_album.c3_immutable_payload();
CREATE TRIGGER font_faces_immutable BEFORE UPDATE OR DELETE ON ai_album.editor_font_faces FOR EACH ROW EXECUTE FUNCTION ai_album.c3_immutable_payload();
CREATE TABLE ai_album.reauth_proofs(token_hash ai_album.sha256_hex PRIMARY KEY,user_id ai_album.opaque_id NOT NULL REFERENCES ai_album.users(id),session_id ai_album.opaque_id NOT NULL REFERENCES ai_album.auth_sessions(id),purpose text NOT NULL CHECK(purpose IN ('bind','unbind','delete_account','privacy_export','ownership_transfer','billing_refund','admin_secret','admin_publish','admin_operations')),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,consumed_at timestamptz,CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes'));
CREATE TABLE ai_album.c3_recovery_sessions(session_id ai_album.opaque_id PRIMARY KEY REFERENCES ai_album.auth_sessions(id));
-- Asset metadata CAS changes on moves/trash; immutable image content always starts at version 1.
ALTER TABLE ai_album.assets ADD COLUMN content_version integer NOT NULL DEFAULT 1 CHECK(content_version=1);
