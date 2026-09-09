CREATE FUNCTION app.freeze_session_roster(target_session uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target_workspace uuid; target_group uuid; target_start timestamptz; inserted_count integer;
BEGIN
 SELECT workspace_id,group_id,starts_at INTO target_workspace,target_group,target_start
 FROM app.session_occurrences WHERE id=target_session AND status='OPEN';
 IF target_workspace IS NULL OR NOT app.actor_can_operate_session(target_workspace,target_session) THEN
   RAISE EXCEPTION 'session operation denied' USING ERRCODE='42501';
 END IF;
 INSERT INTO app.session_roster(workspace_id,session_occurrence_id,enrollment_id)
 SELECT target_workspace,target_session,e.id FROM app.enrollments e
 JOIN app.group_memberships gm ON gm.workspace_id=e.workspace_id AND gm.enrollment_id=e.id
 WHERE e.workspace_id=target_workspace AND gm.group_id=target_group
 AND e.effective_from<=target_start AND (e.effective_to IS NULL OR e.effective_to>target_start)
 AND gm.effective_from<=target_start AND (gm.effective_to IS NULL OR gm.effective_to>target_start)
 ON CONFLICT(session_occurrence_id,enrollment_id) DO NOTHING;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;
 INSERT INTO app.attendance(workspace_id,roster_id)
 SELECT target_workspace,id FROM app.session_roster WHERE session_occurrence_id=target_session
 ON CONFLICT(roster_id) DO NOTHING;
 RETURN inserted_count;
END $$;
REVOKE ALL ON FUNCTION app.freeze_session_roster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.freeze_session_roster(uuid) TO tarbiyah_runtime;
