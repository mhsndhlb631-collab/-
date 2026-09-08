-- P0 base schema. Runtime access remains DENY by default until the real Auth spike
-- establishes the original-session accessor and reviewed scope policies.
-- Run as a separate migrator, never at request time. No auth.* table writes.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tarbiyah_runtime') THEN
    CREATE ROLE tarbiyah_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO tarbiyah_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE app.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT ON app.schema_migrations TO tarbiyah_runtime;

CREATE TYPE app.account_role AS ENUM ('RESPONSIBLE','MENTOR','STUDENT');
CREATE TYPE app.account_status AS ENUM ('PROVISIONING','ACTIVE','CREDENTIAL_UPDATE','DISABLED');

CREATE TABLE app.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  timezone text NOT NULL,
  week_starts_on smallint NOT NULL CHECK (week_starts_on BETWEEN 0 AND 6),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);
CREATE FUNCTION app.validate_timezone() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_timezone BEFORE INSERT OR UPDATE ON app.workspaces
FOR EACH ROW EXECUTE FUNCTION app.validate_timezone();

CREATE TABLE app.persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  contact_phone text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE(workspace_id,id)
);
CREATE TABLE app.student_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,person_id),
  FOREIGN KEY(workspace_id,person_id) REFERENCES app.persons(workspace_id,id)
);
CREATE TABLE app.login_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  person_id uuid NOT NULL,
  supabase_auth_user_id uuid UNIQUE,
  normalized_login_name text COLLATE "C" NOT NULL UNIQUE
    CHECK (normalized_login_name ~ '^[a-z0-9_ء-غف-ي]{3,32}$' AND normalized_login_name = normalize(normalized_login_name, NFC)),
  role app.account_role NOT NULL,
  status app.account_status NOT NULL DEFAULT 'PROVISIONING',
  must_change_password boolean NOT NULL DEFAULT true,
  revoked_before timestamptz,
  temporary_password_expires_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,person_id),
  FOREIGN KEY(workspace_id,person_id) REFERENCES app.persons(workspace_id,id),
  CHECK (status = 'PROVISIONING' OR supabase_auth_user_id IS NOT NULL),
  CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL)),
  CHECK (status <> 'ACTIVE' OR NOT must_change_password OR temporary_password_expires_at IS NOT NULL)
);
CREATE FUNCTION app.immutable_login_identity() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN
  IF NEW.normalized_login_name IS DISTINCT FROM OLD.normalized_login_name
    OR NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR (OLD.supabase_auth_user_id IS NOT NULL AND NEW.supabase_auth_user_id IS DISTINCT FROM OLD.supabase_auth_user_id)
  THEN RAISE EXCEPTION 'immutable login identity' USING ERRCODE='23514'; END IF;
  IF OLD.revoked_before IS NOT NULL AND (NEW.revoked_before IS NULL OR NEW.revoked_before < OLD.revoked_before)
  THEN RAISE EXCEPTION 'revocation cutoff cannot decrease' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER login_identity BEFORE UPDATE ON app.login_accounts
FOR EACH ROW EXECUTE FUNCTION app.immutable_login_identity();

CREATE TABLE app.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  actor_account_id uuid,
  actor_role app.account_role,
  subject_person_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  request_id uuid NOT NULL,
  reason text,
  safe_changes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_changes)='object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operation_id uuid,
  FOREIGN KEY(workspace_id,actor_account_id) REFERENCES app.login_accounts(workspace_id,id),
  FOREIGN KEY(workspace_id,subject_person_id) REFERENCES app.persons(workspace_id,id),
  CHECK ((actor_account_id IS NULL) = (actor_role IS NULL)),
  CHECK (actor_account_id IS NOT NULL OR action IN ('SYSTEM_BOOTSTRAP','SYSTEM_RECONCILIATION'))
);
CREATE FUNCTION app.audit_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN
  RAISE EXCEPTION 'audit is append only' USING ERRCODE='42501';
END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON app.audit_events
FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();

CREATE TABLE app.idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  actor_account_id uuid NOT NULL,
  command text NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS','SUCCEEDED','FAILED_RETRYABLE')),
  safe_result jsonb CHECK (safe_result IS NULL OR jsonb_typeof(safe_result)='object'),
  target_account_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,actor_account_id,command,key),
  FOREIGN KEY(workspace_id,actor_account_id) REFERENCES app.login_accounts(workspace_id,id),
  FOREIGN KEY(workspace_id,target_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE TABLE app.auth_attempt_buckets (
  bucket_hash text NOT NULL CHECK (bucket_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(bucket_hash,window_started_at)
);

-- Routine foundation only: one fixed-window bucket, shared through PostgreSQL.
-- Login adapter will invoke per-name and trusted-network buckets before Auth.
-- No client-controllable clock or thresholds. Hash inputs server-side with HMAC.
CREATE FUNCTION app.reserve_login_attempt(bucket text)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE start_at timestamptz; attempts integer; now_at timestamptz := clock_timestamp();
BEGIN
  IF bucket !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid bucket' USING ERRCODE='22023'; END IF;
  start_at := to_timestamp(floor(extract(epoch FROM now_at)/900)*900);
  INSERT INTO app.auth_attempt_buckets(bucket_hash,window_started_at,attempt_count,expires_at)
    VALUES(bucket,start_at,1,start_at+interval '30 minutes')
    ON CONFLICT(bucket_hash,window_started_at) DO UPDATE
    SET attempt_count = least(app.auth_attempt_buckets.attempt_count+1,11)
    RETURNING attempt_count INTO attempts;
  RETURN QUERY SELECT attempts <= 10, greatest(1,ceil(extract(epoch FROM start_at+interval '15 minutes'-now_at))::integer);
END $$;
REVOKE ALL ON FUNCTION app.reserve_login_attempt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_login_attempt(text) TO tarbiyah_runtime;

-- Runtime may discover no domain rows until reviewed identity policies are added.
ALTER TABLE app.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE app.persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.persons FORCE ROW LEVEL SECURITY;
ALTER TABLE app.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.student_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE app.login_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.login_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_records FORCE ROW LEVEL SECURITY;
-- Global pre-auth buckets have no direct runtime grants. The function is the only entry.
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
GRANT SELECT ON app.workspaces,app.persons,app.student_profiles,app.login_accounts,
  app.audit_events,app.idempotency_records TO tarbiyah_runtime;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON SCHEMA app FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON SCHEMA app FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM authenticated;
  END IF;
END $$;
