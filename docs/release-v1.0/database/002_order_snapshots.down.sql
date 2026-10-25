-- Local disposable rollback only. Business snapshots must never be removed in production.
BEGIN;
DO $$ BEGIN
  IF current_setting('ai_album.allow_destructive_local_reset', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'local-only reset requires ai_album.allow_destructive_local_reset=yes in this session';
  END IF;
END $$;
DROP TABLE ai_album.order_snapshots;
DROP FUNCTION ai_album.guard_order_snapshot();
COMMIT;
