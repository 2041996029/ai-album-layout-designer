BEGIN;
SET LOCAL search_path TO ai_album,public;
ALTER TABLE auth_identities DROP CONSTRAINT auth_identities__check_1;
ALTER TABLE auth_identities ADD CONSTRAINT auth_identities__check_1 CHECK(provider IN ('wechat_mini','wechat_web','phone','email','app_reserved'));
ALTER TABLE orders DROP CONSTRAINT orders__check_5;
ALTER TABLE orders ADD CONSTRAINT orders__check_5 CHECK(channel IN ('wechat_pay','wechat_virtual','alipay'));
CREATE TABLE email_challenges (
 id text PRIMARY KEY,
 destination_digest text NOT NULL,
 destination_cipher text NOT NULL,
 source_digest text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('login','bind','reauth','link_wechat')),
 session_id text,
 code_digest text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 delivered boolean NOT NULL DEFAULT false
);
CREATE INDEX email_challenges_destination_time ON email_challenges(destination_digest,created_at);
CREATE INDEX email_challenges_source_time ON email_challenges(source_digest,created_at);
CREATE TABLE email_destinations (
 destination_digest text PRIMARY KEY,
 destination_cipher text NOT NULL
);
COMMIT;
