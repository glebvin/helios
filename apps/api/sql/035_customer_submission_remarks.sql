ALTER TABLE customer_submissions DROP CONSTRAINT customer_submissions_attempt_number_check;
ALTER TABLE customer_submissions ADD CONSTRAINT customer_submissions_attempt_number_check CHECK (attempt_number >= 1);

CREATE TABLE customer_submission_attempts (
  tenant_id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  checklist_run_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, accepted_part_id, attempt_number),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, accepted_part_id) REFERENCES customer_submissions (tenant_id, accepted_part_id),
  FOREIGN KEY (tenant_id, checklist_run_id) REFERENCES checklist_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
INSERT INTO customer_submission_attempts (tenant_id, accepted_part_id, attempt_number, checklist_run_id, actor_user_id, request_id, created_at)
SELECT tenant_id, accepted_part_id, attempt_number, checklist_run_id, actor_user_id, request_id, created_at FROM customer_submissions;

CREATE TABLE customer_submission_remarks (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  project_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
  responsible_employee_id uuid NOT NULL,
  due_on date NOT NULL,
  closed_at timestamptz,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, accepted_part_id) REFERENCES customer_submissions (tenant_id, accepted_part_id),
  FOREIGN KEY (tenant_id, responsible_employee_id) REFERENCES employees (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
ALTER TABLE customer_submission_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_submission_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_submission_remarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_submission_remarks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_submission_attempts USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY tenant_isolation ON customer_submission_remarks USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT UPDATE ON customer_submissions TO helios_app;
GRANT SELECT, INSERT ON customer_submission_attempts TO helios_app;
GRANT SELECT, INSERT, UPDATE ON customer_submission_remarks TO helios_app;
