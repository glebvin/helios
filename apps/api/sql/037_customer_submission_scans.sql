CREATE TABLE customer_submission_scans (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  project_id uuid NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL CHECK (content_type = 'application/pdf'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256 text NOT NULL,
  bytes bytea NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  UNIQUE (tenant_id, accepted_part_id, sha256),
  FOREIGN KEY (tenant_id, accepted_part_id) REFERENCES customer_submissions (tenant_id, accepted_part_id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
ALTER TABLE customer_submission_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_submission_scans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_submission_scans USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON customer_submission_scans TO helios_app;
