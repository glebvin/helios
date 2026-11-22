CREATE TABLE customer_remark_tasks (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  remark_id uuid NOT NULL,
  project_id uuid NOT NULL,
  assignee_employee_id uuid NOT NULL,
  due_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, remark_id),
  FOREIGN KEY (tenant_id, remark_id) REFERENCES customer_submission_remarks (tenant_id, id),
  FOREIGN KEY (tenant_id, assignee_employee_id) REFERENCES employees (tenant_id, id)
);
INSERT INTO customer_remark_tasks (tenant_id, id, remark_id, project_id, assignee_employee_id, due_on, created_at)
SELECT tenant_id, gen_random_uuid(), id, project_id, responsible_employee_id, due_on, created_at FROM customer_submission_remarks;
ALTER TABLE customer_remark_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_remark_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_remark_tasks USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON customer_remark_tasks TO helios_app;
