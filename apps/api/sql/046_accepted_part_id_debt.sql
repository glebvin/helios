-- One document debt for one accepted part, taken from the set version
-- that was current when the external decision was first recorded.
CREATE TABLE accepted_part_id_debts (
  tenant_id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  project_id uuid NOT NULL,
  work_type_id uuid NOT NULL,
  set_version integer NOT NULL CHECK (set_version > 0),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  titles jsonb NOT NULL CHECK (jsonb_typeof(titles) = 'array' AND jsonb_array_length(titles) > 0),
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, accepted_part_id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, accepted_part_id, attempt_number)
    REFERENCES customer_external_decisions (tenant_id, accepted_part_id, attempt_number),
  FOREIGN KEY (tenant_id, project_id, work_type_id, set_version)
    REFERENCES id_set_versions (tenant_id, project_id, work_type_id, version),
  FOREIGN KEY (tenant_id, actor_user_id, request_id)
    REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
ALTER TABLE accepted_part_id_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accepted_part_id_debts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accepted_part_id_debts
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON accepted_part_id_debts TO helios_app;
