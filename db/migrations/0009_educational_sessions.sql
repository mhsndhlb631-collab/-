CREATE TYPE app.session_status AS ENUM ('PLANNED','OPEN','CLOSED','CANCELLED');
CREATE TYPE app.attendance_status AS ENUM ('NOT_RECORDED','PRESENT','LATE','EXCUSED_ABSENCE','UNEXCUSED_ABSENCE');
CREATE TYPE app.metric_value_type AS ENUM ('BOOLEAN','COUNT','PERCENT','SCORE','DURATION','NUMBER','ENUM','SHORT_TEXT');

CREATE TABLE app.session_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  plan_week_id uuid NOT NULL, name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
  session_type text NOT NULL CHECK(char_length(session_type) BETWEEN 1 AND 80),
  day_offset smallint NOT NULL CHECK(day_offset BETWEEN 0 AND 6), starts_at time NOT NULL,
  duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 720), attendance_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), UNIQUE(plan_week_id,name),
  FOREIGN KEY(workspace_id,plan_week_id) REFERENCES app.plan_weeks(workspace_id,id)
);
CREATE TABLE app.session_metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  session_definition_id uuid NOT NULL, name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
  value_type app.metric_value_type NOT NULL, required boolean NOT NULL DEFAULT false,
  applies_to jsonb NOT NULL DEFAULT '["PRESENT","LATE"]'::jsonb CHECK(jsonb_typeof(applies_to)='array'),
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(constraints)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), UNIQUE(session_definition_id,name),
  FOREIGN KEY(workspace_id,session_definition_id) REFERENCES app.session_definitions(workspace_id,id)
);
CREATE TABLE app.session_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  session_definition_id uuid NOT NULL, group_id uuid NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  responsible_mentor_person_id uuid, status app.session_status NOT NULL DEFAULT 'PLANNED',
  opened_at timestamptz, closed_at timestamptz, cancelled_at timestamptz, cancellation_reason text,
  opened_by_account_id uuid, closed_by_account_id uuid, cancelled_by_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0), UNIQUE(workspace_id,id), UNIQUE(session_definition_id,group_id),
  FOREIGN KEY(workspace_id,session_definition_id) REFERENCES app.session_definitions(workspace_id,id),
  FOREIGN KEY(workspace_id,group_id) REFERENCES app.groups(workspace_id,id),
  FOREIGN KEY(workspace_id,responsible_mentor_person_id) REFERENCES app.persons(workspace_id,id),
  FOREIGN KEY(workspace_id,opened_by_account_id) REFERENCES app.login_accounts(workspace_id,id),
  FOREIGN KEY(workspace_id,closed_by_account_id) REFERENCES app.login_accounts(workspace_id,id),
  FOREIGN KEY(workspace_id,cancelled_by_account_id) REFERENCES app.login_accounts(workspace_id,id),
  CHECK(ends_at>starts_at), CHECK((status<>'CANCELLED') OR (cancelled_at IS NOT NULL AND char_length(cancellation_reason) BETWEEN 3 AND 500))
);
CREATE TABLE app.session_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  session_occurrence_id uuid NOT NULL, enrollment_id uuid NOT NULL, eligibility text NOT NULL DEFAULT 'EXPECTED' CHECK(eligibility IN ('EXPECTED','EXEMPT')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(workspace_id,id), UNIQUE(session_occurrence_id,enrollment_id),
  FOREIGN KEY(workspace_id,session_occurrence_id) REFERENCES app.session_occurrences(workspace_id,id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id)
);
CREATE TABLE app.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  roster_id uuid NOT NULL, status app.attendance_status NOT NULL DEFAULT 'NOT_RECORDED', reason text,
  recorded_by_account_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0), UNIQUE(workspace_id,id), UNIQUE(roster_id),
  FOREIGN KEY(workspace_id,roster_id) REFERENCES app.session_roster(workspace_id,id),
  FOREIGN KEY(workspace_id,recorded_by_account_id) REFERENCES app.login_accounts(workspace_id,id),
  CHECK(status NOT IN ('EXCUSED_ABSENCE','UNEXCUSED_ABSENCE') OR char_length(reason) BETWEEN 3 AND 500)
);
CREATE TABLE app.session_metric_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  roster_id uuid NOT NULL, metric_definition_id uuid NOT NULL, value jsonb NOT NULL,
  recorded_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0), UNIQUE(workspace_id,id), UNIQUE(roster_id,metric_definition_id),
  FOREIGN KEY(workspace_id,roster_id) REFERENCES app.session_roster(workspace_id,id),
  FOREIGN KEY(workspace_id,metric_definition_id) REFERENCES app.session_metric_definitions(workspace_id,id),
  FOREIGN KEY(workspace_id,recorded_by_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE TABLE app.session_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  session_occurrence_id uuid NOT NULL, actor_account_id uuid NOT NULL, reason text NOT NULL CHECK(char_length(reason) BETWEEN 3 AND 500),
  before_snapshot jsonb NOT NULL CHECK(jsonb_typeof(before_snapshot)='object'), after_snapshot jsonb NOT NULL CHECK(jsonb_typeof(after_snapshot)='object'),
  request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(workspace_id,id), UNIQUE(request_id),
  FOREIGN KEY(workspace_id,session_occurrence_id) REFERENCES app.session_occurrences(workspace_id,id),
  FOREIGN KEY(workspace_id,actor_account_id) REFERENCES app.login_accounts(workspace_id,id)
);

CREATE FUNCTION app.actor_can_operate_session(target_workspace uuid,target_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.actor_allows(target_workspace,NULL,true) OR EXISTS(
   SELECT 1 FROM app.session_occurrences so JOIN app.login_accounts a ON a.id=app.request_account_id() AND a.workspace_id=so.workspace_id
   WHERE so.workspace_id=target_workspace AND so.id=target_session AND a.role='MENTOR' AND (
     so.responsible_mentor_person_id=a.person_id OR (so.responsible_mentor_person_id IS NULL AND EXISTS(
       SELECT 1 FROM app.mentor_assignments ma WHERE ma.workspace_id=so.workspace_id AND ma.group_id=so.group_id
       AND ma.mentor_person_id=a.person_id AND ma.effective_from<=so.starts_at
       AND (ma.effective_to IS NULL OR ma.effective_to>so.starts_at))))
   )
$$;
REVOKE ALL ON FUNCTION app.actor_can_operate_session(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_operate_session(uuid,uuid) TO tarbiyah_runtime;

ALTER TABLE app.session_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.session_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.session_metric_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.session_metric_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.session_occurrences ENABLE ROW LEVEL SECURITY; ALTER TABLE app.session_occurrences FORCE ROW LEVEL SECURITY;
ALTER TABLE app.session_roster ENABLE ROW LEVEL SECURITY; ALTER TABLE app.session_roster FORCE ROW LEVEL SECURITY;
ALTER TABLE app.attendance ENABLE ROW LEVEL SECURITY; ALTER TABLE app.attendance FORCE ROW LEVEL SECURITY;
ALTER TABLE app.session_metric_records ENABLE ROW LEVEL SECURITY; ALTER TABLE app.session_metric_records FORCE ROW LEVEL SECURITY;
ALTER TABLE app.session_corrections ENABLE ROW LEVEL SECURITY; ALTER TABLE app.session_corrections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.session_definitions,app.session_metric_definitions,app.session_occurrences,app.session_roster,app.attendance,app.session_metric_records,app.session_corrections FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON app.session_occurrences,app.session_roster,app.attendance,app.session_metric_records TO tarbiyah_runtime;
GRANT SELECT,INSERT ON app.session_definitions,app.session_metric_definitions,app.session_corrections TO tarbiyah_runtime;

CREATE POLICY session_definitions_read ON app.session_definitions FOR SELECT TO tarbiyah_runtime USING(
  EXISTS(SELECT 1 FROM app.plan_weeks pw WHERE pw.id=session_definitions.plan_week_id AND app.actor_can_read_plan(session_definitions.workspace_id,pw.plan_id)));
CREATE POLICY metric_definitions_read ON app.session_metric_definitions FOR SELECT TO tarbiyah_runtime USING(
  EXISTS(SELECT 1 FROM app.session_definitions sd JOIN app.plan_weeks pw ON pw.id=sd.plan_week_id WHERE sd.id=session_metric_definitions.session_definition_id AND app.actor_can_read_plan(session_metric_definitions.workspace_id,pw.plan_id)));
CREATE POLICY occurrences_read ON app.session_occurrences FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_group(workspace_id,group_id));
CREATE POLICY roster_read ON app.session_roster FOR SELECT TO tarbiyah_runtime USING(EXISTS(
  SELECT 1 FROM app.session_occurrences so JOIN app.enrollments e ON e.id=session_roster.enrollment_id
  JOIN app.student_profiles sp ON sp.id=e.student_profile_id JOIN app.login_accounts a ON a.id=app.request_account_id()
  WHERE so.id=session_roster.session_occurrence_id AND (app.actor_can_operate_session(session_roster.workspace_id,so.id) OR a.person_id=sp.person_id)));
CREATE POLICY attendance_read ON app.attendance FOR SELECT TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.session_roster sr WHERE sr.id=attendance.roster_id));
CREATE POLICY metric_records_read ON app.session_metric_records FOR SELECT TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.session_roster sr WHERE sr.id=session_metric_records.roster_id));
CREATE POLICY corrections_responsible_read ON app.session_corrections FOR SELECT TO tarbiyah_runtime USING(app.actor_allows(workspace_id,NULL,true));

CREATE POLICY definitions_responsible_insert ON app.session_definitions FOR INSERT TO tarbiyah_runtime WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY metrics_responsible_insert ON app.session_metric_definitions FOR INSERT TO tarbiyah_runtime WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY occurrence_responsible_insert ON app.session_occurrences FOR INSERT TO tarbiyah_runtime WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY occurrence_operate_update ON app.session_occurrences FOR UPDATE TO tarbiyah_runtime USING(app.actor_can_operate_session(workspace_id,id)) WITH CHECK(app.actor_can_operate_session(workspace_id,id));
CREATE POLICY roster_operate_insert ON app.session_roster FOR INSERT TO tarbiyah_runtime WITH CHECK(app.actor_can_operate_session(workspace_id,session_occurrence_id));
CREATE POLICY attendance_operate_insert ON app.attendance FOR INSERT TO tarbiyah_runtime WITH CHECK(EXISTS(SELECT 1 FROM app.session_roster sr WHERE sr.id=attendance.roster_id AND app.actor_can_operate_session(attendance.workspace_id,sr.session_occurrence_id)));
CREATE POLICY attendance_operate_update ON app.attendance FOR UPDATE TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.session_roster sr WHERE sr.id=attendance.roster_id AND app.actor_can_operate_session(attendance.workspace_id,sr.session_occurrence_id))) WITH CHECK(EXISTS(SELECT 1 FROM app.session_roster sr WHERE sr.id=attendance.roster_id AND app.actor_can_operate_session(attendance.workspace_id,sr.session_occurrence_id)));
CREATE POLICY records_operate_insert ON app.session_metric_records FOR INSERT TO tarbiyah_runtime WITH CHECK(EXISTS(SELECT 1 FROM app.session_roster sr WHERE sr.id=session_metric_records.roster_id AND app.actor_can_operate_session(session_metric_records.workspace_id,sr.session_occurrence_id)));
CREATE POLICY records_operate_update ON app.session_metric_records FOR UPDATE TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.session_roster sr WHERE sr.id=session_metric_records.roster_id AND app.actor_can_operate_session(session_metric_records.workspace_id,sr.session_occurrence_id))) WITH CHECK(EXISTS(SELECT 1 FROM app.session_roster sr WHERE sr.id=session_metric_records.roster_id AND app.actor_can_operate_session(session_metric_records.workspace_id,sr.session_occurrence_id)));
CREATE POLICY corrections_operate_insert ON app.session_corrections FOR INSERT TO tarbiyah_runtime WITH CHECK(actor_account_id=app.request_account_id() AND app.actor_can_operate_session(workspace_id,session_occurrence_id));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON app.session_definitions,app.session_metric_definitions,app.session_occurrences,app.session_roster,app.attendance,app.session_metric_records,app.session_corrections FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON app.session_definitions,app.session_metric_definitions,app.session_occurrences,app.session_roster,app.attendance,app.session_metric_records,app.session_corrections FROM authenticated; END IF;
END $$;
