-- A PTO decision splits one current part into an accepted share and a returned share.
CREATE TABLE internal_inspection_splits (
 tenant_id uuid NOT NULL, id uuid NOT NULL, report_id uuid NOT NULL, original_part_id uuid NOT NULL,
 accepted_part_id uuid NOT NULL, returned_part_id uuid NOT NULL,
 accepted_quantity numeric(14,3) NOT NULL CHECK(accepted_quantity>0),
 returned_quantity numeric(14,3) NOT NULL CHECK(returned_quantity>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 inspection_version integer NOT NULL CHECK(inspection_version%3=0),
 actor_user_id uuid NOT NULL, request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,original_part_id), UNIQUE(tenant_id,accepted_part_id), UNIQUE(tenant_id,returned_part_id),
 UNIQUE(tenant_id,actor_user_id,request_id),
 FOREIGN KEY(tenant_id,report_id) REFERENCES master_volume_reviews(tenant_id,report_id),
 FOREIGN KEY(tenant_id,original_part_id) REFERENCES accepted_volume_parts(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id),
 CHECK(accepted_part_id<>returned_part_id AND accepted_part_id<>original_part_id AND returned_part_id<>original_part_id)
);
CREATE TABLE internal_inspection_split_shares (
 tenant_id uuid NOT NULL, id uuid NOT NULL, split_id uuid NOT NULL, report_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN('accepted','returned')), quantity numeric(14,3) NOT NULL CHECK(quantity>0),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,split_id,role), UNIQUE(tenant_id,id,report_id,quantity),
 FOREIGN KEY(tenant_id,split_id) REFERENCES internal_inspection_splits(tenant_id,id)
);
ALTER TABLE internal_inspection_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_inspection_splits FORCE ROW LEVEL SECURITY;
ALTER TABLE internal_inspection_split_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_inspection_split_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON internal_inspection_splits USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant());
CREATE POLICY tenant_isolation ON internal_inspection_split_shares USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant());
GRANT SELECT,INSERT ON internal_inspection_splits,internal_inspection_split_shares TO helios_app;

DROP VIEW current_accepted_volume_parts;
ALTER TABLE accepted_volume_parts ADD COLUMN split_share_id uuid;
ALTER TABLE accepted_volume_parts DROP CONSTRAINT accepted_part_provenance;
ALTER TABLE accepted_volume_parts ADD CONSTRAINT accepted_part_provenance CHECK(
 (master_review_id IS NOT NULL AND remainder_event_id IS NULL AND correction_id IS NULL AND split_share_id IS NULL AND id=master_review_id)
 OR(master_review_id IS NULL AND remainder_event_id IS NOT NULL AND correction_id IS NULL AND split_share_id IS NULL AND id=remainder_event_id)
 OR(master_review_id IS NULL AND remainder_event_id IS NULL AND correction_id IS NOT NULL AND split_share_id IS NULL AND id=correction_id)
 OR(master_review_id IS NULL AND remainder_event_id IS NULL AND correction_id IS NULL AND split_share_id IS NOT NULL AND id=split_share_id));
ALTER TABLE accepted_volume_parts ADD CONSTRAINT accepted_part_split_source FOREIGN KEY(tenant_id,split_share_id,report_id,quantity) REFERENCES internal_inspection_split_shares(tenant_id,id,report_id,quantity);
CREATE VIEW current_accepted_volume_parts WITH(security_invoker=true) AS
 SELECT p.* FROM accepted_volume_parts p
 WHERE NOT EXISTS(SELECT 1 FROM volume_corrections c WHERE c.tenant_id=p.tenant_id AND c.previous_part_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM internal_inspection_splits s WHERE s.tenant_id=p.tenant_id AND s.original_part_id=p.id);
GRANT SELECT ON current_accepted_volume_parts TO helios_app;

CREATE FUNCTION validate_internal_inspection_split() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous accepted_volume_parts%ROWTYPE; pinned internal_inspections%ROWTYPE; prior internal_inspection_events%ROWTYPE;
BEGIN
 SELECT * INTO previous FROM current_accepted_volume_parts WHERE tenant_id=NEW.tenant_id AND id=NEW.original_part_id;
 SELECT * INTO pinned FROM internal_inspections WHERE tenant_id=NEW.tenant_id AND accepted_part_id=NEW.original_part_id;
 SELECT * INTO prior FROM internal_inspection_events WHERE tenant_id=NEW.tenant_id AND accepted_part_id=NEW.original_part_id ORDER BY version DESC LIMIT 1;
 IF previous.id IS NULL OR previous.report_id<>NEW.report_id OR previous.quantity<>NEW.accepted_quantity+NEW.returned_quantity
  OR pinned.accepted_part_id IS NULL OR pinned.approver_user_id<>NEW.actor_user_id
  OR prior.to_state<>'awaiting_pto' OR prior.version<>NEW.inspection_version-1 THEN
  RAISE EXCEPTION 'invalid_inspection_split' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER internal_inspection_split_guard BEFORE INSERT ON internal_inspection_splits FOR EACH ROW EXECUTE FUNCTION validate_internal_inspection_split();
CREATE FUNCTION register_split_volume_parts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO internal_inspection_split_shares(tenant_id,id,split_id,report_id,role,quantity) VALUES
  (NEW.tenant_id,NEW.accepted_part_id,NEW.id,NEW.report_id,'accepted',NEW.accepted_quantity),
  (NEW.tenant_id,NEW.returned_part_id,NEW.id,NEW.report_id,'returned',NEW.returned_quantity);
 INSERT INTO accepted_volume_parts(tenant_id,id,report_id,quantity,split_share_id) VALUES
  (NEW.tenant_id,NEW.accepted_part_id,NEW.report_id,NEW.accepted_quantity,NEW.accepted_part_id),
  (NEW.tenant_id,NEW.returned_part_id,NEW.report_id,NEW.returned_quantity,NEW.returned_part_id);
 RETURN NEW;
END $$;
CREATE TRIGGER register_split_parts AFTER INSERT ON internal_inspection_splits FOR EACH ROW EXECUTE FUNCTION register_split_volume_parts();

ALTER TABLE internal_inspection_events DROP CONSTRAINT internal_inspection_actions;
ALTER TABLE internal_inspection_events DROP CONSTRAINT internal_inspection_transitions;
ALTER TABLE internal_inspection_events DROP CONSTRAINT internal_inspection_correction_reason;
ALTER TABLE internal_inspection_events ADD CONSTRAINT internal_inspection_actions CHECK(action IN('submit','resubmit','responsible','approve','return','partial','accepted_share','returned_share'));
ALTER TABLE internal_inspection_events ADD CONSTRAINT internal_inspection_transitions CHECK(
 (action='submit' AND version=1 AND from_state='not_submitted' AND to_state='awaiting_responsibility') OR
 (action='resubmit' AND version>=4 AND version%3=1 AND from_state='returned' AND to_state='awaiting_responsibility') OR
 (action='responsible' AND version%3=2 AND from_state='awaiting_responsibility' AND to_state='awaiting_pto') OR
 (action='approve' AND version%3=0 AND from_state='awaiting_pto' AND to_state='accepted') OR
 (action='return' AND version%3=0 AND from_state='awaiting_pto' AND to_state='returned') OR
 (action='partial' AND version%3=0 AND from_state='awaiting_pto' AND to_state='split') OR
 (action='accepted_share' AND version=3 AND from_state='awaiting_pto' AND to_state='accepted') OR
 (action='returned_share' AND version=3 AND from_state='awaiting_pto' AND to_state='returned'));
ALTER TABLE internal_inspection_events ADD CONSTRAINT internal_inspection_reason CHECK(action NOT IN('resubmit','partial','returned_share') OR(reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500));
CREATE OR REPLACE FUNCTION validate_internal_inspection_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior internal_inspection_events%ROWTYPE; pinned internal_inspections%ROWTYPE;
BEGIN
 SELECT * INTO pinned FROM internal_inspections WHERE tenant_id=NEW.tenant_id AND accepted_part_id=NEW.accepted_part_id;
 SELECT * INTO prior FROM internal_inspection_events WHERE tenant_id=NEW.tenant_id AND accepted_part_id=NEW.accepted_part_id ORDER BY version DESC LIMIT 1;
 IF NOT(prior.version IS NULL AND NEW.action IN('accepted_share','returned_share') AND NEW.version=3 AND NEW.from_state='awaiting_pto')
  AND(NEW.version<>coalesce(prior.version,0)+1 OR NEW.from_state<>coalesce(prior.to_state,'not_submitted')) THEN RAISE EXCEPTION 'inspection_sequence' USING ERRCODE='23514'; END IF;
 IF NEW.actor_user_id<>(CASE WHEN NEW.action IN('submit','resubmit') THEN pinned.preparer_user_id WHEN NEW.action='responsible' THEN pinned.responsible_user_id ELSE pinned.approver_user_id END) THEN RAISE EXCEPTION 'inspection_participant' USING ERRCODE='23514'; END IF;
 IF NEW.action='resubmit' AND NOT EXISTS(SELECT 1 FROM internal_inspection_attempts WHERE tenant_id=NEW.tenant_id AND accepted_part_id=NEW.accepted_part_id AND start_version=NEW.version AND actor_user_id=NEW.actor_user_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'inspection_attempt_missing' USING ERRCODE='23514'; END IF;
 IF NEW.action IN('accepted_share','returned_share') AND NOT EXISTS(SELECT 1 FROM internal_inspection_splits s WHERE s.tenant_id=NEW.tenant_id AND((NEW.action='accepted_share' AND s.accepted_part_id=NEW.accepted_part_id) OR(NEW.action='returned_share' AND s.returned_part_id=NEW.accepted_part_id))) THEN RAISE EXCEPTION 'inspection_share_missing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
