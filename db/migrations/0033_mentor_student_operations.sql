-- Flexible mentor operations extend the canonical assignment definition.
ALTER TABLE app.assignment_definitions ALTER COLUMN plan_week_id DROP NOT NULL;
ALTER TABLE app.assignment_definitions ALTER COLUMN due_day_offset DROP NOT NULL;
ALTER TABLE app.assignment_definitions
  ADD COLUMN group_id uuid,
  ADD COLUMN created_by_account_id uuid,
  ADD COLUMN category text,
  ADD COLUMN custom_category text,
  ADD COLUMN scope text NOT NULL DEFAULT 'GROUP' CHECK(scope IN ('GROUP','INDIVIDUAL')),
  ADD COLUMN measurement_mode text NOT NULL DEFAULT 'SCORE' CHECK(measurement_mode IN ('BOOLEAN','SCORE','PERCENT','COUNT','DURATION','CHOICE','LEVEL','TEXT','ATTENDANCE','RUBRIC')),
  ADD COLUMN recurrence jsonb NOT NULL DEFAULT '{"kind":"ONCE"}'::jsonb CHECK(jsonb_typeof(recurrence)='object'),
  ADD COLUMN starts_on date,
  ADD COLUMN ends_on date,
  ADD COLUMN due_time time,
  ADD COLUMN timezone text,
  ADD COLUMN mandatory boolean NOT NULL DEFAULT true,
  ADD COLUMN requires_note boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_evidence boolean NOT NULL DEFAULT false,
  ADD COLUMN pass_score numeric(10,2),
  ADD COLUMN completion_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(completion_rules)='object'),
  ADD COLUMN choices jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(choices)='array'),
  ADD COLUMN rubric jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(rubric)='array'),
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('DRAFT','ACTIVE','ARCHIVED')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT assignment_group_fk FOREIGN KEY(workspace_id,group_id) REFERENCES app.groups(workspace_id,id),
  ADD CONSTRAINT assignment_creator_fk FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES app.login_accounts(workspace_id,id),
  ADD CONSTRAINT assignment_operational_shape CHECK(
    (plan_week_id IS NOT NULL AND group_id IS NULL) OR
    (plan_week_id IS NULL AND group_id IS NOT NULL AND created_by_account_id IS NOT NULL AND starts_on IS NOT NULL)
  ),
  ADD CONSTRAINT assignment_dates_valid CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on>=starts_on),
  ADD CONSTRAINT assignment_pass_valid CHECK(pass_score IS NULL OR (pass_score>=0 AND pass_score<=max_score));

CREATE TABLE app.assignment_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  assignment_definition_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(assignment_definition_id,enrollment_id), UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,assignment_definition_id) REFERENCES app.assignment_definitions(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id)
);

CREATE TABLE app.assignment_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  assignment_definition_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(assignment_definition_id,due_at), UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,assignment_definition_id) REFERENCES app.assignment_definitions(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE app.assignment_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  occurrence_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  value jsonb,
  normalized_score numeric(7,4) CHECK(normalized_score IS NULL OR normalized_score BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'MISSING' CHECK(status IN ('MISSING','PARTIAL','COMPLETED','EXCUSED')),
  evidence_url text CHECK(evidence_url IS NULL OR char_length(evidence_url)<=2000),
  recorded_by_account_id uuid,
  evaluated_at timestamptz,
  current_revision integer NOT NULL DEFAULT 0 CHECK(current_revision>=0),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(occurrence_id,enrollment_id), UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,occurrence_id) REFERENCES app.assignment_occurrences(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,recorded_by_account_id) REFERENCES app.login_accounts(workspace_id,id)
);

CREATE TABLE app.assignment_evaluation_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  evaluation_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  actor_account_id uuid NOT NULL, reason text CHECK(reason IS NULL OR char_length(reason)<=500), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(evaluation_id,revision),
  FOREIGN KEY(workspace_id,evaluation_id) REFERENCES app.assignment_evaluations(workspace_id,id),
  FOREIGN KEY(workspace_id,actor_account_id) REFERENCES app.login_accounts(workspace_id,id)
);

CREATE TABLE app.assignment_evaluation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  evaluation_id uuid NOT NULL, body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 5000),
  visibility text NOT NULL DEFAULT 'STAFF' CHECK(visibility IN ('STAFF','STUDENT')),
  author_account_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,evaluation_id) REFERENCES app.assignment_evaluations(workspace_id,id),
  FOREIGN KEY(workspace_id,author_account_id) REFERENCES app.login_accounts(workspace_id,id)
);

CREATE INDEX assignment_definitions_group_active ON app.assignment_definitions(group_id,status,starts_on) WHERE group_id IS NOT NULL;
CREATE INDEX assignment_occurrences_due ON app.assignment_occurrences(workspace_id,due_at,status);
CREATE INDEX assignment_evaluations_student ON app.assignment_evaluations(enrollment_id,status,updated_at DESC);
CREATE INDEX assignment_notes_evaluation ON app.assignment_evaluation_notes(evaluation_id,created_at DESC);

-- A mentor may create a student only through the scoped application command;
-- enrollment and membership checks keep the resulting student in an assigned group.
CREATE POLICY persons_mentor_insert ON app.persons FOR INSERT TO tarbiyah_runtime
  WITH CHECK(EXISTS(SELECT 1 FROM app.login_accounts a WHERE a.id=app.request_account_id() AND a.workspace_id=persons.workspace_id AND a.role='MENTOR'));
CREATE POLICY student_profiles_mentor_insert ON app.student_profiles FOR INSERT TO tarbiyah_runtime
  WITH CHECK(EXISTS(SELECT 1 FROM app.login_accounts a WHERE a.id=app.request_account_id() AND a.workspace_id=student_profiles.workspace_id AND a.role='MENTOR'));
CREATE POLICY enrollments_mentor_insert ON app.enrollments FOR INSERT TO tarbiyah_runtime
  WITH CHECK(EXISTS(SELECT 1 FROM app.login_accounts a WHERE a.id=app.request_account_id() AND a.workspace_id=enrollments.workspace_id AND a.role='MENTOR'));
CREATE POLICY memberships_mentor_insert ON app.group_memberships FOR INSERT TO tarbiyah_runtime
  WITH CHECK(app.actor_can_read_group(workspace_id,group_id));
GRANT INSERT ON app.persons,app.student_profiles,app.enrollments,app.group_memberships TO tarbiyah_runtime;

CREATE FUNCTION app.actor_can_manage_assignment(target_workspace uuid,target_assignment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(
    SELECT 1 FROM app.assignment_definitions d JOIN app.login_accounts a ON a.id=app.request_account_id()
    WHERE d.id=target_assignment AND d.workspace_id=target_workspace AND a.workspace_id=target_workspace
      AND (a.role='RESPONSIBLE' OR (a.role='MENTOR' AND d.group_id IS NOT NULL AND app.actor_can_read_group(target_workspace,d.group_id)))
  )
$$;
REVOKE ALL ON FUNCTION app.actor_can_manage_assignment(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_manage_assignment(uuid,uuid) TO tarbiyah_runtime;

DROP POLICY assignment_definition_read ON app.assignment_definitions;
DROP POLICY assignment_definition_write ON app.assignment_definitions;
CREATE POLICY assignment_definition_read ON app.assignment_definitions FOR SELECT TO tarbiyah_runtime USING(
  (plan_week_id IS NOT NULL AND app.actor_can_read_plan(workspace_id,(SELECT plan_id FROM app.plan_weeks WHERE id=plan_week_id))) OR
  (group_id IS NOT NULL AND app.actor_can_read_group(workspace_id,group_id))
);
CREATE POLICY assignment_definition_insert ON app.assignment_definitions FOR INSERT TO tarbiyah_runtime WITH CHECK(
  app.actor_allows(workspace_id,NULL,true) OR
  ((SELECT role FROM app.login_accounts WHERE id=app.request_account_id())='MENTOR' AND created_by_account_id=app.request_account_id() AND group_id IS NOT NULL AND app.actor_can_read_group(workspace_id,group_id))
);
CREATE POLICY assignment_definition_update ON app.assignment_definitions FOR UPDATE TO tarbiyah_runtime
  USING(app.actor_can_manage_assignment(workspace_id,id)) WITH CHECK(app.actor_can_manage_assignment(workspace_id,id));

ALTER TABLE app.assignment_targets ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assignment_targets FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_occurrences ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assignment_occurrences FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_evaluations ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assignment_evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_evaluation_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assignment_evaluation_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_evaluation_notes ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assignment_evaluation_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.assignment_targets,app.assignment_occurrences,app.assignment_evaluations,app.assignment_evaluation_revisions,app.assignment_evaluation_notes FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON app.assignment_targets TO tarbiyah_runtime;
GRANT SELECT,INSERT,UPDATE ON app.assignment_occurrences,app.assignment_evaluations TO tarbiyah_runtime;
GRANT SELECT,INSERT ON app.assignment_evaluation_revisions,app.assignment_evaluation_notes TO tarbiyah_runtime;

CREATE POLICY assignment_targets_access ON app.assignment_targets FOR ALL TO tarbiyah_runtime
  USING(app.actor_can_manage_assignment(workspace_id,assignment_definition_id))
  WITH CHECK(app.actor_can_manage_assignment(workspace_id,assignment_definition_id) AND app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,clock_timestamp(),true));
CREATE POLICY assignment_occurrences_read ON app.assignment_occurrences FOR SELECT TO tarbiyah_runtime
  USING(EXISTS(SELECT 1 FROM app.assignment_definitions d WHERE d.id=assignment_definition_id));
CREATE POLICY assignment_occurrences_write ON app.assignment_occurrences FOR ALL TO tarbiyah_runtime
  USING(app.actor_can_manage_assignment(workspace_id,assignment_definition_id)) WITH CHECK(app.actor_can_manage_assignment(workspace_id,assignment_definition_id));
CREATE POLICY assignment_evaluations_read ON app.assignment_evaluations FOR SELECT TO tarbiyah_runtime
  USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,coalesce(evaluated_at,created_at),false));
CREATE POLICY assignment_evaluations_write ON app.assignment_evaluations FOR ALL TO tarbiyah_runtime
  USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,coalesce(evaluated_at,created_at),true))
  WITH CHECK(recorded_by_account_id=app.request_account_id() AND app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,coalesce(evaluated_at,created_at),true));
CREATE POLICY assignment_evaluation_revisions_read ON app.assignment_evaluation_revisions FOR SELECT TO tarbiyah_runtime
  USING(EXISTS(SELECT 1 FROM app.assignment_evaluations e WHERE e.id=evaluation_id));
CREATE POLICY assignment_evaluation_revisions_insert ON app.assignment_evaluation_revisions FOR INSERT TO tarbiyah_runtime
  WITH CHECK(actor_account_id=app.request_account_id() AND EXISTS(SELECT 1 FROM app.assignment_evaluations e WHERE e.id=evaluation_id AND app.actor_can_access_tracking_enrollment(e.workspace_id,e.enrollment_id,e.updated_at,true)));
CREATE POLICY assignment_evaluation_notes_read ON app.assignment_evaluation_notes FOR SELECT TO tarbiyah_runtime
  USING(EXISTS(SELECT 1 FROM app.assignment_evaluations e WHERE e.id=evaluation_id AND app.actor_can_access_tracking_enrollment(e.workspace_id,e.enrollment_id,e.updated_at,false)));
CREATE POLICY assignment_evaluation_notes_insert ON app.assignment_evaluation_notes FOR INSERT TO tarbiyah_runtime
  WITH CHECK(author_account_id=app.request_account_id() AND EXISTS(SELECT 1 FROM app.assignment_evaluations e WHERE e.id=evaluation_id AND app.actor_can_access_tracking_enrollment(e.workspace_id,e.enrollment_id,e.updated_at,true)));

CREATE TRIGGER assignment_evaluation_revision_immutable BEFORE UPDATE OR DELETE ON app.assignment_evaluation_revisions FOR EACH ROW EXECUTE FUNCTION app.immutable_tracking_history();
CREATE TRIGGER assignment_evaluation_note_immutable BEFORE UPDATE OR DELETE ON app.assignment_evaluation_notes FOR EACH ROW EXECUTE FUNCTION app.immutable_tracking_history();

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON app.assignment_targets,app.assignment_occurrences,app.assignment_evaluations,app.assignment_evaluation_revisions,app.assignment_evaluation_notes FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON app.assignment_targets,app.assignment_occurrences,app.assignment_evaluations,app.assignment_evaluation_revisions,app.assignment_evaluation_notes FROM authenticated;
  END IF;
END $$;
