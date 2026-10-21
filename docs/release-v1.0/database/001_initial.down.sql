-- DESTRUCTIVE, LOCAL DISPOSABLE DATABASES ONLY. Drops ALL ai_album data and objects.
-- Not a production rollback. Stop workers/API first; restore a verified backup for production.
-- Explicit guard: psql -X -v ON_ERROR_STOP=1 -c "SET ai_album.allow_destructive_local_reset = 'yes';" -f 001_initial.down.sql
BEGIN;
DO $$ BEGIN
  IF current_setting('ai_album.allow_destructive_local_reset', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'local-only reset requires ai_album.allow_destructive_local_reset=yes in this session';
  END IF;
END $$;
DROP SCHEMA ai_album CASCADE;
COMMIT;
