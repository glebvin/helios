-- One versioned set of document titles for one work type.
-- Version 0 is not stored: the type has no set until the first insert.
CREATE TABLE id_set_versions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  work_type_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  titles jsonb NOT NULL CHECK (jsonb_typeof(titles) = 'array'),
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, work_type_id, version),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, project_id, work_type_id) REFERENCES project_work_types (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
ALTER TABLE id_set_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE id_set_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON id_set_versions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON id_set_versions TO helios_app;
