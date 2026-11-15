-- Primary day is one civil day of one project and one employer.
-- The master's close stores an immutable source snapshot, author, time and version 1.
-- HR issues a consolidated revision from those frozen hashes. A later revision copies
-- the previous hashes and records one accepted correction; it does not rewrite them.
-- A late fact stays in the execution history and is only a discrepancy against the snapshot.
CREATE TABLE primary_day_closes (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, organization_id uuid NOT NULL, day date NOT NULL,
  version bigint NOT NULL CHECK (version = 1),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL,
  actor_user_id uuid NOT NULL, request_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, organization_id, day),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
CREATE TABLE time_corrections (
  tenant_id uuid NOT NULL, id uuid NOT NULL,
  project_id uuid NOT NULL, organization_id uuid NOT NULL, day date NOT NULL,
  corrects_version bigint NOT NULL CHECK (corrects_version = 1),
  corrects_hash text NOT NULL CHECK (corrects_hash ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  actor_user_id uuid NOT NULL, request_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, project_id, organization_id, day) REFERENCES primary_day_closes (tenant_id, project_id, organization_id, day),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id)
);
CREATE TABLE consolidated_time_revisions (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, day date NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  previous_revision bigint,
  closes jsonb NOT NULL,
  correction_id uuid,
  actor_user_id uuid NOT NULL, request_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, day, revision),
  UNIQUE (tenant_id, actor_user_id, request_id),
  UNIQUE (tenant_id, correction_id),
  CHECK ((revision = 1 AND previous_revision IS NULL AND correction_id IS NULL) OR (revision > 1 AND previous_revision = revision - 1 AND correction_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, correction_id) REFERENCES time_corrections (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, project_id, day, previous_revision) REFERENCES consolidated_time_revisions (tenant_id, project_id, day, revision)
);
CREATE TABLE consolidated_time_heads (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, day date NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (tenant_id, project_id, day),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id, day, revision) REFERENCES consolidated_time_revisions (tenant_id, project_id, day, revision) DEFERRABLE INITIALLY DEFERRED
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['primary_day_closes','time_corrections','consolidated_time_revisions','consolidated_time_heads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO helios_app', t);
  END LOOP;
END $$;
GRANT UPDATE (revision) ON consolidated_time_heads TO helios_app;
