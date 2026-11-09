CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Moscow',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('own', 'subcontractor', 'customer')),
  name text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('director', 'master', 'worker', 'pto')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS employees (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid,
  full_name text NOT NULL,
  phone text,
  document_number text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  UNIQUE (tenant_id, phone),
  UNIQUE (tenant_id, document_number)
);

CREATE TABLE IF NOT EXISTS projects (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS daily_tasks (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  title text NOT NULL,
  work_date date NOT NULL,
  planned_quantity numeric(14, 3) NOT NULL,
  unit text NOT NULL,
  assignee_employee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'published',
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, assignee_employee_id) REFERENCES employees (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS shifts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  occurred_started_at timestamptz,
  occurred_finished_at timestamptz,
  clock_requires_review boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finished')),
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES daily_tasks (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS work_reports (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  submitted_quantity numeric(14, 3) NOT NULL CHECK (submitted_quantity > 0),
  accepted_quantity numeric(14, 3),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES daily_tasks (tenant_id, id),
  CHECK (accepted_quantity IS NULL OR (accepted_quantity >= 0 AND accepted_quantity <= submitted_quantity))
);

CREATE TABLE IF NOT EXISTS client_events (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, event_id)
);

CREATE TABLE IF NOT EXISTS stored_files (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  object_key text NOT NULL,
  filename text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, object_key)
);

CREATE TABLE IF NOT EXISTS report_effects (
  tenant_id uuid NOT NULL,
  report_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, report_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id uuid,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_tasks_day ON daily_tasks (tenant_id, work_date, status);
CREATE INDEX IF NOT EXISTS shifts_employee ON shifts (tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS audit_tenant_time ON audit_log (tenant_id, created_at DESC);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_tenant())
  WITH CHECK (id = app_tenant());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'memberships', 'employees', 'projects', 'daily_tasks', 'shifts',
    'work_reports', 'client_events', 'stored_files', 'report_effects', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION memberships_for_login(p_user uuid)
RETURNS TABLE (tenant_id uuid, role text, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id, role, status FROM memberships WHERE user_id = p_user AND status = 'active'
$$;

REVOKE ALL ON FUNCTION memberships_for_login(uuid) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO helios_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helios_app;
GRANT EXECUTE ON FUNCTION app_tenant() TO helios_app;
GRANT EXECUTE ON FUNCTION memberships_for_login(uuid) TO helios_app;
