ALTER TABLE projects ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS longitude double precision;
