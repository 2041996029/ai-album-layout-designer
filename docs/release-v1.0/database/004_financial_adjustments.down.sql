BEGIN;
SET search_path TO ai_album, public;
-- Refuse rollback while retained financial facts use this source. Never delete ledger facts.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM financial_adjustments) THEN RAISE EXCEPTION 'RETAINED_FINANCIAL_ADJUSTMENTS'; END IF; END $$;
ALTER TABLE entitlement_grants DROP CONSTRAINT entitlement_grants__adjustment_fk;
DROP INDEX entitlement_grants__adjustment_uq;
ALTER TABLE entitlement_grants DROP CONSTRAINT entitlement_grants__check_1;
ALTER TABLE entitlement_grants DROP COLUMN source_adjustment_id;
ALTER TABLE entitlement_grants ADD CONSTRAINT entitlement_grants__check_1 CHECK(num_nonnulls(source_order_id,source_redemption_id)=1);
DROP TABLE financial_adjustments;
COMMIT;
