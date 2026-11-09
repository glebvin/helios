ALTER TABLE managed_execution_reports ADD CONSTRAINT managed_report_evidence_scope UNIQUE(tenant_id,project_id,employee_id,report_id);
CREATE TABLE private_evidence_files (
 tenant_id uuid NOT NULL, id uuid NOT NULL, project_id uuid NOT NULL, employee_id uuid NOT NULL,
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
 content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png','application/pdf')),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 reserved_by uuid NOT NULL, reserved_at timestamptz NOT NULL DEFAULT now(), on_behalf_reason text,
 ready_by uuid, ready_at timestamptz,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,project_id,employee_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
 FOREIGN KEY(tenant_id,reserved_by) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,ready_by) REFERENCES memberships(tenant_id,user_id),
 CHECK((state='pending' AND ready_by IS NULL AND ready_at IS NULL) OR (state='ready' AND ready_by IS NOT NULL AND ready_at IS NOT NULL))
);
CREATE TABLE private_evidence_attachments (
 tenant_id uuid NOT NULL, file_id uuid NOT NULL, project_id uuid NOT NULL, employee_id uuid NOT NULL,
 target_kind text NOT NULL, shift_id uuid, event_actor_user_id uuid, event_request_id uuid, report_id uuid,
 attached_by uuid NOT NULL, attached_at timestamptz NOT NULL DEFAULT now(), on_behalf_reason text,
 PRIMARY KEY(tenant_id,file_id),
 FOREIGN KEY(tenant_id,project_id,employee_id,file_id) REFERENCES private_evidence_files(tenant_id,project_id,employee_id,id),
 FOREIGN KEY(tenant_id,project_id,employee_id,shift_id,event_actor_user_id,event_request_id) REFERENCES managed_execution_events(tenant_id,project_id,employee_id,shift_id,actor_user_id,request_id),
 FOREIGN KEY(tenant_id,project_id,employee_id,report_id) REFERENCES managed_execution_reports(tenant_id,project_id,employee_id,report_id),
 FOREIGN KEY(tenant_id,attached_by) REFERENCES memberships(tenant_id,user_id),
 CHECK((target_kind='execution_event' AND shift_id IS NOT NULL AND event_actor_user_id IS NOT NULL AND event_request_id IS NOT NULL AND report_id IS NULL) OR (target_kind='final_report' AND shift_id IS NULL AND event_actor_user_id IS NULL AND event_request_id IS NULL AND report_id IS NOT NULL))
);
CREATE INDEX private_evidence_project_employee ON private_evidence_files(tenant_id,project_id,employee_id,reserved_at,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['private_evidence_files','private_evidence_attachments'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant())',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO helios_app',t);
 END LOOP;
END $$;
GRANT UPDATE(state,ready_by,ready_at) ON private_evidence_files TO helios_app;
CREATE FUNCTION private_evidence_ready_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state='ready' AND ROW(NEW.state,NEW.ready_by,NEW.ready_at) IS DISTINCT FROM ROW(OLD.state,OLD.ready_by,OLD.ready_at) THEN RAISE EXCEPTION 'ready evidence immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER private_evidence_ready_immutable BEFORE UPDATE ON private_evidence_files FOR EACH ROW EXECUTE FUNCTION private_evidence_ready_immutable();
