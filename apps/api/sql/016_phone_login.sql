-- Phone login is a verified identity, not a second password and not a fake email.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_login_pair CHECK ((email IS NULL) = (password_hash IS NULL));

CREATE TABLE phone_identities (
  phone text PRIMARY KEY CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  verified_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON phone_identities FROM PUBLIC;
GRANT SELECT, INSERT ON phone_identities TO helios_app;

ALTER TABLE invitations ADD COLUMN phone text;
ALTER TABLE invitations ADD COLUMN employee_id uuid;
ALTER TABLE invitations ADD CONSTRAINT invitations_phone CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE invitations ADD FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id);

CREATE TABLE phone_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('join', 'login')),
  invitation_id uuid,
  code_hash text NOT NULL,
  request_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purpose, request_id)
);
CREATE INDEX phone_challenges_recent ON phone_challenges (phone, created_at DESC);
REVOKE ALL ON phone_challenges FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON phone_challenges TO helios_app;
