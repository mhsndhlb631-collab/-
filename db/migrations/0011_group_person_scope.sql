CREATE OR REPLACE FUNCTION app.actor_can_read_person(target_workspace uuid,target_person uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
   SELECT 1 FROM app.login_accounts a JOIN app.workspaces w ON w.id=a.workspace_id AND w.status='ACTIVE'
   JOIN auth.sessions s ON s.id=app.request_session_id() AND s.user_id=a.supabase_auth_user_id
   WHERE a.id=app.request_account_id() AND a.status='ACTIVE' AND NOT a.must_change_password
   AND a.workspace_id=target_workspace AND (a.revoked_before IS NULL OR s.created_at>a.revoked_before)
   AND (a.role='RESPONSIBLE' OR a.person_id=target_person OR (a.role='MENTOR' AND (
     EXISTS(SELECT 1 FROM app.student_profiles sp JOIN app.enrollments e ON e.student_profile_id=sp.id
       JOIN app.group_memberships gm ON gm.enrollment_id=e.id JOIN app.mentor_assignments ma ON ma.group_id=gm.group_id
       WHERE sp.workspace_id=target_workspace AND sp.person_id=target_person AND ma.mentor_person_id=a.person_id
       AND e.effective_from<=clock_timestamp() AND (e.effective_to IS NULL OR e.effective_to>clock_timestamp())
       AND gm.effective_from<=clock_timestamp() AND (gm.effective_to IS NULL OR gm.effective_to>clock_timestamp())
       AND ma.effective_from<=clock_timestamp() AND (ma.effective_to IS NULL OR ma.effective_to>clock_timestamp()))
     OR EXISTS(SELECT 1 FROM app.session_occurrences so JOIN app.session_roster sr ON sr.session_occurrence_id=so.id
       JOIN app.enrollments e ON e.id=sr.enrollment_id JOIN app.student_profiles sp ON sp.id=e.student_profile_id
       WHERE so.workspace_id=target_workspace AND so.responsible_mentor_person_id=a.person_id AND sp.person_id=target_person)
   )))
 )
$$;
REVOKE ALL ON FUNCTION app.actor_can_read_person(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_read_person(uuid,uuid) TO tarbiyah_runtime;
