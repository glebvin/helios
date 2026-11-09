DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM employees e WHERE e.user_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM memberships m WHERE m.tenant_id=e.tenant_id AND m.user_id=e.user_id)) THEN
    RAISE EXCEPTION '003: existing employees contain linked users without same-tenant membership';
  END IF;
END $$;
ALTER TABLE employees ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'));
ALTER TABLE employees ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE employees ADD FOREIGN KEY (tenant_id,user_id) REFERENCES memberships(tenant_id,user_id);
ALTER TABLE memberships ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE project_memberships ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE employee_project_assignments ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE employee_project_assignments ADD COLUMN admission_check_id uuid;
ALTER TABLE audit_log ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE employee_qualifications (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  document_reference text,
  valid_until date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES employees(tenant_id,id)
);
CREATE UNIQUE INDEX qualification_active_code ON employee_qualifications(tenant_id,employee_id,code) WHERE status='active';
CREATE INDEX qualification_employee ON employee_qualifications(tenant_id,employee_id,id);
CREATE TABLE people_command_receipts (
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  operation text NOT NULL,
  command_hash text NOT NULL,
  status integer,
  result jsonb,
  PRIMARY KEY (tenant_id,actor_user_id,request_id),
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES memberships(tenant_id,user_id),
  CHECK ((status IS NULL AND result IS NULL) OR (status IN (200,201) AND result IS NOT NULL))
);
ALTER TABLE employee_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_qualifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_qualifications USING (tenant_id=app_tenant()) WITH CHECK (tenant_id=app_tenant());
ALTER TABLE people_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_command_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON people_command_receipts USING (tenant_id=app_tenant()) WITH CHECK (tenant_id=app_tenant());
GRANT SELECT,INSERT,UPDATE ON employee_qualifications TO helios_app;
GRANT SELECT,INSERT ON people_command_receipts TO helios_app;
GRANT UPDATE(status,result) ON people_command_receipts TO helios_app;
