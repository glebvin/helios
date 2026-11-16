-- Партия материала для входного контроля. Это не склад, не закупка и не оплата.
-- Редакция неизменяема. Исправление — следующая версия.
-- Статус этого результата только awaiting_control: оператор не объявляет партию принятой.
-- Документ готов, только когда байты проверены и записаны. Незавершённая загрузка остаётся pending.
CREATE TABLE material_batches (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  organization_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id)
);
CREATE TABLE material_batch_revisions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  material_name text NOT NULL CHECK (length(btrim(material_name)) BETWEEN 1 AND 200),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 40),
  batch_code text NOT NULL CHECK (length(btrim(batch_code)) BETWEEN 1 AND 80),
  supplier_name text NOT NULL CHECK (length(btrim(supplier_name)) BETWEEN 1 AND 200),
  delivery_document text NOT NULL CHECK (length(btrim(delivery_document)) BETWEEN 1 AND 80),
  delivered_on date NOT NULL,
  delivered_quantity text NOT NULL CHECK (delivered_quantity ~ '^[0-9]{1,11}([.][0-9]{1,3})?$'),
  status text NOT NULL DEFAULT 'awaiting_control' CHECK (status = 'awaiting_control'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, batch_id, version),
  FOREIGN KEY (tenant_id, project_id, batch_id) REFERENCES material_batches (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships (tenant_id, user_id)
);
CREATE TABLE material_batch_documents (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  id uuid NOT NULL,
  filename text NOT NULL CHECK (length(btrim(filename)) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('pending', 'ready')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, batch_id, id),
  FOREIGN KEY (tenant_id, project_id, batch_id) REFERENCES material_batches (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships (tenant_id, user_id)
);
ALTER TABLE material_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE material_batch_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_batch_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE material_batch_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_batch_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON material_batches USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY tenant_isolation ON material_batch_revisions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY tenant_isolation ON material_batch_documents USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON material_batches, material_batch_revisions TO helios_app;
GRANT SELECT, INSERT ON material_batch_documents TO helios_app;
GRANT UPDATE (state) ON material_batch_documents TO helios_app;
