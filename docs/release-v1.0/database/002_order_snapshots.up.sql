-- Durable business facts, independent of the seven-day idempotency retention.
BEGIN;
SET LOCAL search_path TO ai_album, pg_catalog;
CREATE TABLE order_snapshots (
  order_id opaque_id PRIMARY KEY,
  workspace_id opaque_id NOT NULL,
  release_id opaque_id NOT NULL REFERENCES config_releases(id),
  payment_config_id opaque_id NOT NULL REFERENCES config_release_items(id),
  snapshot_hash sha256_hex NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  FOREIGN KEY (workspace_id, order_id) REFERENCES orders(workspace_id, id)
);
CREATE FUNCTION guard_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record; p record; r record;
BEGIN
  SELECT * INTO STRICT o FROM ai_album.orders WHERE workspace_id=NEW.workspace_id AND id=NEW.order_id FOR SHARE;
  SELECT * INTO STRICT p FROM ai_album.config_release_items WHERE id=NEW.payment_config_id;
  SELECT * INTO STRICT r FROM ai_album.config_releases WHERE id=NEW.release_id;
  IF p.release_id <> NEW.release_id OR p.namespace <> 'payment'
     OR NEW.snapshot->>'releaseId' IS DISTINCT FROM NEW.release_id
     OR NEW.snapshot->>'bindingId' IS DISTINCT FROM r.manifest->'versions'->'payment'->>'id'
     OR NEW.snapshot->>'skuVersionId' IS DISTINCT FROM o.sku_version_id
     OR NEW.snapshot->'sku'->>'priceFen' IS DISTINCT FROM o.amount_fen::text
     OR NEW.snapshot->'sku'->>'currency' IS DISTINCT FROM o.currency
     OR NEW.snapshot->'payment'->>'channel' IS DISTINCT FROM o.channel
     OR NEW.snapshot->'payment' IS DISTINCT FROM p.body THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='order snapshot does not match frozen order/release/payment';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_snapshots__binding_guard BEFORE INSERT ON order_snapshots FOR EACH ROW EXECUTE FUNCTION guard_order_snapshot();
CREATE TRIGGER order_snapshots__append_guard BEFORE UPDATE OR DELETE ON order_snapshots FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
REVOKE ALL ON order_snapshots FROM PUBLIC;
COMMIT;
