-- One initial internal inspection of the immutable, positive master-accepted part.
CREATE TABLE internal_inspections (
  tenant_id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  configuration_version integer NOT NULL,
  preparer_user_id uuid NOT NULL,
  responsible_user_id uuid NOT NULL,
  approver_user_id uuid NOT NULL,
  checklist_run_id uuid NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity>0),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,accepted_part_id),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,accepted_part_id) REFERENCES master_volume_reviews(tenant_id,id),
  FOREIGN KEY (tenant_id,project_id,configuration_version) REFERENCES route_config_versions(tenant_id,project_id,version),
  FOREIGN KEY (tenant_id,preparer_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,responsible_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,approver_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,checklist_run_id) REFERENCES checklist_runs(tenant_id,id)
);
CREATE TABLE internal_inspection_events (
  tenant_id uuid NOT NULL,
  accepted_part_id uuid NOT NULL,
  version integer NOT NULL,
  action text NOT NULL CHECK (action IN ('submit','responsible','approve','return')),
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  reason text,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,accepted_part_id,version),
  UNIQUE (tenant_id,actor_user_id,request_id),
  FOREIGN KEY (tenant_id,accepted_part_id) REFERENCES internal_inspections(tenant_id,accepted_part_id),
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id),
  CHECK ((action='submit' AND version=1 AND from_state='not_submitted' AND to_state='awaiting_responsibility')
      OR (action='responsible' AND version=2 AND from_state='awaiting_responsibility' AND to_state='awaiting_pto')
      OR (action='approve' AND version=3 AND from_state='awaiting_pto' AND to_state='accepted')
      OR (action='return' AND version=3 AND from_state='awaiting_pto' AND to_state='returned')),
  CHECK (action<>'return' OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500))
);
ALTER TABLE internal_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_inspections FORCE ROW LEVEL SECURITY;
ALTER TABLE internal_inspection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_inspection_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON internal_inspections USING (tenant_id=app_tenant()) WITH CHECK (tenant_id=app_tenant());
CREATE POLICY tenant_isolation ON internal_inspection_events USING (tenant_id=app_tenant()) WITH CHECK (tenant_id=app_tenant());
GRANT SELECT,INSERT ON internal_inspections,internal_inspection_events TO helios_app;
