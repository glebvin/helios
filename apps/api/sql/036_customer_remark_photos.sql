CREATE TABLE customer_remark_photos (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  remark_id uuid NOT NULL,
  project_id uuid NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256 text NOT NULL,
  bytes bytea NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  UNIQUE (tenant_id, remark_id, sha256),
  FOREIGN KEY (tenant_id, remark_id) REFERENCES customer_submission_remarks (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
ALTER TABLE customer_remark_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_remark_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_remark_photos USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON customer_remark_photos TO helios_app;
