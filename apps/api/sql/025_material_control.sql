-- Входной контроль партии. Результат пишет сервер по шагам маршрута и проверке чек-листа.
-- Это не склад, не закупка и не кнопка «Принять». Прежние строки шагов не переписываются.
CREATE TABLE material_controls (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  id uuid NOT NULL,
  zone_id uuid NOT NULL,
  work_type_id uuid NOT NULL,
  template_id uuid NOT NULL,
  edition integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, project_id, batch_id),
  FOREIGN KEY (tenant_id, project_id, batch_id) REFERENCES material_batches (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, zone_id) REFERENCES project_work_zones (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, work_type_id) REFERENCES project_work_types (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, template_id, edition) REFERENCES checklist_template_editions (tenant_id, template_id, edition),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships (tenant_id, user_id)
);
CREATE TABLE material_control_steps (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  control_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('prepare', 'data', 'responsible', 'review')),
  answers jsonb,
  snapshot jsonb,
  batch_version integer,
  CHECK ((action='prepare' AND snapshot IS NOT NULL AND jsonb_typeof(snapshot)='object' AND batch_version IS NOT NULL AND batch_version>0) OR (action<>'prepare' AND snapshot IS NULL AND batch_version IS NULL)),
  data_mark text CHECK (data_mark IS NULL OR data_mark IN ('provided', 'overdue')),
  decision text CHECK (decision IS NULL OR decision IN ('agree', 'return')),
  verdict text NOT NULL CHECK (verdict IN ('awaiting', 'accepted', 'rejected')),
  actor_user_id uuid NOT NULL,
  actor_role text NOT NULL,
  reason text,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, control_id, version),
  FOREIGN KEY (tenant_id, control_id) REFERENCES material_controls (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES memberships (tenant_id, user_id)
);
ALTER TABLE daily_tasks ADD COLUMN material_batch_id uuid;
ALTER TABLE daily_tasks ADD FOREIGN KEY (tenant_id, project_id, material_batch_id) REFERENCES material_batches (tenant_id, project_id, id);
ALTER TABLE material_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_controls FORCE ROW LEVEL SECURITY;
ALTER TABLE material_control_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_control_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON material_controls USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY tenant_isolation ON material_control_steps USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON material_controls, material_control_steps TO helios_app;
