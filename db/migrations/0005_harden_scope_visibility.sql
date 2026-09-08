DROP POLICY mentor_scopes_read ON app.mentor_student_scopes;
CREATE POLICY mentor_scopes_read ON app.mentor_student_scopes FOR SELECT TO tarbiyah_runtime
USING(
  app.actor_allows(workspace_id,NULL,true) OR
  EXISTS(
    SELECT 1 FROM app.login_accounts a
    WHERE a.id=app.request_account_id()
    AND a.role='MENTOR'
    AND a.person_id=mentor_person_id
  )
);
