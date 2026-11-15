-- 015_daily_task_routes.sql is reserved by issue #108. This registry does not sign documents.
CREATE TABLE responsibility_orders (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  order_number text NOT NULL CHECK (char_length(order_number) BETWEEN 1 AND 80),
  order_date date NOT NULL,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  document_types text[] NOT NULL CHECK (cardinality(document_types) BETWEEN 1 AND 14),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  revocation_reason text CHECK (revocation_reason IS NULL OR char_length(revocation_reason) BETWEEN 1 AND 500),
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
  CHECK (valid_until >= valid_from),
  CHECK ((status = 'active' AND revocation_reason IS NULL) OR (status = 'revoked' AND revocation_reason IS NOT NULL))
);
CREATE INDEX responsibility_orders_lookup ON responsibility_orders (tenant_id, employee_id, project_id);
CREATE TABLE responsibility_order_revisions (
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('created', 'corrected', 'revoked')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id, version),
  FOREIGN KEY (tenant_id, order_id) REFERENCES responsibility_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES memberships (tenant_id, user_id)
);
ALTER TABLE responsibility_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsibility_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON responsibility_orders USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE responsibility_order_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsibility_order_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON responsibility_order_revisions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON responsibility_orders TO helios_app;
GRANT SELECT, INSERT ON responsibility_order_revisions TO helios_app;
