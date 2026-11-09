CREATE TABLE project_memberships (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (tenant_id, project_id, user_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id)
);

CREATE TABLE employee_project_assignments (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (tenant_id, project_id, employee_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);

CREATE INDEX project_memberships_user ON project_memberships (tenant_id, user_id, status);
CREATE INDEX employee_assignments_employee ON employee_project_assignments (tenant_id, employee_id, status);

INSERT INTO employee_project_assignments (tenant_id, project_id, employee_id)
SELECT DISTINCT tenant_id, project_id, assignee_employee_id FROM daily_tasks;

ALTER TABLE project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_memberships
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE employee_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_project_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_project_assignments
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON project_memberships, employee_project_assignments TO helios_app;
