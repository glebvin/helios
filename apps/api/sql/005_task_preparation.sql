CREATE TABLE project_work_zones (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  PRIMARY KEY (tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE project_work_types (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 40),
  requires_rd boolean NOT NULL,
  requires_material_control boolean NOT NULL,
  requires_predecessor_acceptance boolean NOT NULL,
  requires_id boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  PRIMARY KEY (tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
ALTER TABLE daily_tasks ADD COLUMN workflow_kind text NOT NULL DEFAULT 'legacy' CHECK (workflow_kind IN ('legacy','managed02b'));
ALTER TABLE daily_tasks ADD COLUMN zone_id uuid;
ALTER TABLE daily_tasks ADD COLUMN work_type_id uuid;
ALTER TABLE daily_tasks ADD COLUMN responsible_user_id uuid;
ALTER TABLE daily_tasks ADD COLUMN rd_reference text;
ALTER TABLE daily_tasks ADD COLUMN planned_start timestamptz;
ALTER TABLE daily_tasks ADD COLUMN planned_end timestamptz;
ALTER TABLE daily_tasks ADD COLUMN plan_revision integer;
ALTER TABLE daily_tasks ADD CONSTRAINT daily_tasks_project_id UNIQUE(tenant_id,project_id,id);
ALTER TABLE daily_tasks ADD FOREIGN KEY(tenant_id,project_id,zone_id) REFERENCES project_work_zones(tenant_id,project_id,id);
ALTER TABLE daily_tasks ADD FOREIGN KEY(tenant_id,project_id,work_type_id) REFERENCES project_work_types(tenant_id,project_id,id);
ALTER TABLE daily_tasks ADD FOREIGN KEY(tenant_id,responsible_user_id) REFERENCES memberships(tenant_id,user_id);
ALTER TABLE daily_tasks ADD CONSTRAINT managed_task_plan CHECK (workflow_kind='legacy' OR (
  zone_id IS NOT NULL AND work_type_id IS NOT NULL AND responsible_user_id IS NOT NULL
  AND planned_start IS NOT NULL AND planned_end IS NOT NULL AND planned_start < planned_end
  AND plan_revision IS NOT NULL AND plan_revision > 0 AND version > 0
  AND length(btrim(title)) BETWEEN 1 AND 200 AND length(btrim(unit)) BETWEEN 1 AND 40
  AND planned_quantity > 0 AND work_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  AND (rd_reference IS NULL OR length(btrim(rd_reference)) BETWEEN 1 AND 500)
  AND status IN ('draft','pending_approval','published','cancelled')
));
CREATE FUNCTION protect_task_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workflow_kind IS DISTINCT FROM OLD.workflow_kind THEN
    RAISE EXCEPTION 'task workflow lineage is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_workflow_immutable BEFORE UPDATE ON daily_tasks FOR EACH ROW EXECUTE FUNCTION protect_task_workflow();
REVOKE DELETE ON daily_tasks FROM helios_app;
CREATE INDEX daily_tasks_project_plan ON daily_tasks(tenant_id,project_id,work_date,status,id);
CREATE INDEX daily_tasks_managed_overlap ON daily_tasks(tenant_id,assignee_employee_id,planned_start,planned_end)
  WHERE workflow_kind='managed02b' AND status='published';
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['project_work_zones','project_work_types'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant())',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO helios_app',t);
  END LOOP;
END $$;
