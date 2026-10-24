-- Disposable local rollback only; production retains durable eligibility.
BEGIN;
DO $$ BEGIN
  IF current_setting('ai_album.allow_destructive_local_reset',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'local-only reset requires ai_album.allow_destructive_local_reset=yes in this session';
  END IF;
END $$;
DROP TRIGGER redemption_batches__policy_guard ON ai_album.redemption_batches;
DROP FUNCTION ai_album.guard_redemption_batch_policy();
ALTER TABLE ai_album.redemption_batches DROP COLUMN starts_at,
  DROP COLUMN workspace_kinds,DROP COLUMN distribution_channel,DROP COLUMN revision;
COMMIT;
