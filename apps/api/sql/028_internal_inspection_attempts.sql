-- A new attempt continues the same immutable part and originally pinned participants.
CREATE TABLE internal_inspection_attempts (
  tenant_id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  start_version integer NOT NULL CHECK(start_version>=4 AND start_version%3=1),
  previous_return_version integer NOT NULL CHECK(previous_return_version=start_version-1),
  checklist_run_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,accepted_part_id,start_version),
  UNIQUE(tenant_id,actor_user_id,request_id),
  FOREIGN KEY(tenant_id,accepted_part_id) REFERENCES internal_inspections(tenant_id,accepted_part_id),
  FOREIGN KEY(tenant_id,checklist_run_id) REFERENCES checklist_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id)
);
ALTER TABLE internal_inspection_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_inspection_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON internal_inspection_attempts USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant());
GRANT SELECT,INSERT ON internal_inspection_attempts TO helios_app;
ALTER TABLE internal_inspection_events DROP CONSTRAINT internal_inspection_events_action_check;
ALTER TABLE internal_inspection_events DROP CONSTRAINT internal_inspection_events_check;
ALTER TABLE internal_inspection_events ADD CONSTRAINT internal_inspection_actions CHECK(action IN('submit','resubmit','responsible','approve','return'));
ALTER TABLE internal_inspection_events ADD CONSTRAINT internal_inspection_transitions CHECK(
 (action='submit' AND version=1 AND from_state='not_submitted' AND to_state='awaiting_responsibility') OR
 (action='resubmit' AND version>=4 AND version%3=1 AND from_state='returned' AND to_state='awaiting_responsibility') OR
 (action='responsible' AND version%3=2 AND from_state='awaiting_responsibility' AND to_state='awaiting_pto') OR
 (action='approve' AND version%3=0 AND from_state='awaiting_pto' AND to_state='accepted') OR
 (action='return' AND version%3=0 AND from_state='awaiting_pto' AND to_state='returned'));
ALTER TABLE internal_inspection_events ADD CONSTRAINT internal_inspection_correction_reason CHECK(action<>'resubmit' OR(reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500));
CREATE FUNCTION validate_internal_inspection_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior internal_inspection_events%ROWTYPE; pinned internal_inspections%ROWTYPE;
BEGIN
 SELECT * INTO pinned FROM internal_inspections WHERE tenant_id=NEW.tenant_id AND accepted_part_id=NEW.accepted_part_id;
 SELECT * INTO prior FROM internal_inspection_events WHERE tenant_id=NEW.tenant_id AND accepted_part_id=NEW.accepted_part_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(prior.version,0)+1 OR NEW.from_state<>coalesce(prior.to_state,'not_submitted') THEN RAISE EXCEPTION 'inspection_sequence' USING ERRCODE='23514'; END IF;
 IF NEW.actor_user_id<>(CASE WHEN NEW.action IN('submit','resubmit') THEN pinned.preparer_user_id WHEN NEW.action='responsible' THEN pinned.responsible_user_id ELSE pinned.approver_user_id END) THEN RAISE EXCEPTION 'inspection_participant' USING ERRCODE='23514'; END IF;
 IF NEW.action='resubmit' AND NOT EXISTS(SELECT 1 FROM internal_inspection_attempts WHERE tenant_id=NEW.tenant_id AND accepted_part_id=NEW.accepted_part_id AND start_version=NEW.version AND actor_user_id=NEW.actor_user_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'inspection_attempt_missing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER internal_inspection_event_guard BEFORE INSERT ON internal_inspection_events FOR EACH ROW EXECUTE FUNCTION validate_internal_inspection_event();
