ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (
  role IN ('director', 'master', 'worker', 'pto', 'gd', 'ds', 'zds-sso', 'zds-soso',
           'supply', 'safety', 'hr', 'customer', 'admin')
);
