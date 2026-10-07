-- Outwork database schema. Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  full_name     text NOT NULL,
  password_hash text NOT NULL,
  avatar        text NOT NULL DEFAULT '',
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

-- Server side sessions. Only a hash of the session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  code       text NOT NULL UNIQUE,
  admin_id   uuid NOT NULL REFERENCES users(id),
  start_date date NOT NULL,
  end_date   date NOT NULL,
  daily_cap  integer NOT NULL DEFAULT 2,
  rates      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- status: active, left. (pending and declined are from the old admit step and are no longer used.)
CREATE TABLE IF NOT EXISTS memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('pending','active','declined','left')),
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  joined_at    timestamptz,
  left_at      timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);

CREATE TABLE IF NOT EXISTS invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       text NOT NULL,
  email      text NOT NULL,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, email)
);

CREATE TABLE IF NOT EXISTS workouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cat        text NOT NULL,
  date       date NOT NULL,
  dist       double precision NOT NULL DEFAULT 0,
  mins       double precision NOT NULL DEFAULT 0,
  lifts      jsonb NOT NULL DEFAULT '[]',
  base       integer NOT NULL,
  perf       integer NOT NULL DEFAULT 0,
  pr_pts     integer NOT NULL DEFAULT 0,
  prs        jsonb NOT NULL DEFAULT '[]',
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workouts_group ON workouts (group_id, date);
CREATE INDEX IF NOT EXISTS workouts_user ON workouts (user_id, created_at DESC);

-- A person's PRs, entered once and updated when beaten.
CREATE TABLE IF NOT EXISTS prs (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cat        text NOT NULL,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cat)
);

-- Group activity, used for the "what you missed" pop up.
CREATE TABLE IF NOT EXISTS events (
  id         bigserial PRIMARY KEY,
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  type       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_group ON events (group_id, created_at DESC);

-- Messages for one person (someone joined your group, a challenge was shut down).
CREATE TABLE IF NOT EXISTS notifications (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);

-- Security audit trail: sign ins, failed sign ins, profile and admin actions.
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid,
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  ip         text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_user ON audit_log (user_id, created_at DESC);

-- Forgot password. Only a hash of the emailed token is stored. One use, one hour.
CREATE TABLE IF NOT EXISTS password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

-- One logged workout counts in every group the person is in. Its rows share an entry id.
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS entry_id uuid;
CREATE INDEX IF NOT EXISTS workouts_entry ON workouts (entry_id);

-- The admin can shut a challenge down early. Standings freeze and nothing more can be logged.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Invites can be sent again. sent_at is the last time the email went out.
ALTER TABLE invites ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS sends integer NOT NULL DEFAULT 1;
UPDATE invites SET sent_at = created_at WHERE sent_at IS NULL;
ALTER TABLE invites ALTER COLUMN sent_at SET DEFAULT now();

-- Set the first time a person is shown the "enter your PRs" prompt, so it only appears once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcomed_at timestamptz;

-- Joining no longer waits for the admin. Anyone who was still waiting is let in.
UPDATE memberships SET status = 'active', joined_at = COALESCE(joined_at, now()), last_seen_at = now() WHERE status = 'pending';
