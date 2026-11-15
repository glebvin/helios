-- A saved run pins one approved edition. A later edition does not rewrite it.
-- A batch identifier is not a verified batch. The run does not accept volume.
CREATE TABLE checklist_runs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  template_id uuid NOT NULL,
  edition integer NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array'),
  verdict jsonb NOT NULL CHECK (jsonb_typeof(verdict) = 'object'),
  passed boolean NOT NULL,
  blocks_next boolean NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, task_id, version),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, project_id, task_id) REFERENCES daily_tasks (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, template_id, edition) REFERENCES checklist_template_editions (tenant_id, template_id, edition),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES memberships (tenant_id, user_id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
CREATE TABLE checklist_run_files (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  item_id text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 65536),
  sha256 text NOT NULL,
  bytes bytea NOT NULL,
  uploaded_by uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, uploaded_by, request_id),
  UNIQUE (tenant_id, task_id, item_id, sha256, uploaded_by),
  FOREIGN KEY (tenant_id, project_id, task_id) REFERENCES daily_tasks (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, uploaded_by) REFERENCES memberships (tenant_id, user_id),
  FOREIGN KEY (tenant_id, uploaded_by, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['checklist_runs', 'checklist_run_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON checklist_runs, checklist_run_files TO helios_app;
