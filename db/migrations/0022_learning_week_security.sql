ALTER TABLE app.content_items ENABLE ROW LEVEL SECURITY; ALTER TABLE app.content_items FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assignment_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.exam_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.exam_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_submissions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assignment_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.assignment_submission_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assignment_submission_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.exam_results ENABLE ROW LEVEL SECURITY; ALTER TABLE app.exam_results FORCE ROW LEVEL SECURITY;
ALTER TABLE app.exam_result_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.exam_result_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.student_self_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE app.student_self_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE app.student_week_summaries ENABLE ROW LEVEL SECURITY; ALTER TABLE app.student_week_summaries FORCE ROW LEVEL SECURITY;
ALTER TABLE app.student_week_approval_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.student_week_approval_revisions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON app.content_items,app.assignment_definitions,app.exam_definitions,app.assignment_submissions,app.assignment_submission_revisions,app.exam_results,app.exam_result_revisions,app.student_self_reviews,app.student_week_summaries,app.student_week_approval_revisions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON app.content_items,app.assignment_definitions,app.exam_definitions TO tarbiyah_runtime;
GRANT SELECT,INSERT,UPDATE ON app.assignment_submissions,app.exam_results,app.student_self_reviews,app.student_week_summaries TO tarbiyah_runtime;
GRANT SELECT ON app.assignment_submission_revisions,app.exam_result_revisions,app.student_week_approval_revisions TO tarbiyah_runtime;
GRANT INSERT ON app.student_week_approval_revisions TO tarbiyah_runtime;

CREATE POLICY content_read ON app.content_items FOR SELECT TO tarbiyah_runtime USING(
  app.actor_can_read_plan(workspace_id,(SELECT plan_id FROM app.plan_weeks WHERE id=plan_week_id)) AND
  ((SELECT role FROM app.login_accounts WHERE id=app.request_account_id())<>'STUDENT' OR published_at IS NOT NULL));
CREATE POLICY content_write ON app.content_items FOR ALL TO tarbiyah_runtime USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY assignment_definition_read ON app.assignment_definitions FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_plan(workspace_id,(SELECT plan_id FROM app.plan_weeks WHERE id=plan_week_id)));
CREATE POLICY assignment_definition_write ON app.assignment_definitions FOR ALL TO tarbiyah_runtime USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY exam_definition_read ON app.exam_definitions FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_plan(workspace_id,(SELECT plan_id FROM app.plan_weeks WHERE id=plan_week_id)));
CREATE POLICY exam_definition_write ON app.exam_definitions FOR ALL TO tarbiyah_runtime USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));

CREATE POLICY assignment_submission_read ON app.assignment_submissions FOR SELECT TO tarbiyah_runtime USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,submitted_at,false));
CREATE POLICY assignment_submission_insert ON app.assignment_submissions FOR INSERT TO tarbiyah_runtime WITH CHECK(submitted_by_account_id=app.request_account_id() AND app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,submitted_at,true));
CREATE POLICY assignment_submission_update ON app.assignment_submissions FOR UPDATE TO tarbiyah_runtime USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,submitted_at,true)) WITH CHECK(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,submitted_at,true));
CREATE POLICY assignment_revision_read ON app.assignment_submission_revisions FOR SELECT TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.assignment_submissions s WHERE s.id=submission_id));
CREATE POLICY exam_result_read ON app.exam_results FOR SELECT TO tarbiyah_runtime USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,false) AND ((SELECT role FROM app.login_accounts WHERE id=app.request_account_id())<>'STUDENT' OR status='PUBLISHED'));
CREATE POLICY exam_result_write ON app.exam_results FOR ALL TO tarbiyah_runtime USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,true) AND (SELECT role FROM app.login_accounts WHERE id=app.request_account_id())<>'STUDENT') WITH CHECK(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,true) AND (SELECT role FROM app.login_accounts WHERE id=app.request_account_id())<>'STUDENT');
CREATE POLICY exam_revision_read ON app.exam_result_revisions FOR SELECT TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.exam_results r WHERE r.id=result_id));
CREATE POLICY self_review_read ON app.student_self_reviews FOR SELECT TO tarbiyah_runtime USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,false));
CREATE POLICY self_review_write ON app.student_self_reviews FOR ALL TO tarbiyah_runtime USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,true) AND (SELECT person_id FROM app.login_accounts WHERE id=app.request_account_id())=(SELECT sp.person_id FROM app.enrollments e JOIN app.student_profiles sp ON sp.id=e.student_profile_id WHERE e.id=enrollment_id)) WITH CHECK(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,true) AND (SELECT person_id FROM app.login_accounts WHERE id=app.request_account_id())=(SELECT sp.person_id FROM app.enrollments e JOIN app.student_profiles sp ON sp.id=e.student_profile_id WHERE e.id=enrollment_id));
CREATE POLICY week_summary_read ON app.student_week_summaries FOR SELECT TO tarbiyah_runtime USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,false));
CREATE POLICY week_summary_write ON app.student_week_summaries FOR ALL TO tarbiyah_runtime USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,true) AND (SELECT role FROM app.login_accounts WHERE id=app.request_account_id())<>'STUDENT') WITH CHECK(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,updated_at,true) AND (SELECT role FROM app.login_accounts WHERE id=app.request_account_id())<>'STUDENT');
CREATE POLICY week_approval_read ON app.student_week_approval_revisions FOR SELECT TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.student_week_summaries s WHERE s.id=summary_id));
CREATE POLICY week_approval_insert ON app.student_week_approval_revisions FOR INSERT TO tarbiyah_runtime WITH CHECK(approved_by_account_id=app.request_account_id() AND EXISTS(SELECT 1 FROM app.student_week_summaries s WHERE s.id=summary_id AND app.actor_can_access_tracking_enrollment(s.workspace_id,s.enrollment_id,s.updated_at,true)));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON app.content_items,app.assignment_definitions,app.exam_definitions,app.assignment_submissions,app.assignment_submission_revisions,app.exam_results,app.exam_result_revisions,app.student_self_reviews,app.student_week_summaries,app.student_week_approval_revisions FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON app.content_items,app.assignment_definitions,app.exam_definitions,app.assignment_submissions,app.assignment_submission_revisions,app.exam_results,app.exam_result_revisions,app.student_self_reviews,app.student_week_summaries,app.student_week_approval_revisions FROM authenticated;
  END IF;
END $$;
