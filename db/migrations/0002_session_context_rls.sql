CREATE FUNCTION app.request_account_id() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('app.account_id',true),'')::uuid
$$;
CREATE FUNCTION app.request_session_id() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('app.session_id',true),'')::uuid
$$;
REVOKE ALL ON FUNCTION app.request_account_id(),app.request_session_id() FROM PUBLIC;
CREATE FUNCTION app.actor_allows(target_workspace uuid,target_person uuid DEFAULT NULL,responsible_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.login_accounts a JOIN app.workspaces w ON w.id=a.workspace_id AND w.status='ACTIVE'
 JOIN auth.sessions s ON s.id=app.request_session_id() AND s.user_id=a.supabase_auth_user_id
 WHERE a.id=app.request_account_id() AND a.status='ACTIVE' AND NOT a.must_change_password
 AND a.workspace_id=target_workspace AND (a.revoked_before IS NULL OR s.created_at>a.revoked_before)
 AND (NOT responsible_only OR a.role='RESPONSIBLE')
 AND (target_person IS NULL OR a.role='RESPONSIBLE' OR a.person_id=target_person))
$$;
REVOKE ALL ON FUNCTION app.actor_allows(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_account_id(),app.request_session_id(),app.actor_allows(uuid,uuid,boolean) TO tarbiyah_runtime;
CREATE POLICY workspace_read ON app.workspaces FOR SELECT TO tarbiyah_runtime USING(app.actor_allows(id,NULL,false));
CREATE POLICY persons_read ON app.persons FOR SELECT TO tarbiyah_runtime USING(app.actor_allows(workspace_id,id,false));
CREATE POLICY students_read ON app.student_profiles FOR SELECT TO tarbiyah_runtime USING(app.actor_allows(workspace_id,person_id,false));
CREATE POLICY accounts_read ON app.login_accounts FOR SELECT TO tarbiyah_runtime USING(app.actor_allows(workspace_id,person_id,false));
CREATE POLICY audit_responsible_read ON app.audit_events FOR SELECT TO tarbiyah_runtime USING(app.actor_allows(workspace_id,NULL,true));
