-- Durable eligibility survives idempotency expiry; no raw code is stored.
BEGIN;
SET LOCAL search_path TO ai_album, pg_catalog;
ALTER TABLE redemption_batches
  ADD COLUMN starts_at timestamptz,
  ADD COLUMN workspace_kinds text[],
  ADD COLUMN distribution_channel text,
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
-- Legacy eligibility cannot be reconstructed reliably. Keep historical claims,
-- disable new claims, and require explicit reissue with reviewed policy.
UPDATE redemption_batches SET starts_at=created_at,
  workspace_kinds=ARRAY['personal','studio'],
  distribution_channel='legacy-unverified',state='disabled';
ALTER TABLE redemption_batches
  ALTER COLUMN starts_at SET NOT NULL,
  ALTER COLUMN workspace_kinds SET NOT NULL,
  ALTER COLUMN distribution_channel SET NOT NULL,
  ADD CONSTRAINT redemption_batches__policy_window CHECK (expires_at > starts_at),
  ADD CONSTRAINT redemption_batches__policy_kinds CHECK (
    cardinality(workspace_kinds) BETWEEN 1 AND 2
    AND workspace_kinds <@ ARRAY['personal','studio']::text[]
    AND array_position(workspace_kinds,NULL) IS NULL),
  ADD CONSTRAINT redemption_batches__policy_channel CHECK (
    char_length(distribution_channel) BETWEEN 1 AND 128
    AND distribution_channel !~ '[[:cntrl:]]');
CREATE FUNCTION guard_redemption_batch_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.sku_version_id,NEW.created_by,NEW.name,NEW.starts_at,NEW.expires_at,NEW.workspace_kinds,NEW.distribution_channel)
    IS DISTINCT FROM ROW(OLD.sku_version_id,OLD.created_by,OLD.name,OLD.starts_at,OLD.expires_at,OLD.workspace_kinds,OLD.distribution_channel) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='redemption batch eligibility is immutable';
  END IF;
  IF NEW.revision <> OLD.revision+1 OR (OLD.state <> 'active' AND NEW.state='active') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='redemption batch needs monotonic revision and cannot reactivate';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER redemption_batches__policy_guard BEFORE UPDATE ON redemption_batches
  FOR EACH ROW EXECUTE FUNCTION guard_redemption_batch_policy();
COMMIT;
