CREATE TYPE app.tracking_period_kind AS ENUM ('DAILY','WEEKLY');
CREATE TYPE app.tracking_source AS ENUM ('STUDENT','MENTOR','PAPER_TRANSCRIBED');
CREATE TYPE app.tracking_entry_state AS ENUM ('RECORDED','EXEMPT');
CREATE TYPE app.tracking_review_status AS ENUM ('NOT_REQUIRED','PENDING','VERIFIED','NEEDS_CORRECTION');
CREATE TYPE app.tracking_review_decision AS ENUM ('VERIFIED','NEEDS_CORRECTION');

CREATE FUNCTION app.allows_weekly_shape(days smallint[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT cardinality(days)=1
$$;

CREATE TABLE app.tracking_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  plan_id uuid NOT NULL,
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
  meaning text NOT NULL CHECK(char_length(meaning) BETWEEN 1 AND 500),
  unit text CHECK(unit IS NULL OR char_length(unit) BETWEEN 1 AND 40),
  value_type app.metric_value_type NOT NULL,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(constraints)='object'),
  target jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(target)='object'),
  allowed_sources jsonb NOT NULL CHECK(
    jsonb_typeof(allowed_sources)='array' AND jsonb_array_length(allowed_sources)>0
  ),
  allows_batch boolean NOT NULL DEFAULT false,
  allows_weekly_summary boolean NOT NULL DEFAULT false,
  requires_review boolean NOT NULL DEFAULT false,
  weight numeric(8,4) NOT NULL DEFAULT 1 CHECK(weight>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), UNIQUE(plan_id,name),
  FOREIGN KEY(workspace_id,plan_id) REFERENCES app.program_plans(workspace_id,id)
);

CREATE TABLE app.tracking_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  tracking_definition_id uuid NOT NULL,
  period_kind app.tracking_period_kind NOT NULL,
  start_week integer NOT NULL CHECK(start_week>0),
  end_week integer CHECK(end_week IS NULL OR end_week>=start_week),
  days_of_week smallint[] NOT NULL,
  due_time time,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), UNIQUE(tracking_definition_id,start_week),
  FOREIGN KEY(workspace_id,tracking_definition_id) REFERENCES app.tracking_definitions(workspace_id,id),
  CHECK(cardinality(days_of_week)>0 AND days_of_week<@ARRAY[0,1,2,3,4,5,6]::smallint[]),
  CHECK(period_kind='DAILY' OR app.allows_weekly_shape(days_of_week))
);

CREATE TABLE app.tracking_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  enrollment_id uuid NOT NULL,
  tracking_definition_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL CHECK(period_end>=period_start),
  state app.tracking_entry_state NOT NULL DEFAULT 'RECORDED',
  value jsonb,
  source app.tracking_source NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_by_account_id uuid NOT NULL,
  exemption_reason text,
  current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0),
  review_status app.tracking_review_status NOT NULL DEFAULT 'NOT_REQUIRED',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id),
  UNIQUE(enrollment_id,tracking_definition_id,period_start,period_end),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,tracking_definition_id) REFERENCES app.tracking_definitions(workspace_id,id),
  FOREIGN KEY(workspace_id,recorded_by_account_id) REFERENCES app.login_accounts(workspace_id,id),
  CHECK((state='RECORDED' AND value IS NOT NULL AND exemption_reason IS NULL) OR
        (state='EXEMPT' AND value IS NULL AND char_length(exemption_reason) BETWEEN 3 AND 500))
);

CREATE TABLE app.tracking_entry_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  tracking_entry_id uuid NOT NULL,
  entry_version integer NOT NULL CHECK(entry_version>0),
  state app.tracking_entry_state NOT NULL,
  value jsonb,
  source app.tracking_source NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_by_account_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id), UNIQUE(tracking_entry_id,entry_version),
  FOREIGN KEY(workspace_id,tracking_entry_id) REFERENCES app.tracking_entries(workspace_id,id),
  FOREIGN KEY(workspace_id,recorded_by_account_id) REFERENCES app.login_accounts(workspace_id,id)
);

CREATE TABLE app.tracking_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  tracking_entry_id uuid NOT NULL,
  entry_version integer NOT NULL CHECK(entry_version>0),
  decision app.tracking_review_decision NOT NULL,
  reviewer_account_id uuid NOT NULL,
  reason text CHECK(reason IS NULL OR char_length(reason) BETWEEN 3 AND 500),
  request_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id), UNIQUE(tracking_entry_id,entry_version), UNIQUE(request_id),
  FOREIGN KEY(workspace_id,tracking_entry_id) REFERENCES app.tracking_entries(workspace_id,id),
  FOREIGN KEY(workspace_id,reviewer_account_id) REFERENCES app.login_accounts(workspace_id,id),
  CHECK(decision='VERIFIED' OR reason IS NOT NULL)
);

CREATE FUNCTION app.tracking_definition_requires_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target_plan uuid;
BEGIN
  target_plan:=CASE WHEN TG_OP='DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;
  IF NOT EXISTS(SELECT 1 FROM app.program_plans p WHERE p.id=target_plan AND p.status='DRAFT') THEN
    RAISE EXCEPTION 'published tracking definition is immutable' USING ERRCODE='23514';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER tracking_definition_draft BEFORE INSERT OR UPDATE OR DELETE ON app.tracking_definitions
FOR EACH ROW EXECUTE FUNCTION app.tracking_definition_requires_draft();

CREATE FUNCTION app.tracking_schedule_requires_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target_definition uuid;
BEGIN
  target_definition:=CASE WHEN TG_OP='DELETE' THEN OLD.tracking_definition_id ELSE NEW.tracking_definition_id END;
  IF NOT EXISTS(SELECT 1 FROM app.tracking_definitions d JOIN app.program_plans p ON p.id=d.plan_id
    WHERE d.id=target_definition AND p.status='DRAFT') THEN
    RAISE EXCEPTION 'published tracking schedule is immutable' USING ERRCODE='23514';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER tracking_schedule_draft BEFORE INSERT OR UPDATE OR DELETE ON app.tracking_schedules
FOR EACH ROW EXECUTE FUNCTION app.tracking_schedule_requires_draft();

CREATE FUNCTION app.validate_tracking_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d record; e record; s record; week_no integer; actor record; numeric_value numeric;
BEGIN
  SELECT td.*,c.starts_on,c.current_plan_id INTO d FROM app.tracking_definitions td
  JOIN app.enrollments en ON en.id=NEW.enrollment_id AND en.workspace_id=td.workspace_id
  JOIN app.cohorts c ON c.id=en.cohort_id
  WHERE td.id=NEW.tracking_definition_id AND td.plan_id=c.current_plan_id;
  IF d.id IS NULL THEN RAISE EXCEPTION 'tracking definition does not belong to enrollment plan' USING ERRCODE='23514'; END IF;
  SELECT * INTO e FROM app.enrollments WHERE id=NEW.enrollment_id;
  IF NEW.period_start < e.effective_from::date OR (e.effective_to IS NOT NULL AND NEW.period_end>=e.effective_to::date) THEN
    RAISE EXCEPTION 'tracking period outside enrollment' USING ERRCODE='23514';
  END IF;
  week_no:=((NEW.period_start-d.starts_on)/7)+1;
  SELECT * INTO s FROM app.tracking_schedules x WHERE x.tracking_definition_id=d.id
    AND week_no>=x.start_week AND (x.end_week IS NULL OR week_no<=x.end_week)
    AND ((x.period_kind='DAILY' AND NEW.period_end=NEW.period_start AND extract(dow from NEW.period_start)::smallint=ANY(x.days_of_week))
      OR (x.period_kind='WEEKLY' AND NEW.period_start=d.starts_on+(week_no-1)*7 AND NEW.period_end=NEW.period_start+6))
    LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION 'tracking entitlement is not scheduled' USING ERRCODE='23514'; END IF;
  IF NOT d.allowed_sources ? NEW.source::text THEN RAISE EXCEPTION 'tracking source is not allowed' USING ERRCODE='23514'; END IF;
  SELECT role,person_id INTO actor FROM app.login_accounts WHERE id=NEW.recorded_by_account_id;
  IF actor.role='STUDENT' AND (NEW.source<>'STUDENT' OR NEW.state='EXEMPT' OR NOT EXISTS(
    SELECT 1 FROM app.enrollments en JOIN app.student_profiles sp ON sp.id=en.student_profile_id
    WHERE en.id=NEW.enrollment_id AND sp.person_id=actor.person_id)) THEN
    RAISE EXCEPTION 'student tracking write denied' USING ERRCODE='42501';
  END IF;
  IF NEW.state='RECORDED' THEN
    IF d.value_type='BOOLEAN' AND jsonb_typeof(NEW.value)<>'boolean' THEN RAISE EXCEPTION 'invalid tracking value' USING ERRCODE='23514'; END IF;
    IF d.value_type IN ('COUNT','PERCENT','SCORE','DURATION','NUMBER') THEN
      IF jsonb_typeof(NEW.value)<>'number' THEN RAISE EXCEPTION 'invalid tracking value' USING ERRCODE='23514'; END IF;
      numeric_value:=(NEW.value#>>'{}')::numeric;
      IF (d.constraints ? 'min' AND numeric_value<(d.constraints->>'min')::numeric)
        OR (d.constraints ? 'max' AND numeric_value>(d.constraints->>'max')::numeric)
        OR (d.value_type IN ('COUNT','DURATION') AND numeric_value<>trunc(numeric_value)) THEN
        RAISE EXCEPTION 'tracking value outside constraints' USING ERRCODE='23514';
      END IF;
    END IF;
    IF d.value_type IN ('ENUM','SHORT_TEXT') AND jsonb_typeof(NEW.value)<>'string' THEN RAISE EXCEPTION 'invalid tracking value' USING ERRCODE='23514'; END IF;
    IF d.value_type='SHORT_TEXT' AND char_length(NEW.value#>>'{}')>500 THEN RAISE EXCEPTION 'tracking text too long' USING ERRCODE='23514'; END IF;
    IF d.value_type='ENUM' AND NOT d.constraints->'options' ? (NEW.value#>>'{}') THEN RAISE EXCEPTION 'tracking enum option invalid' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.current_version:=1; NEW.row_version:=1;
    NEW.review_status:=CASE WHEN d.requires_review THEN 'PENDING'::app.tracking_review_status ELSE 'NOT_REQUIRED'::app.tracking_review_status END;
  ELSIF ROW(NEW.state,NEW.value,NEW.source,NEW.occurred_at,NEW.exemption_reason) IS DISTINCT FROM
        ROW(OLD.state,OLD.value,OLD.source,OLD.occurred_at,OLD.exemption_reason) THEN
    NEW.current_version:=OLD.current_version+1;
    NEW.review_status:=CASE WHEN d.requires_review THEN 'PENDING'::app.tracking_review_status ELSE 'NOT_REQUIRED'::app.tracking_review_status END;
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER tracking_entry_valid BEFORE INSERT OR UPDATE ON app.tracking_entries
FOR EACH ROW EXECUTE FUNCTION app.validate_tracking_entry();

CREATE FUNCTION app.capture_tracking_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.current_version<>OLD.current_version THEN
    INSERT INTO app.tracking_entry_revisions(workspace_id,tracking_entry_id,entry_version,state,value,source,occurred_at,recorded_by_account_id,reason)
    VALUES(NEW.workspace_id,NEW.id,NEW.current_version,NEW.state,NEW.value,NEW.source,NEW.occurred_at,NEW.recorded_by_account_id,NEW.exemption_reason);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tracking_entry_revision AFTER INSERT OR UPDATE ON app.tracking_entries
FOR EACH ROW EXECUTE FUNCTION app.capture_tracking_revision();

CREATE FUNCTION app.immutable_tracking_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'tracking history is immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER tracking_revision_immutable BEFORE UPDATE OR DELETE ON app.tracking_entry_revisions
FOR EACH ROW EXECUTE FUNCTION app.immutable_tracking_history();
CREATE TRIGGER tracking_review_immutable BEFORE UPDATE OR DELETE ON app.tracking_reviews
FOR EACH ROW EXECUTE FUNCTION app.immutable_tracking_history();
