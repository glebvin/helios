CREATE UNIQUE INDEX users_email_normalized ON users (lower(email));

CREATE TABLE invitations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('worker','master')),
  code text NOT NULL UNIQUE,
  issued_by uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  revoked_at timestamptz,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES users(id),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,issued_by,request_id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,organization_id) REFERENCES organizations(tenant_id,id),
  FOREIGN KEY (tenant_id,issued_by) REFERENCES memberships(tenant_id,user_id),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations USING (tenant_id=app_tenant()) WITH CHECK (tenant_id=app_tenant());
GRANT SELECT,INSERT,UPDATE ON invitations TO helios_app;
CREATE INDEX invitations_project ON invitations(tenant_id,project_id,created_at DESC);

-- Public discovery reveals only the tenant for a cryptographically random bearer code.
-- No users, names, passwords or plaintext codes are stored in this global locator.
CREATE TABLE invitation_locator (
  code_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  FOREIGN KEY (tenant_id,invitation_id) REFERENCES invitations(tenant_id,id)
);
REVOKE ALL ON invitation_locator FROM PUBLIC,helios_app;
GRANT INSERT ON invitation_locator TO helios_app;
CREATE FUNCTION invitation_tenant(text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT tenant_id FROM public.invitation_locator WHERE code_hash=$1
$$;
REVOKE ALL ON FUNCTION invitation_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_tenant(text) TO helios_app;
