CREATE TABLE front_templates (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  PRIMARY KEY(tenant_id,project_id),
  UNIQUE(tenant_id,project_id,code),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE front_template_versions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  snapshot jsonb NOT NULL,
  PRIMARY KEY(tenant_id,project_id,version),
  FOREIGN KEY(tenant_id,project_id,code) REFERENCES front_templates(tenant_id,project_id,code)
);
CREATE TABLE task_front_checks (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  id uuid NOT NULL,
  template_version integer NOT NULL,
  sequence integer NOT NULL CHECK(sequence>0),
  snapshot jsonb NOT NULL,
  PRIMARY KEY(tenant_id,project_id,task_id,id),
  UNIQUE(tenant_id,project_id,task_id,sequence),
  FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES daily_tasks(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,project_id,template_version) REFERENCES front_template_versions(tenant_id,project_id,version)
);
CREATE TABLE task_publication_snapshots (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  id uuid NOT NULL,
  front_check_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY(tenant_id,project_id,task_id,id),
  UNIQUE(tenant_id,project_id,task_id),
  FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES daily_tasks(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,project_id,task_id,front_check_id) REFERENCES task_front_checks(tenant_id,project_id,task_id,id)
);
ALTER TABLE daily_tasks ADD COLUMN publication_snapshot_id uuid;
ALTER TABLE daily_tasks ADD FOREIGN KEY(tenant_id,project_id,id,publication_snapshot_id) REFERENCES task_publication_snapshots(tenant_id,project_id,task_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE daily_tasks ADD CONSTRAINT managed_publication_reference CHECK(workflow_kind<>'managed02b' OR status<>'published' OR publication_snapshot_id IS NOT NULL);
CREATE FUNCTION protect_published_task_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.publication_snapshot_id IS NOT NULL AND (
    (to_jsonb(NEW)-ARRAY['status','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version'])
    OR NEW.status NOT IN ('published','cancelled')
  ) THEN RAISE EXCEPTION 'published plan is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.publication_snapshot_id IS NULL AND NEW.publication_snapshot_id IS NOT NULL AND NEW.status<>'published' THEN
    RAISE EXCEPTION 'publication reference requires published state' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER published_task_plan_immutable BEFORE UPDATE ON daily_tasks FOR EACH ROW EXECUTE FUNCTION protect_published_task_plan();
CREATE INDEX task_front_latest ON task_front_checks(tenant_id,project_id,task_id,sequence DESC);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['front_templates','front_template_versions','task_front_checks','task_publication_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant())',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO helios_app',t);
  END LOOP;
END $$;
GRANT UPDATE(version) ON front_templates TO helios_app;
