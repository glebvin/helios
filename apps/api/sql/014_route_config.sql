-- Immutable configuration snapshots. Applying a new configuration does not run documents.
CREATE TABLE route_config_versions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  schema_version integer NOT NULL CHECK (schema_version=1),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration)='object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,project_id,version),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id)
);
ALTER TABLE route_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_config_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON route_config_versions USING (tenant_id=app_tenant()) WITH CHECK (tenant_id=app_tenant());
GRANT SELECT,INSERT ON route_config_versions TO helios_app;
