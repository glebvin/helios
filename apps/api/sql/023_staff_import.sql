-- One employer per import. The personnel number is not a document number and is never
-- written into document_number. A full name is not an identity. An existing card is not
-- overwritten. An ambiguous match is stored only as a rejected check, never as a guess.
ALTER TABLE employees ADD COLUMN personnel_number text;
ALTER TABLE employees ADD CONSTRAINT employees_personnel_number_text CHECK (
  personnel_number IS NULL OR (
    char_length(personnel_number) BETWEEN 1 AND 80 AND personnel_number = btrim(personnel_number)
  )
);
CREATE UNIQUE INDEX employees_personnel_number_org
  ON employees (tenant_id, organization_id, lower(personnel_number))
  WHERE personnel_number IS NOT NULL;

CREATE TABLE staff_imports (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  organization_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  file_sha256 text NOT NULL,
  created_count integer NOT NULL CHECK (created_count >= 0),
  present_count integer NOT NULL CHECK (present_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, actor_user_id, request_id),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES memberships (tenant_id, user_id)
);
CREATE INDEX staff_imports_recent ON staff_imports (tenant_id, created_at DESC, id);

CREATE TABLE staff_import_rows (
  tenant_id uuid NOT NULL,
  import_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number > 1),
  personnel_number text NOT NULL,
  full_name text NOT NULL,
  phone text,
  outcome text NOT NULL CHECK (outcome IN ('created', 'present')),
  employee_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, import_id, row_number),
  FOREIGN KEY (tenant_id, import_id) REFERENCES staff_imports (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);

ALTER TABLE staff_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_imports;
CREATE POLICY tenant_isolation ON staff_imports
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE staff_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_import_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_import_rows;
CREATE POLICY tenant_isolation ON staff_import_rows
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

REVOKE ALL ON staff_imports, staff_import_rows FROM PUBLIC;
GRANT SELECT, INSERT ON staff_imports, staff_import_rows TO helios_app;
