-- First external application for one current positive part. Remarks, scan and a later attempt stay out of this table.
CREATE TABLE customer_submissions (
  tenant_id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number = 1),
  checklist_run_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, accepted_part_id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, accepted_part_id) REFERENCES accepted_volume_parts (tenant_id, id),
  FOREIGN KEY (tenant_id, checklist_run_id) REFERENCES checklist_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES memberships (tenant_id, user_id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
ALTER TABLE customer_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_submissions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON customer_submissions TO helios_app;
