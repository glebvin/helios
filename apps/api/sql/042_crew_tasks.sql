ALTER TABLE daily_tasks
  ADD COLUMN crew_id uuid,
  ADD COLUMN crew_snapshot jsonb,
  ADD FOREIGN KEY (tenant_id, project_id, crew_id) REFERENCES crews (tenant_id, project_id, id),
  ADD CONSTRAINT daily_tasks_crew_snapshot_pair CHECK (
    (crew_id IS NULL AND crew_snapshot IS NULL) OR (crew_id IS NOT NULL AND crew_snapshot IS NOT NULL)
  );

CREATE TABLE crew_volume_submissions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, task_id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, project_id, task_id) REFERENCES daily_tasks (tenant_id, project_id, id)
);

ALTER TABLE crew_volume_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_volume_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY crew_volume_tenant ON crew_volume_submissions
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON crew_volume_submissions TO helios_app;
