-- First, immutable master decision for one managed report. No PTO/customer acceptance.
CREATE TABLE master_volume_reviews (
  tenant_id uuid NOT NULL,
  report_id uuid NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version=1),
  submitted_quantity numeric(14,3) NOT NULL CHECK (submitted_quantity>0),
  accepted_quantity numeric(14,3) NOT NULL CHECK (accepted_quantity>=0),
  difference_quantity numeric(14,3) NOT NULL CHECK (difference_quantity>=0),
  reason text,
  checklist_run_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_name text NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,report_id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,actor_user_id,request_id),
  CHECK (accepted_quantity+difference_quantity=submitted_quantity),
  CHECK (difference_quantity=0 OR length(btrim(reason)) BETWEEN 1 AND 500 AND reason IS NOT NULL),
  FOREIGN KEY (tenant_id,report_id) REFERENCES managed_execution_reports(tenant_id,report_id),
  FOREIGN KEY (tenant_id,checklist_run_id) REFERENCES checklist_runs(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id)
);
ALTER TABLE master_volume_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_volume_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON master_volume_reviews USING (tenant_id=app_tenant()) WITH CHECK (tenant_id=app_tenant());
GRANT SELECT,INSERT ON master_volume_reviews TO helios_app;
