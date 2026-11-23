ALTER TABLE customer_submission_scans ADD COLUMN attempt_number integer;
UPDATE customer_submission_scans s SET attempt_number = (
  SELECT COALESCE(MAX(a.attempt_number) FILTER (WHERE a.created_at <= s.created_at), MIN(a.attempt_number))
  FROM customer_submission_attempts a
  WHERE a.tenant_id = s.tenant_id AND a.accepted_part_id = s.accepted_part_id
);
ALTER TABLE customer_submission_scans
  ALTER COLUMN attempt_number SET NOT NULL,
  ADD FOREIGN KEY (tenant_id, accepted_part_id, attempt_number)
    REFERENCES customer_submission_attempts (tenant_id, accepted_part_id, attempt_number);

CREATE TABLE customer_external_decisions (
  tenant_id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  project_id uuid NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  scan_id uuid NOT NULL,
  company_signer_employee_id uuid NOT NULL,
  company_signer_name text NOT NULL CHECK (length(btrim(company_signer_name)) BETWEEN 1 AND 200),
  customer_signer_name text NOT NULL CHECK (length(btrim(customer_signer_name)) BETWEEN 1 AND 200),
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, accepted_part_id, attempt_number),
  UNIQUE (tenant_id, actor_user_id, request_id),
  UNIQUE (tenant_id, scan_id),
  FOREIGN KEY (tenant_id, accepted_part_id, attempt_number)
    REFERENCES customer_submission_attempts (tenant_id, accepted_part_id, attempt_number),
  FOREIGN KEY (tenant_id, scan_id) REFERENCES customer_submission_scans (tenant_id, id),
  FOREIGN KEY (tenant_id, company_signer_employee_id) REFERENCES employees (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id)
    REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
ALTER TABLE customer_external_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_external_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_external_decisions
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON customer_external_decisions TO helios_app;
