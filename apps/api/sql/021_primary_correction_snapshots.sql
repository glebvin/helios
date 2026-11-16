-- Append-only upgrade: preserve020 and every issued revision.
-- Old corrections were notes against the original close; retain that exact source.
ALTER TABLE time_corrections ADD COLUMN source_hash text;
ALTER TABLE time_corrections ADD COLUMN snapshot jsonb;
UPDATE time_corrections c SET source_hash=c.corrects_hash, snapshot=p.snapshot
FROM primary_day_closes p WHERE p.tenant_id=c.tenant_id AND p.project_id=c.project_id
  AND p.organization_id=c.organization_id AND p.day=c.day;
ALTER TABLE time_corrections ALTER COLUMN source_hash SET NOT NULL;
ALTER TABLE time_corrections ALTER COLUMN snapshot SET NOT NULL;
ALTER TABLE time_corrections ADD CONSTRAINT correction_source_hash CHECK (source_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE time_corrections ADD CONSTRAINT correction_snapshot CHECK (jsonb_typeof(snapshot)='object');
