CREATE TABLE time_approval_revisions (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, employee_id uuid NOT NULL, day date NOT NULL,
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991), previous_version bigint,
 state text NOT NULL CHECK(state IN ('approved','revoked')),
 source jsonb NOT NULL, source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 source_totals jsonb NOT NULL, confirmed_totals jsonb NOT NULL, overridden boolean NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500), acknowledged_suspicious boolean NOT NULL,
 actor_user_id uuid NOT NULL, request_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,project_id,employee_id,day,version),
 UNIQUE(tenant_id,actor_user_id,request_id),
 CHECK((version=1 AND previous_version IS NULL AND state='approved') OR (version>1 AND previous_version=version-1)),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id),
 FOREIGN KEY(tenant_id,project_id,employee_id,day,previous_version) REFERENCES time_approval_revisions(tenant_id,project_id,employee_id,day,version)
);
CREATE TABLE time_approval_heads (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, employee_id uuid NOT NULL, day date NOT NULL,
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(tenant_id,project_id,employee_id,day),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id,employee_id,day,version) REFERENCES time_approval_revisions(tenant_id,project_id,employee_id,day,version) DEFERRABLE INITIALLY DEFERRED
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['time_approval_heads','time_approval_revisions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant())',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO helios_app',t);
 END LOOP;
END $$;
GRANT UPDATE(version) ON time_approval_heads TO helios_app;
