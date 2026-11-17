-- Additional accepted parts consume only the remainder of one immutable source report.
CREATE TABLE volume_remainder_events (
 tenant_id uuid NOT NULL, report_id uuid NOT NULL, version integer NOT NULL CHECK(version>=2),
 id uuid NOT NULL, action text NOT NULL CHECK(action IN('present','review')),
 presentation_version integer, presented_quantity numeric(14,3) NOT NULL CHECK(presented_quantity>0),
 accepted_quantity numeric(14,3), reason text, checklist_run_id uuid NOT NULL,
 actor_user_id uuid NOT NULL, actor_name text NOT NULL, request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,report_id,version), UNIQUE(tenant_id,id), UNIQUE(tenant_id,actor_user_id,request_id),
 UNIQUE(tenant_id,id,report_id,accepted_quantity),
 FOREIGN KEY(tenant_id,report_id) REFERENCES master_volume_reviews(tenant_id,report_id),
 FOREIGN KEY(tenant_id,report_id,presentation_version) REFERENCES volume_remainder_events(tenant_id,report_id,version),
 FOREIGN KEY(tenant_id,checklist_run_id) REFERENCES checklist_runs(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id),
 CHECK((action='present' AND version%2=0 AND presentation_version IS NULL AND accepted_quantity IS NULL AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500)
 OR(action='review' AND version%2=1 AND presentation_version=version-1 AND accepted_quantity>=0 AND accepted_quantity<=presented_quantity AND (accepted_quantity=presented_quantity OR(reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500))))
);
ALTER TABLE volume_remainder_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_remainder_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON volume_remainder_events USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant());
GRANT SELECT,INSERT ON volume_remainder_events TO helios_app;
CREATE FUNCTION validate_volume_remainder() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original master_volume_reviews%ROWTYPE; prior volume_remainder_events%ROWTYPE; used numeric;
BEGIN
 PERFORM p.id FROM projects p JOIN managed_execution_reports s ON s.tenant_id=p.tenant_id AND s.project_id=p.id WHERE s.tenant_id=NEW.tenant_id AND s.report_id=NEW.report_id FOR NO KEY UPDATE OF p;
 SELECT * INTO original FROM master_volume_reviews WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id;
 SELECT * INTO prior FROM volume_remainder_events WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id ORDER BY version DESC LIMIT 1;
 SELECT coalesce(sum(accepted_quantity),0) INTO used FROM volume_remainder_events WHERE tenant_id=NEW.tenant_id AND report_id=NEW.report_id;
 IF original.id IS NULL OR NEW.version<>coalesce(prior.version,1)+1 OR (NEW.action='present' AND NEW.presented_quantity>original.difference_quantity-used) OR (NEW.action='review' AND (prior.action<>'present' OR NEW.presented_quantity<>prior.presented_quantity OR NEW.accepted_quantity>original.difference_quantity-used)) THEN RAISE EXCEPTION 'invalid_remainder_sequence_or_quantity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER volume_remainder_guard BEFORE INSERT ON volume_remainder_events FOR EACH ROW EXECUTE FUNCTION validate_volume_remainder();

-- Preserve the original accepted UUIDs; both kinds of parts have real FK-backed provenance.
ALTER TABLE master_volume_reviews ADD CONSTRAINT master_volume_review_part_source UNIQUE(tenant_id,id,report_id,accepted_quantity);
CREATE TABLE accepted_volume_parts (
 tenant_id uuid NOT NULL, id uuid NOT NULL, report_id uuid NOT NULL, quantity numeric(14,3) NOT NULL CHECK(quantity>0),
 master_review_id uuid, remainder_event_id uuid,
 PRIMARY KEY(tenant_id,id),
 CHECK((master_review_id IS NOT NULL AND remainder_event_id IS NULL AND id=master_review_id) OR(master_review_id IS NULL AND remainder_event_id IS NOT NULL AND id=remainder_event_id)),
 FOREIGN KEY(tenant_id,master_review_id,report_id,quantity) REFERENCES master_volume_reviews(tenant_id,id,report_id,accepted_quantity),
 FOREIGN KEY(tenant_id,remainder_event_id,report_id,quantity) REFERENCES volume_remainder_events(tenant_id,id,report_id,accepted_quantity)
);
ALTER TABLE accepted_volume_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accepted_volume_parts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accepted_volume_parts USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant());
GRANT SELECT,INSERT ON accepted_volume_parts TO helios_app;
INSERT INTO accepted_volume_parts(tenant_id,id,report_id,quantity,master_review_id) SELECT tenant_id,id,report_id,accepted_quantity,id FROM master_volume_reviews WHERE accepted_quantity>0;
CREATE FUNCTION register_accepted_volume_part() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.accepted_quantity>0 THEN
  IF TG_TABLE_NAME='master_volume_reviews' THEN
   INSERT INTO accepted_volume_parts(tenant_id,id,report_id,quantity,master_review_id) VALUES(NEW.tenant_id,NEW.id,NEW.report_id,NEW.accepted_quantity,NEW.id);
  ELSE
   INSERT INTO accepted_volume_parts(tenant_id,id,report_id,quantity,remainder_event_id) VALUES(NEW.tenant_id,NEW.id,NEW.report_id,NEW.accepted_quantity,NEW.id);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER register_master_part AFTER INSERT ON master_volume_reviews FOR EACH ROW EXECUTE FUNCTION register_accepted_volume_part();
CREATE TRIGGER register_remainder_part AFTER INSERT ON volume_remainder_events FOR EACH ROW EXECUTE FUNCTION register_accepted_volume_part();
ALTER TABLE internal_inspections DROP CONSTRAINT internal_inspections_tenant_id_accepted_part_id_fkey;
ALTER TABLE internal_inspections ADD CONSTRAINT internal_inspections_part_fkey FOREIGN KEY(tenant_id,accepted_part_id) REFERENCES accepted_volume_parts(tenant_id,id);
