CREATE TABLE admission_templates (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  PRIMARY KEY(tenant_id,project_id),
  UNIQUE(tenant_id,project_id,code),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE admission_template_versions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  snapshot jsonb NOT NULL,
  PRIMARY KEY(tenant_id,project_id,version),
  FOREIGN KEY(tenant_id,project_id,code) REFERENCES admission_templates(tenant_id,project_id,code)
);
CREATE TABLE employee_admission_checks (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  project_id uuid NOT NULL,
  template_version integer NOT NULL,
  sequence integer NOT NULL CHECK(sequence>0),
  snapshot jsonb NOT NULL,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,employee_id,sequence),
  UNIQUE(tenant_id,project_id,employee_id,id),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
  FOREIGN KEY(tenant_id,project_id,template_version) REFERENCES admission_template_versions(tenant_id,project_id,version)
);
CREATE INDEX admission_check_latest ON employee_admission_checks(tenant_id,project_id,employee_id,sequence DESC);
ALTER TABLE employee_project_assignments ADD FOREIGN KEY(tenant_id,project_id,employee_id,admission_check_id)
  REFERENCES employee_admission_checks(tenant_id,project_id,employee_id,id);
CREATE TABLE crews (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE crew_members (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  crew_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN ('active','revoked')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  PRIMARY KEY(tenant_id,crew_id,employee_id),
  FOREIGN KEY(tenant_id,project_id,crew_id) REFERENCES crews(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,project_id,employee_id) REFERENCES employee_project_assignments(tenant_id,project_id,employee_id)
);
CREATE UNIQUE INDEX crew_member_one_active ON crew_members(tenant_id,project_id,employee_id) WHERE status='active';
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['admission_templates','admission_template_versions','employee_admission_checks','crews','crew_members'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant())',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON admission_templates,crews,crew_members TO helios_app;
GRANT SELECT,INSERT ON admission_template_versions,employee_admission_checks TO helios_app;
