BEGIN;
SET search_path TO ai_album, public;
CREATE TABLE financial_adjustments (
 id opaque_id PRIMARY KEY,
 workspace_id opaque_id NOT NULL REFERENCES workspaces(id),
 source_grant_id opaque_id NOT NULL,
 actor_user_id opaque_id NOT NULL REFERENCES users(id),
 operation_key text NOT NULL,
 request_hash sha256_hex NOT NULL,
 kind text NOT NULL CHECK(kind IN ('credits','membership')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 ticket_id opaque_id NOT NULL,
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,operation_key),
 FOREIGN KEY(workspace_id,source_grant_id) REFERENCES entitlement_grants(workspace_id,id)
);
ALTER TABLE entitlement_grants ADD COLUMN source_adjustment_id opaque_id;
ALTER TABLE entitlement_grants DROP CONSTRAINT entitlement_grants__check_1;
ALTER TABLE entitlement_grants ADD CONSTRAINT entitlement_grants__check_1 CHECK(num_nonnulls(source_order_id,source_redemption_id,source_adjustment_id)=1);
ALTER TABLE entitlement_grants ADD CONSTRAINT entitlement_grants__adjustment_fk FOREIGN KEY(workspace_id,source_adjustment_id) REFERENCES financial_adjustments(workspace_id,id);
CREATE UNIQUE INDEX entitlement_grants__adjustment_uq ON entitlement_grants(workspace_id,source_adjustment_id,grant_type);
CREATE TRIGGER financial_adjustments__append_guard BEFORE UPDATE OR DELETE ON financial_adjustments FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
COMMIT;
