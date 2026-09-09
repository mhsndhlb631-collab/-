ALTER TABLE app.assignment_submission_revisions ADD CONSTRAINT assignment_revision_actor_fk FOREIGN KEY(workspace_id,actor_account_id) REFERENCES app.login_accounts(workspace_id,id);
ALTER TABLE app.exam_result_revisions ADD CONSTRAINT exam_revision_actor_fk FOREIGN KEY(workspace_id,actor_account_id) REFERENCES app.login_accounts(workspace_id,id);
ALTER TABLE app.student_week_approval_revisions ADD CONSTRAINT week_approval_actor_fk FOREIGN KEY(workspace_id,approved_by_account_id) REFERENCES app.login_accounts(workspace_id,id);

CREATE OR REPLACE FUNCTION app.capture_assignment_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.current_version<>OLD.current_version THEN
    INSERT INTO app.assignment_submission_revisions(workspace_id,submission_id,submission_version,answer,status,score,internal_notes,student_feedback,feedback_published_at,actor_account_id,reason)
    VALUES(NEW.workspace_id,NEW.id,NEW.current_version,NEW.answer,NEW.status,NEW.score,NEW.internal_notes,NEW.student_feedback,NEW.feedback_published_at,app.request_account_id(),nullif(current_setting('app.correction_reason',true),''));
  END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION app.capture_exam_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.current_version<>OLD.current_version THEN
    INSERT INTO app.exam_result_revisions(workspace_id,result_id,result_version,score,internal_notes,student_feedback,status,published_at,actor_account_id,reason)
    VALUES(NEW.workspace_id,NEW.id,NEW.current_version,NEW.score,NEW.internal_notes,NEW.student_feedback,NEW.status,NEW.published_at,app.request_account_id(),nullif(current_setting('app.correction_reason',true),''));
  END IF; RETURN NEW;
END $$;

CREATE TABLE app.student_self_review_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id), self_review_id uuid NOT NULL,
  review_version integer NOT NULL CHECK(review_version>0), rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5), reflection text NOT NULL,
  actor_account_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(self_review_id,review_version),
  FOREIGN KEY(workspace_id,self_review_id) REFERENCES app.student_self_reviews(workspace_id,id),
  FOREIGN KEY(workspace_id,actor_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE FUNCTION app.capture_self_review_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.current_version<>OLD.current_version THEN
    INSERT INTO app.student_self_review_revisions(workspace_id,self_review_id,review_version,rating,reflection,actor_account_id)
    VALUES(NEW.workspace_id,NEW.id,NEW.current_version,NEW.rating,NEW.reflection,app.request_account_id());
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER self_review_revision AFTER INSERT OR UPDATE ON app.student_self_reviews FOR EACH ROW EXECUTE FUNCTION app.capture_self_review_revision();
CREATE TRIGGER self_review_revision_immutable BEFORE UPDATE OR DELETE ON app.student_self_review_revisions FOR EACH ROW EXECUTE FUNCTION app.immutable_tracking_history();
ALTER TABLE app.student_self_review_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.student_self_review_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.student_self_review_revisions FROM PUBLIC;
GRANT SELECT ON app.student_self_review_revisions TO tarbiyah_runtime;
CREATE POLICY self_review_revision_read ON app.student_self_review_revisions FOR SELECT TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.student_self_reviews r WHERE r.id=self_review_id));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON app.student_self_review_revisions FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON app.student_self_review_revisions FROM authenticated; END IF;
END $$;
