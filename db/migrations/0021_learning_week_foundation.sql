CREATE TYPE app.assignment_submission_status AS ENUM ('SUBMITTED','REVIEWED');
CREATE TYPE app.exam_result_status AS ENUM ('DRAFT','PUBLISHED');
CREATE TYPE app.student_week_status AS ENUM ('OPEN','READY','APPROVED');

CREATE TABLE app.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  plan_week_id uuid NOT NULL, title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 10000), published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), UNIQUE(plan_week_id,title),
  FOREIGN KEY(workspace_id,plan_week_id) REFERENCES app.plan_weeks(workspace_id,id)
);
CREATE TABLE app.assignment_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  plan_week_id uuid NOT NULL, title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
  instructions text NOT NULL CHECK(char_length(instructions) BETWEEN 1 AND 5000), due_day_offset smallint NOT NULL CHECK(due_day_offset BETWEEN 0 AND 6),
  max_score numeric(10,2) NOT NULL CHECK(max_score>0), weight numeric(8,4) NOT NULL DEFAULT 1 CHECK(weight>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  UNIQUE(workspace_id,id), UNIQUE(plan_week_id,title), FOREIGN KEY(workspace_id,plan_week_id) REFERENCES app.plan_weeks(workspace_id,id)
);
CREATE TABLE app.exam_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  plan_week_id uuid NOT NULL, title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
  day_offset smallint NOT NULL CHECK(day_offset BETWEEN 0 AND 6), max_score numeric(10,2) NOT NULL CHECK(max_score>0),
  weight numeric(8,4) NOT NULL DEFAULT 1 CHECK(weight>=0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0), UNIQUE(workspace_id,id), UNIQUE(plan_week_id,title),
  FOREIGN KEY(workspace_id,plan_week_id) REFERENCES app.plan_weeks(workspace_id,id)
);

CREATE TABLE app.assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  enrollment_id uuid NOT NULL, assignment_definition_id uuid NOT NULL, answer text NOT NULL CHECK(char_length(answer) BETWEEN 1 AND 10000),
  submitted_by_account_id uuid NOT NULL, submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status app.assignment_submission_status NOT NULL DEFAULT 'SUBMITTED', score numeric(10,2),
  internal_notes text CHECK(internal_notes IS NULL OR char_length(internal_notes)<=5000),
  student_feedback text CHECK(student_feedback IS NULL OR char_length(student_feedback)<=5000), feedback_published_at timestamptz,
  current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(workspace_id,id), UNIQUE(enrollment_id,assignment_definition_id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,assignment_definition_id) REFERENCES app.assignment_definitions(workspace_id,id),
  FOREIGN KEY(workspace_id,submitted_by_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE TABLE app.assignment_submission_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  submission_id uuid NOT NULL, submission_version integer NOT NULL, answer text NOT NULL, status app.assignment_submission_status NOT NULL,
  score numeric(10,2), internal_notes text, student_feedback text, feedback_published_at timestamptz,
  actor_account_id uuid NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(submission_id,submission_version), FOREIGN KEY(workspace_id,submission_id) REFERENCES app.assignment_submissions(workspace_id,id)
);
CREATE TABLE app.exam_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), enrollment_id uuid NOT NULL,
  exam_definition_id uuid NOT NULL, score numeric(10,2) NOT NULL, internal_notes text CHECK(internal_notes IS NULL OR char_length(internal_notes)<=5000),
  student_feedback text CHECK(student_feedback IS NULL OR char_length(student_feedback)<=5000), status app.exam_result_status NOT NULL DEFAULT 'DRAFT',
  published_at timestamptz, recorded_by_account_id uuid NOT NULL, current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id), UNIQUE(enrollment_id,exam_definition_id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,exam_definition_id) REFERENCES app.exam_definitions(workspace_id,id),
  FOREIGN KEY(workspace_id,recorded_by_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE TABLE app.exam_result_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), result_id uuid NOT NULL,
  result_version integer NOT NULL, score numeric(10,2) NOT NULL, internal_notes text, student_feedback text,
  status app.exam_result_status NOT NULL, published_at timestamptz, actor_account_id uuid NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(result_id,result_version),
  FOREIGN KEY(workspace_id,result_id) REFERENCES app.exam_results(workspace_id,id)
);
CREATE TABLE app.student_self_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), enrollment_id uuid NOT NULL,
  plan_week_id uuid NOT NULL, rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5), reflection text NOT NULL CHECK(char_length(reflection) BETWEEN 3 AND 5000),
  current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0), row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(workspace_id,id), UNIQUE(enrollment_id,plan_week_id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id), FOREIGN KEY(workspace_id,plan_week_id) REFERENCES app.plan_weeks(workspace_id,id)
);
CREATE TABLE app.student_week_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), enrollment_id uuid NOT NULL,
  plan_week_id uuid NOT NULL, status app.student_week_status NOT NULL DEFAULT 'OPEN', coverage numeric(8,5) NOT NULL CHECK(coverage BETWEEN 0 AND 1),
  score numeric(8,3) CHECK(score BETWEEN 0 AND 100), evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
  rule_snapshot jsonb NOT NULL CHECK(jsonb_typeof(rule_snapshot)='object'), current_revision integer NOT NULL DEFAULT 0 CHECK(current_revision>=0),
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id), UNIQUE(enrollment_id,plan_week_id), FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,plan_week_id) REFERENCES app.plan_weeks(workspace_id,id)
);
CREATE TABLE app.student_week_approval_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), summary_id uuid NOT NULL,
  approval_revision integer NOT NULL CHECK(approval_revision>0), snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  approved_by_account_id uuid NOT NULL, reason text, approved_at timestamptz NOT NULL DEFAULT clock_timestamp(), request_id uuid NOT NULL,
  UNIQUE(summary_id,approval_revision), UNIQUE(request_id), FOREIGN KEY(workspace_id,summary_id) REFERENCES app.student_week_summaries(workspace_id,id)
);

CREATE FUNCTION app.capture_assignment_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.current_version<>OLD.current_version THEN
    INSERT INTO app.assignment_submission_revisions(workspace_id,submission_id,submission_version,answer,status,score,internal_notes,student_feedback,feedback_published_at,actor_account_id,reason)
    VALUES(NEW.workspace_id,NEW.id,NEW.current_version,NEW.answer,NEW.status,NEW.score,NEW.internal_notes,NEW.student_feedback,NEW.feedback_published_at,app.request_account_id(),NULL);
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER assignment_submission_revision AFTER INSERT OR UPDATE ON app.assignment_submissions FOR EACH ROW EXECUTE FUNCTION app.capture_assignment_revision();
CREATE FUNCTION app.capture_exam_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.current_version<>OLD.current_version THEN
    INSERT INTO app.exam_result_revisions(workspace_id,result_id,result_version,score,internal_notes,student_feedback,status,published_at,actor_account_id,reason)
    VALUES(NEW.workspace_id,NEW.id,NEW.current_version,NEW.score,NEW.internal_notes,NEW.student_feedback,NEW.status,NEW.published_at,app.request_account_id(),NULL);
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER exam_result_revision AFTER INSERT OR UPDATE ON app.exam_results FOR EACH ROW EXECUTE FUNCTION app.capture_exam_revision();
CREATE TRIGGER assignment_revision_immutable BEFORE UPDATE OR DELETE ON app.assignment_submission_revisions FOR EACH ROW EXECUTE FUNCTION app.immutable_tracking_history();
CREATE TRIGGER exam_revision_immutable BEFORE UPDATE OR DELETE ON app.exam_result_revisions FOR EACH ROW EXECUTE FUNCTION app.immutable_tracking_history();
CREATE TRIGGER week_approval_immutable BEFORE UPDATE OR DELETE ON app.student_week_approval_revisions FOR EACH ROW EXECUTE FUNCTION app.immutable_tracking_history();
