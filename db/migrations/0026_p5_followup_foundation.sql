CREATE TYPE app.attention_status AS ENUM ('OPEN','IN_PROGRESS','SNOOZED','RESOLVED','DISMISSED');
CREATE TYPE app.action_status AS ENUM ('OPEN','IN_PROGRESS','DONE_PENDING_VERIFICATION','VERIFIED','CANCELLED');
CREATE TYPE app.case_status AS ENUM ('OPEN','MONITORING','RESOLVED','ARCHIVED');
CREATE TYPE app.case_priority AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');

CREATE TABLE app.attentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), enrollment_id uuid NOT NULL,
  rule_code text NOT NULL CHECK(rule_code IN ('CONSECUTIVE_UNEXCUSED_ABSENCE','NO_QUALIFIED_FOLLOWUP_14D','NEW_STUDENT_NO_CHECKIN_3D','SESSION_OVERDUE_24H','EXAM_OR_REVIEW_OVERDUE','CASE_ACTION_OVERDUE')),
  evidence_key text NOT NULL CHECK(char_length(evidence_key) BETWEEN 1 AND 300), evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
  owner_account_id uuid, status app.attention_status NOT NULL DEFAULT 'OPEN', original_due_at timestamptz NOT NULL, due_at timestamptz NOT NULL,
  snoozed_until timestamptz, resolution_reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0), UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id), FOREIGN KEY(workspace_id,owner_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE UNIQUE INDEX attention_active_rule_evidence ON app.attentions(workspace_id,enrollment_id,rule_code,evidence_key) WHERE status IN ('OPEN','IN_PROGRESS','SNOOZED');

CREATE TABLE app.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), enrollment_id uuid NOT NULL,
  title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160), problem text NOT NULL CHECK(char_length(problem) BETWEEN 3 AND 5000),
  priority app.case_priority NOT NULL, status app.case_status NOT NULL DEFAULT 'OPEN', owner_account_id uuid NOT NULL,
  resolution_summary text, opened_at timestamptz NOT NULL DEFAULT clock_timestamp(), resolved_at timestamptz, archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id), FOREIGN KEY(workspace_id,owner_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE TABLE app.actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), enrollment_id uuid NOT NULL,
  attention_id uuid, case_id uuid, owner_account_id uuid NOT NULL, title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 300),
  status app.action_status NOT NULL DEFAULT 'OPEN', original_due_at timestamptz NOT NULL, due_at timestamptz NOT NULL,
  completion_note text, verification_note text, completed_at timestamptz, verified_at timestamptz, cancelled_at timestamptz, cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,attention_id) REFERENCES app.attentions(workspace_id,id), FOREIGN KEY(workspace_id,case_id) REFERENCES app.cases(workspace_id,id),
  FOREIGN KEY(workspace_id,owner_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE INDEX actions_due ON app.actions(workspace_id,status,due_at);

CREATE TABLE app.followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), enrollment_id uuid NOT NULL,
  performed_by_account_id uuid NOT NULL, occurred_at timestamptz NOT NULL CHECK(occurred_at<=clock_timestamp()), channel text NOT NULL CHECK(channel IN ('IN_PERSON','PHONE','MESSAGE','VIDEO','OTHER')),
  outcome text NOT NULL CHECK(char_length(outcome) BETWEEN 3 AND 5000), qualifies boolean NOT NULL, action_id uuid, case_id uuid,
  current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0), cancelled_at timestamptz, cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,performed_by_account_id) REFERENCES app.login_accounts(workspace_id,id), FOREIGN KEY(workspace_id,action_id) REFERENCES app.actions(workspace_id,id), FOREIGN KEY(workspace_id,case_id) REFERENCES app.cases(workspace_id,id)
);
CREATE TABLE app.followup_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), followup_id uuid NOT NULL,
  followup_version integer NOT NULL CHECK(followup_version>0), snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  actor_account_id uuid NOT NULL, reason text NOT NULL CHECK(char_length(reason) BETWEEN 3 AND 500), request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(followup_id,followup_version), UNIQUE(request_id),
  FOREIGN KEY(workspace_id,followup_id) REFERENCES app.followups(workspace_id,id)
);
CREATE TABLE app.case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), case_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('OPENED','NOTE','ASSIGNED','ESCALATED','MONITORING','RESOLVED','REOPENED','ARCHIVED')),
  note text NOT NULL CHECK(char_length(note) BETWEEN 3 AND 5000), actor_account_id uuid NOT NULL, request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(request_id), FOREIGN KEY(workspace_id,case_id) REFERENCES app.cases(workspace_id,id)
);

CREATE TRIGGER followup_revision_immutable BEFORE UPDATE OR DELETE ON app.followup_revisions FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();
CREATE TRIGGER case_event_immutable BEFORE UPDATE OR DELETE ON app.case_events FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();
