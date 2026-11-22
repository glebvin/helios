-- One safety agreement per admission check. The check itself stays the master's recorded attempt.
CREATE TABLE admission_safety_reviews (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  check_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, check_id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, project_id, employee_id, check_id) REFERENCES employee_admission_checks (tenant_id, project_id, employee_id, id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
ALTER TABLE admission_safety_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_safety_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admission_safety_reviews USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON admission_safety_reviews TO helios_app;
