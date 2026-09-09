DROP POLICY enrollments_read ON app.enrollments;
CREATE POLICY enrollments_read ON app.enrollments FOR SELECT TO tarbiyah_runtime USING(
  app.actor_allows(workspace_id,NULL,true) OR EXISTS(
    SELECT 1 FROM app.login_accounts a JOIN app.student_profiles sp ON sp.id=enrollments.student_profile_id
    WHERE a.id=app.request_account_id() AND a.workspace_id=enrollments.workspace_id AND (
      (a.role='STUDENT' AND a.person_id=sp.person_id) OR
      (a.role='MENTOR' AND EXISTS(
        SELECT 1 FROM app.group_memberships gm JOIN app.mentor_assignments ma ON ma.group_id=gm.group_id
        WHERE gm.enrollment_id=enrollments.id AND ma.mentor_person_id=a.person_id
          AND gm.effective_from<=clock_timestamp() AND (gm.effective_to IS NULL OR gm.effective_to>clock_timestamp())
          AND ma.effective_from<=clock_timestamp() AND (ma.effective_to IS NULL OR ma.effective_to>clock_timestamp())
      ))
    )
  )
);
