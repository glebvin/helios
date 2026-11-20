-- A correction replaces one physical part; prior quantities and approvals remain historical.
CREATE TABLE volume_corrections (
 tenant_id uuid NOT NULL, report_id uuid NOT NULL, id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=2), previous_part_id uuid NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK(quantity>=0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500), checklist_run_id uuid NOT NULL,
 actor_user_id uuid NOT NULL, actor_name text NOT NULL, request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,report_id,version), UNIQUE(tenant_id,previous_part_id),
 UNIQUE(tenant_id,id,report_id,quantity), UNIQUE(tenant_id,actor_user_id,request_id),
 FOREIGN KEY(tenant_id,report_id) REFERENCES master_volume_reviews(tenant_id,report_id),
 FOREIGN KEY(tenant_id,previous_part_id) REFERENCES accepted_volume_parts(tenant_id,id),
 FOREIGN KEY(tenant_id,checklist_run_id) REFERENCES checklist_runs(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id)
);
ALTER TABLE volume_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON volume_corrections USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant());
GRANT SELECT,INSERT ON volume_corrections TO helios_app;

ALTER TABLE accepted_volume_parts ADD COLUMN correction_id uuid;
ALTER TABLE accepted_volume_parts DROP CONSTRAINT accepted_volume_parts_check;
ALTER TABLE accepted_volume_parts ADD CONSTRAINT accepted_part_provenance CHECK(
 (master_review_id IS NOT NULL AND remainder_event_id IS NULL AND correction_id IS NULL AND id=master_review_id)
 OR(master_review_id IS NULL AND remainder_event_id IS NOT NULL AND correction_id IS NULL AND id=remainder_event_id)
 OR(master_review_id IS NULL AND remainder_event_id IS NULL AND correction_id IS NOT NULL AND id=correction_id));
ALTER TABLE accepted_volume_parts ADD CONSTRAINT accepted_part_correction_source FOREIGN KEY(tenant_id,correction_id,report_id,quantity) REFERENCES volume_corrections(tenant_id,id,report_id,quantity);
CREATE VIEW current_accepted_volume_parts WITH(security_invoker=true) AS
 SELECT p.* FROM accepted_volume_parts p WHERE NOT EXISTS(SELECT 1 FROM volume_corrections c WHERE c.tenant_id=p.tenant_id AND c.previous_part_id=p.id);
GRANT SELECT ON current_accepted_volume_parts TO helios_app;

CREATE FUNCTION validate_volume_correction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original master_volume_reviews%ROWTYPE; previous accepted_volume_parts%ROWTYPE; used numeric; revision integer; pending text;
BEGIN
 PERFORM p.id FROM projects p JOIN managed_execution_reports s ON s.tenant_id=p.tenant_id AND s.project_id=p.id WHERE s.tenant_id=NEW.tenant_id AND s.report_id=NEW.report_id FOR NO KEY UPDATE OF p;
 SELECT * INTO original FROM master_volume_reviews WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id;
 SELECT * INTO previous FROM current_accepted_volume_parts WHERE tenant_id=NEW.tenant_id AND id=NEW.previous_part_id;
 SELECT coalesce(sum(quantity),0) INTO used FROM current_accepted_volume_parts WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id AND id<>NEW.previous_part_id;
 SELECT 2+(SELECT count(*) FROM volume_remainder_events WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id)+(SELECT count(*) FROM volume_corrections WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id) INTO revision;
 SELECT action INTO pending FROM volume_remainder_events WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id ORDER BY version DESC LIMIT 1;
 IF original.id IS NULL OR previous.id IS NULL OR previous.report_id<>NEW.report_id OR NEW.version<>revision OR pending='present' OR NEW.quantity='NaN'::numeric OR NEW.quantity=previous.quantity OR NEW.quantity>original.submitted_quantity-used THEN
  RAISE EXCEPTION 'invalid_volume_correction' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER volume_correction_guard BEFORE INSERT ON volume_corrections FOR EACH ROW EXECUTE FUNCTION validate_volume_correction();
CREATE FUNCTION register_corrected_volume_part() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.quantity>0 THEN INSERT INTO accepted_volume_parts(tenant_id,id,report_id,quantity,correction_id) VALUES(NEW.tenant_id,NEW.id,NEW.report_id,NEW.quantity,NEW.id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER register_corrected_part AFTER INSERT ON volume_corrections FOR EACH ROW EXECUTE FUNCTION register_corrected_volume_part();

-- Existing remainder commands retain their own alternating sequence and UUIDs.
CREATE OR REPLACE FUNCTION validate_volume_remainder() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original master_volume_reviews%ROWTYPE; prior volume_remainder_events%ROWTYPE; used numeric;
BEGIN
 PERFORM p.id FROM projects p JOIN managed_execution_reports s ON s.tenant_id=p.tenant_id AND s.project_id=p.id WHERE s.tenant_id=NEW.tenant_id AND s.report_id=NEW.report_id FOR NO KEY UPDATE OF p;
 SELECT * INTO original FROM master_volume_reviews WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id;
 SELECT * INTO prior FROM volume_remainder_events WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id ORDER BY version DESC LIMIT 1;
 SELECT coalesce(sum(quantity),0) INTO used FROM current_accepted_volume_parts WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id;
 IF original.id IS NULL OR NEW.version<>coalesce(prior.version,1)+1 OR (NEW.action='present' AND NEW.presented_quantity>original.submitted_quantity-used) OR (NEW.action='review' AND (prior.action<>'present' OR NEW.presented_quantity<>prior.presented_quantity OR NEW.accepted_quantity>original.submitted_quantity-used)) THEN RAISE EXCEPTION 'invalid_remainder_sequence_or_quantity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
