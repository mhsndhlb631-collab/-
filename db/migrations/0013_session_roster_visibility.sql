CREATE FUNCTION app.actor_can_read_roster(target_workspace uuid,target_roster uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.session_roster sr JOIN app.session_occurrences so ON so.id=sr.session_occurrence_id
   JOIN app.enrollments e ON e.id=sr.enrollment_id JOIN app.student_profiles sp ON sp.id=e.student_profile_id
   JOIN app.login_accounts a ON a.id=app.request_account_id()
   WHERE sr.workspace_id=target_workspace AND sr.id=target_roster
   AND (app.actor_can_operate_session(target_workspace,so.id) OR a.person_id=sp.person_id))
$$;
REVOKE ALL ON FUNCTION app.actor_can_read_roster(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_read_roster(uuid,uuid) TO tarbiyah_runtime;
DROP POLICY roster_read ON app.session_roster;
DROP POLICY attendance_read ON app.attendance;
DROP POLICY metric_records_read ON app.session_metric_records;
CREATE POLICY roster_read ON app.session_roster FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_roster(workspace_id,id));
CREATE POLICY attendance_read ON app.attendance FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_roster(workspace_id,roster_id));
CREATE POLICY metric_records_read ON app.session_metric_records FOR SELECT TO tarbiyah_runtime USING(app.actor_can_read_roster(workspace_id,roster_id));
