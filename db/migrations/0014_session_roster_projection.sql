CREATE FUNCTION app.read_session_roster(target_session uuid)
RETURNS TABLE(id uuid,enrollment_id uuid,display_name text,eligibility text,attendance_status app.attendance_status,reason text,attendance_row_version bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT sr.id,sr.enrollment_id,p.display_name,sr.eligibility,a.status,a.reason,a.row_version
 FROM app.session_roster sr JOIN app.enrollments e ON e.id=sr.enrollment_id
 JOIN app.student_profiles sp ON sp.id=e.student_profile_id JOIN app.persons p ON p.id=sp.person_id
 JOIN app.attendance a ON a.roster_id=sr.id
 WHERE sr.session_occurrence_id=target_session AND app.actor_can_read_roster(sr.workspace_id,sr.id)
 ORDER BY p.display_name,sr.id
$$;
REVOKE ALL ON FUNCTION app.read_session_roster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_session_roster(uuid) TO tarbiyah_runtime;
