ALTER TABLE daily_tasks ADD CONSTRAINT daily_tasks_execution_assignee UNIQUE(tenant_id,project_id,id,assignee_employee_id);
CREATE TABLE managed_execution_streams (
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),
  last_interval_at timestamptz,
  PRIMARY KEY(tenant_id,employee_id),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id)
);
CREATE TABLE managed_shifts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz CHECK(ended_at>=started_at),
  PRIMARY KEY(tenant_id,project_id,employee_id,id),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES managed_execution_streams(tenant_id,employee_id)
);
CREATE UNIQUE INDEX managed_one_open_shift ON managed_shifts(tenant_id,employee_id) WHERE ended_at IS NULL;
CREATE TABLE managed_segments (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  id uuid NOT NULL,
  mode text NOT NULL CHECK(mode IN ('idle','work','break','downtime')),
  task_id uuid,
  reason_code text,
  comment text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz CHECK(ended_at>=started_at),
  PRIMARY KEY(tenant_id,project_id,employee_id,shift_id,id),
  FOREIGN KEY(tenant_id,project_id,employee_id,shift_id) REFERENCES managed_shifts(tenant_id,project_id,employee_id,id),
  FOREIGN KEY(tenant_id,project_id,task_id,employee_id) REFERENCES daily_tasks(tenant_id,project_id,id,assignee_employee_id),
  CHECK((mode='work' AND task_id IS NOT NULL) OR mode='downtime' OR (mode IN ('idle','break') AND task_id IS NULL)),
  CHECK((mode='downtime' AND reason_code IS NOT NULL AND reason_code IN ('materials','equipment','front','safety','weather','other') AND comment IS NOT NULL AND length(btrim(comment)) BETWEEN 1 AND 500) OR (mode<>'downtime' AND reason_code IS NULL AND comment IS NULL))
);
CREATE UNIQUE INDEX managed_one_open_segment ON managed_segments(tenant_id,project_id,employee_id,shift_id) WHERE ended_at IS NULL;
CREATE TABLE managed_execution_events (
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  project_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('shift_start','segment_change','shift_end','submit_volume')),
  version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  original_payload jsonb NOT NULL,
  command_hash text NOT NULL CHECK(length(command_hash)=64),
  review_flags jsonb NOT NULL,
  PRIMARY KEY(tenant_id,actor_user_id,request_id),
  UNIQUE(tenant_id,employee_id,version),
  UNIQUE(tenant_id,project_id,employee_id,shift_id,actor_user_id,request_id),
  FOREIGN KEY(tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id),
  FOREIGN KEY(tenant_id,actor_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY(tenant_id,project_id,employee_id,shift_id) REFERENCES managed_shifts(tenant_id,project_id,employee_id,id)
);
CREATE TABLE managed_execution_reports (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  report_id uuid NOT NULL,
  task_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  submitted_quantity numeric(14,3) NOT NULL CHECK(submitted_quantity>0),
  PRIMARY KEY(tenant_id,report_id),
  UNIQUE(tenant_id,project_id,shift_id,task_id),
  FOREIGN KEY(tenant_id,project_id,employee_id,shift_id) REFERENCES managed_shifts(tenant_id,project_id,employee_id,id),
  FOREIGN KEY(tenant_id,project_id,task_id,employee_id) REFERENCES daily_tasks(tenant_id,project_id,id,assignee_employee_id),
  FOREIGN KEY(tenant_id,project_id,employee_id,shift_id,actor_user_id,request_id) REFERENCES managed_execution_events(tenant_id,project_id,employee_id,shift_id,actor_user_id,request_id)
);
CREATE INDEX managed_shift_project_time ON managed_shifts(tenant_id,project_id,started_at,id);
CREATE INDEX managed_segment_shift_time ON managed_segments(tenant_id,project_id,employee_id,shift_id,started_at,id);
CREATE INDEX managed_event_project_time ON managed_execution_events(tenant_id,project_id,occurred_at,request_id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['managed_execution_streams','managed_shifts','managed_segments','managed_execution_events','managed_execution_reports'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant())',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO helios_app',t);
  END LOOP;
END $$;
GRANT UPDATE(version,last_interval_at) ON managed_execution_streams TO helios_app;
GRANT UPDATE(ended_at) ON managed_shifts,managed_segments TO helios_app;
