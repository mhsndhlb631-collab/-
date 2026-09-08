CREATE TYPE app.record_status AS ENUM ('DRAFT','ACTIVE','ARCHIVED');
CREATE TYPE app.plan_status AS ENUM ('DRAFT','PUBLISHED','SUPERSEDED');

CREATE TABLE app.program_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
  level text NOT NULL CHECK(char_length(level) BETWEEN 1 AND 80),
  status app.record_status NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,name)
);

CREATE TABLE app.cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
  source_template_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK(ends_on>=starts_on),
  status app.record_status NOT NULL DEFAULT 'DRAFT',
  current_plan_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,name),
  FOREIGN KEY(workspace_id,source_template_id) REFERENCES app.program_templates(workspace_id,id)
);

CREATE TABLE app.program_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  template_id uuid,
  cohort_id uuid,
  copied_from_plan_id uuid,
  version integer NOT NULL CHECK(version>0),
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
  status app.plan_status NOT NULL DEFAULT 'DRAFT',
  scoring_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(scoring_rules)='object'),
  attention_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(attention_rules)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,template_id) REFERENCES app.program_templates(workspace_id,id),
  FOREIGN KEY(workspace_id,cohort_id) REFERENCES app.cohorts(workspace_id,id),
  FOREIGN KEY(workspace_id,copied_from_plan_id) REFERENCES app.program_plans(workspace_id,id),
  CHECK((template_id IS NULL)<>(cohort_id IS NULL))
);
CREATE UNIQUE INDEX program_plan_template_version ON app.program_plans(template_id,version) WHERE template_id IS NOT NULL;
CREATE UNIQUE INDEX program_plan_cohort_version ON app.program_plans(cohort_id,version) WHERE cohort_id IS NOT NULL;
ALTER TABLE app.cohorts ADD CONSTRAINT cohort_current_plan_fk
  FOREIGN KEY(workspace_id,current_plan_id) REFERENCES app.program_plans(workspace_id,id);

CREATE TABLE app.plan_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  plan_id uuid NOT NULL,
  week_number integer NOT NULL CHECK(week_number>0),
  week_type text NOT NULL CHECK(week_type IN ('STANDARD','BREAK','EXAM','CUSTOM')),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
  objectives jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(objectives)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  UNIQUE(plan_id,week_number),
  FOREIGN KEY(workspace_id,plan_id) REFERENCES app.program_plans(workspace_id,id)
);

CREATE TABLE app.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  cohort_id uuid NOT NULL,
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
  status app.record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  UNIQUE(cohort_id,name),
  FOREIGN KEY(workspace_id,cohort_id) REFERENCES app.cohorts(workspace_id,id)
);

CREATE TABLE app.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  student_profile_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  UNIQUE(student_profile_id,cohort_id),
  FOREIGN KEY(workspace_id,student_profile_id) REFERENCES app.student_profiles(workspace_id,id),
  FOREIGN KEY(workspace_id,cohort_id) REFERENCES app.cohorts(workspace_id,id),
  CHECK(effective_to IS NULL OR effective_to>effective_from)
);

CREATE TABLE app.group_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  enrollment_id uuid NOT NULL,
  group_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,group_id) REFERENCES app.groups(workspace_id,id),
  CHECK(effective_to IS NULL OR effective_to>effective_from)
);

CREATE TABLE app.mentor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  group_id uuid NOT NULL,
  mentor_person_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,group_id) REFERENCES app.groups(workspace_id,id),
  FOREIGN KEY(workspace_id,mentor_person_id) REFERENCES app.persons(workspace_id,id),
  CHECK(effective_to IS NULL OR effective_to>effective_from)
);

CREATE FUNCTION app.prevent_membership_overlap() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
DECLARE conflict_found boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('group_memberships:'||NEW.enrollment_id::text,0));
  SELECT EXISTS(SELECT 1 FROM app.group_memberships x WHERE x.enrollment_id=NEW.enrollment_id
    AND x.id<>NEW.id AND tstzrange(x.effective_from,x.effective_to,'[)') && tstzrange(NEW.effective_from,NEW.effective_to,'[)')) INTO conflict_found;
  IF conflict_found THEN RAISE EXCEPTION 'effective period overlap' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER group_membership_no_overlap BEFORE INSERT OR UPDATE ON app.group_memberships
FOR EACH ROW EXECUTE FUNCTION app.prevent_membership_overlap();

CREATE FUNCTION app.prevent_mentor_assignment_overlap() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
DECLARE conflict_found boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('mentor_assignments:'||NEW.group_id::text,0));
  SELECT EXISTS(SELECT 1 FROM app.mentor_assignments x WHERE x.group_id=NEW.group_id
    AND x.id<>NEW.id AND tstzrange(x.effective_from,x.effective_to,'[)') && tstzrange(NEW.effective_from,NEW.effective_to,'[)')) INTO conflict_found;
  IF conflict_found THEN RAISE EXCEPTION 'effective period overlap' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mentor_assignment_no_overlap BEFORE INSERT OR UPDATE ON app.mentor_assignments
FOR EACH ROW EXECUTE FUNCTION app.prevent_mentor_assignment_overlap();

CREATE FUNCTION app.validate_membership_cohort() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM app.enrollments e JOIN app.groups g
      ON g.workspace_id=e.workspace_id AND g.cohort_id=e.cohort_id
    WHERE e.workspace_id=NEW.workspace_id AND e.id=NEW.enrollment_id AND g.id=NEW.group_id
  ) THEN RAISE EXCEPTION 'membership cohort mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_same_cohort BEFORE INSERT OR UPDATE ON app.group_memberships
FOR EACH ROW EXECUTE FUNCTION app.validate_membership_cohort();

CREATE FUNCTION app.validate_cohort_current_plan() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.current_plan_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM app.program_plans p WHERE p.workspace_id=NEW.workspace_id
      AND p.id=NEW.current_plan_id AND p.cohort_id=NEW.id AND p.status='PUBLISHED'
  ) THEN RAISE EXCEPTION 'invalid current cohort plan' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cohort_current_plan_valid BEFORE INSERT OR UPDATE ON app.cohorts
FOR EACH ROW EXECUTE FUNCTION app.validate_cohort_current_plan();

CREATE FUNCTION app.plan_immutable_when_published() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN
  IF OLD.status<>'DRAFT' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'published plan is immutable' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=clock_timestamp(); NEW.row_version:=OLD.row_version+1; RETURN NEW;
END $$;
CREATE TRIGGER plan_immutable BEFORE UPDATE ON app.program_plans
FOR EACH ROW EXECUTE FUNCTION app.plan_immutable_when_published();

CREATE FUNCTION app.week_plan_is_draft() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
DECLARE target_plan uuid;
BEGIN
  target_plan := CASE WHEN TG_OP='DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;
  IF NOT EXISTS(SELECT 1 FROM app.program_plans p WHERE p.id=target_plan AND p.status='DRAFT') THEN
    RAISE EXCEPTION 'published plan weeks are immutable' USING ERRCODE='23514';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER week_requires_draft_plan BEFORE INSERT OR UPDATE OR DELETE ON app.plan_weeks
FOR EACH ROW EXECUTE FUNCTION app.week_plan_is_draft();

CREATE FUNCTION app.actor_can_read_group(target_workspace uuid,target_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.actor_allows(target_workspace,NULL,true) OR EXISTS(
   SELECT 1 FROM app.login_accounts a
   WHERE a.id=app.request_account_id() AND a.workspace_id=target_workspace AND (
     (a.role='MENTOR' AND EXISTS(SELECT 1 FROM app.mentor_assignments ma
       WHERE ma.workspace_id=target_workspace AND ma.group_id=target_group
       AND ma.mentor_person_id=a.person_id AND ma.effective_from<=clock_timestamp()
       AND (ma.effective_to IS NULL OR ma.effective_to>clock_timestamp()))) OR
     (a.role='STUDENT' AND EXISTS(SELECT 1 FROM app.student_profiles sp
       JOIN app.enrollments e ON e.workspace_id=sp.workspace_id AND e.student_profile_id=sp.id
       JOIN app.group_memberships gm ON gm.workspace_id=e.workspace_id AND gm.enrollment_id=e.id
       WHERE sp.workspace_id=target_workspace AND sp.person_id=a.person_id AND gm.group_id=target_group
       AND e.effective_from<=clock_timestamp() AND (e.effective_to IS NULL OR e.effective_to>clock_timestamp())
       AND gm.effective_from<=clock_timestamp() AND (gm.effective_to IS NULL OR gm.effective_to>clock_timestamp())))
   )
 )
$$;
REVOKE ALL ON FUNCTION app.actor_can_read_group(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_read_group(uuid,uuid) TO tarbiyah_runtime;

CREATE FUNCTION app.actor_can_read_cohort(target_workspace uuid,target_cohort uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.actor_allows(target_workspace,NULL,true) OR EXISTS(
   SELECT 1 FROM app.groups g WHERE g.workspace_id=target_workspace AND g.cohort_id=target_cohort
     AND app.actor_can_read_group(target_workspace,g.id)
 )
$$;
CREATE FUNCTION app.actor_can_read_plan(target_workspace uuid,target_plan uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.program_plans p WHERE p.workspace_id=target_workspace AND p.id=target_plan
   AND (app.actor_allows(target_workspace,NULL,true) OR
     (p.cohort_id IS NOT NULL AND app.actor_can_read_cohort(target_workspace,p.cohort_id))))
$$;
REVOKE ALL ON FUNCTION app.actor_can_read_cohort(uuid,uuid),app.actor_can_read_plan(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_read_cohort(uuid,uuid),app.actor_can_read_plan(uuid,uuid) TO tarbiyah_runtime;

ALTER TABLE app.program_templates ENABLE ROW LEVEL SECURITY; ALTER TABLE app.program_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE app.program_plans ENABLE ROW LEVEL SECURITY; ALTER TABLE app.program_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE app.cohorts ENABLE ROW LEVEL SECURITY; ALTER TABLE app.cohorts FORCE ROW LEVEL SECURITY;
ALTER TABLE app.plan_weeks ENABLE ROW LEVEL SECURITY; ALTER TABLE app.plan_weeks FORCE ROW LEVEL SECURITY;
ALTER TABLE app.groups ENABLE ROW LEVEL SECURITY; ALTER TABLE app.groups FORCE ROW LEVEL SECURITY;
ALTER TABLE app.enrollments ENABLE ROW LEVEL SECURITY; ALTER TABLE app.enrollments FORCE ROW LEVEL SECURITY;
ALTER TABLE app.group_memberships ENABLE ROW LEVEL SECURITY; ALTER TABLE app.group_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE app.mentor_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE app.mentor_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.program_templates,app.program_plans,app.cohorts,app.plan_weeks,app.groups,app.enrollments,app.group_memberships,app.mentor_assignments FROM PUBLIC;
GRANT SELECT ON app.program_templates,app.program_plans,app.cohorts,app.plan_weeks,app.groups,app.enrollments,app.group_memberships,app.mentor_assignments TO tarbiyah_runtime;

CREATE POLICY templates_read ON app.program_templates FOR SELECT TO tarbiyah_runtime USING(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY plans_read ON app.program_plans FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_plan(workspace_id,id));
CREATE POLICY cohorts_read ON app.cohorts FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_cohort(workspace_id,id));
CREATE POLICY weeks_read ON app.plan_weeks FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_plan(workspace_id,plan_id));
CREATE POLICY groups_read ON app.groups FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_group(workspace_id,id));
CREATE POLICY enrollments_read ON app.enrollments FOR SELECT TO tarbiyah_runtime USING(
  app.actor_allows(workspace_id,NULL,true) OR EXISTS(SELECT 1 FROM app.group_memberships gm WHERE gm.enrollment_id=id AND app.actor_can_read_group(workspace_id,gm.group_id)));
CREATE POLICY memberships_read ON app.group_memberships FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_group(workspace_id,group_id));
CREATE POLICY assignments_read ON app.mentor_assignments FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_group(workspace_id,group_id));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON app.program_templates,app.program_plans,app.cohorts,app.plan_weeks,app.groups,app.enrollments,app.group_memberships,app.mentor_assignments FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON app.program_templates,app.program_plans,app.cohorts,app.plan_weeks,app.groups,app.enrollments,app.group_memberships,app.mentor_assignments FROM authenticated;
  END IF;
END $$;
