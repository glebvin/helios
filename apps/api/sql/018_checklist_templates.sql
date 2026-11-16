-- Checklist template editions. An approved edition and its route history are not rewritten.
CREATE TABLE checklist_templates (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
);
CREATE TABLE checklist_template_editions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  template_id uuid NOT NULL,
  edition integer NOT NULL CHECK (edition > 0),
  title text NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  status text NOT NULL CHECK (status IN ('draft','pending_responsible','in_review','pending_approval','approved','returned')),
  version integer NOT NULL CHECK (version > 0),
  route_snapshot jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, template_id, edition),
  FOREIGN KEY (tenant_id, template_id) REFERENCES checklist_templates(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
);
CREATE UNIQUE INDEX checklist_one_open_edition ON checklist_template_editions (tenant_id, template_id)
  WHERE status IN ('draft','pending_responsible','in_review','pending_approval');
CREATE TABLE checklist_template_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  template_id uuid NOT NULL,
  edition integer NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('save','submit','accept','review','approve','return','revise')),
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_role text NOT NULL,
  actor_name text NOT NULL,
  reason text,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, template_id, edition) REFERENCES checklist_template_editions(tenant_id, template_id, edition),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, actor_user_id, request_id) REFERENCES people_command_receipts(tenant_id, actor_user_id, request_id)
);
CREATE FUNCTION protect_checklist_template_edition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.items IS DISTINCT FROM OLD.items OR NEW.title IS DISTINCT FROM OLD.title OR NEW.version IS DISTINCT FROM OLD.version THEN
    IF NOT EXISTS (
      SELECT 1 FROM checklist_template_events e
      WHERE e.tenant_id = NEW.tenant_id AND e.template_id = NEW.template_id AND e.edition = NEW.edition
        AND e.version = NEW.version AND e.from_status = OLD.status AND e.to_status = NEW.status
        AND e.actor_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    ) THEN
      RAISE EXCEPTION 'checklist template edition requires its event' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checklist_template_edition_guard BEFORE UPDATE ON checklist_template_editions
  FOR EACH ROW EXECUTE FUNCTION protect_checklist_template_edition();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['checklist_templates','checklist_template_editions','checklist_template_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON checklist_templates TO helios_app;
GRANT SELECT, INSERT, UPDATE ON checklist_template_editions TO helios_app;
GRANT SELECT, INSERT ON checklist_template_events TO helios_app;
