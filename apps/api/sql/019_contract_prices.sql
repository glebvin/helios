-- Реестр договорных цен единицы. Это не зарплата и не себестоимость.
-- Редакция неизменяема. Исправление — следующая версия, прежняя строка остаётся.
-- На одну дату у вида работ действует одна редакция той же единицы.
-- Пересечение периодов этой единицы — конфликт, не две действующие цены.
-- Расчёт по старому номеру версии повторяет цену той редакции.
CREATE TABLE contract_price_revisions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  work_type_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 40),
  price text NOT NULL CHECK (price ~ '^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$'),
  period_start date NOT NULL,
  period_end date NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, work_type_id, version),
  FOREIGN KEY (tenant_id, project_id, work_type_id) REFERENCES project_work_types (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships (tenant_id, user_id),
  CHECK (period_start <= period_end)
);
ALTER TABLE contract_price_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_price_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_price_revisions
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON contract_price_revisions TO helios_app;
