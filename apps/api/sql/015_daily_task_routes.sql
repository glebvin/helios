CREATE TABLE daily_task_route_attempts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  id uuid NOT NULL,
  attempt integer NOT NULL CHECK(attempt>0),
  config_version integer NOT NULL,
  plan_revision integer NOT NULL CHECK(plan_revision>0),
  preparer_user_id uuid NOT NULL,
  responsible_user_id uuid NOT NULL,
  approver_user_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,project_id,task_id,id),
  UNIQUE(tenant_id,project_id,task_id,attempt),
  FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES daily_tasks(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,project_id,config_version) REFERENCES route_config_versions(tenant_id,project_id,version),
  FOREIGN KEY(tenant_id,preparer_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY(tenant_id,responsible_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY(tenant_id,approver_user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE daily_task_route_events (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  id uuid NOT NULL,
  attempt_id uuid,
  task_version integer NOT NULL CHECK(task_version>0),
  action text NOT NULL CHECK(action IN('submit','publish','reject','reopen','cancel')),
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_role text NOT NULL,
  request_id uuid NOT NULL,
  actor_name text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,project_id,task_id,id),
  UNIQUE(tenant_id,project_id,task_id,task_version),
  UNIQUE(tenant_id,actor_user_id,request_id),
  FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES daily_tasks(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,project_id,task_id,attempt_id) REFERENCES daily_task_route_attempts(tenant_id,project_id,task_id,id),
  FOREIGN KEY(tenant_id,actor_user_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY(tenant_id,actor_user_id,request_id) REFERENCES people_command_receipts(tenant_id,actor_user_id,request_id),
  CHECK((action='submit' AND from_status='draft' AND to_status='pending_approval' AND attempt_id IS NOT NULL)
     OR (action='publish' AND from_status='pending_approval' AND to_status='published' AND attempt_id IS NOT NULL)
     OR (action IN('reject','reopen') AND from_status='pending_approval' AND to_status='draft')
     OR (action='cancel' AND from_status IN('draft','pending_approval','published') AND to_status='cancelled')),
  CHECK((action IN('reject','reopen','cancel') AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500) OR (action IN('submit','publish') AND reason IS NULL))
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['daily_task_route_attempts','daily_task_route_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=app_tenant()) WITH CHECK(tenant_id=app_tenant())',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO helios_app',t);
  END LOOP;
END $$;

-- A rollback to a pre-route API must refuse a transition, never bypass approval.
-- A matching event is inserted by the new API in the SAME transaction before task update.
CREATE FUNCTION protect_daily_route_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workflow_kind='managed02b' AND NEW.status IS DISTINCT FROM OLD.status AND (
    EXISTS(SELECT 1 FROM route_config_versions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id)
    OR EXISTS(SELECT 1 FROM daily_task_route_attempts WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND task_id=NEW.id)
  ) THEN
    IF NOT EXISTS(
      SELECT 1 FROM daily_task_route_events e
      JOIN memberships m ON m.tenant_id=e.tenant_id AND m.user_id=e.actor_user_id AND m.status='active' AND m.role=e.actor_role
      JOIN project_memberships pm ON pm.tenant_id=e.tenant_id AND pm.project_id=e.project_id AND pm.user_id=e.actor_user_id AND pm.status='active'
      LEFT JOIN daily_task_route_attempts a ON a.tenant_id=e.tenant_id AND a.project_id=e.project_id AND a.task_id=e.task_id AND a.id=e.attempt_id
      WHERE e.tenant_id=NEW.tenant_id AND e.project_id=NEW.project_id AND e.task_id=NEW.id
        AND e.task_version=NEW.version AND e.from_status=OLD.status AND e.to_status=NEW.status
        AND e.actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid
        AND (e.action NOT IN('submit','publish','reject')
          OR (e.action='submit' AND m.role='master' AND a.preparer_user_id=e.actor_user_id AND a.plan_revision=OLD.plan_revision)
          OR (e.action IN('publish','reject') AND m.role='director' AND a.approver_user_id=e.actor_user_id AND a.plan_revision=OLD.plan_revision))
    ) THEN RAISE EXCEPTION 'daily route transition requires its authorized event' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER daily_route_transition_gate BEFORE UPDATE ON daily_tasks FOR EACH ROW EXECUTE FUNCTION protect_daily_route_transition();
