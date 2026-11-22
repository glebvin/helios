ALTER TABLE project_work_types
  ADD COLUMN hidden_work boolean NOT NULL DEFAULT false;

ALTER TABLE projects
  ADD COLUMN internal_inspection_required boolean NOT NULL DEFAULT true,
  ADD COLUMN inspection_policy_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT projects_inspection_policy_version_check CHECK (inspection_policy_version >= 0);
