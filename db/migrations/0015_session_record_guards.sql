CREATE FUNCTION app.roster_in_session(target_roster uuid,target_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.session_roster WHERE id=target_roster AND session_occurrence_id=target_session)
$$;
REVOKE ALL ON FUNCTION app.roster_in_session(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.roster_in_session(uuid,uuid) TO tarbiyah_runtime;
