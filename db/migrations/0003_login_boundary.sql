CREATE FUNCTION app.login_target(login_name text) RETURNS TABLE(account_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a.id FROM app.login_accounts a JOIN app.workspaces w ON w.id=a.workspace_id
 WHERE a.normalized_login_name=login_name AND a.status='ACTIVE'
 AND a.supabase_auth_user_id IS NOT NULL AND w.status='ACTIVE'
$$;
CREATE FUNCTION app.accept_login_session(account_uuid uuid,session_uuid uuid,user_uuid uuid)
RETURNS TABLE(account_id uuid,must_change_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a.id,a.must_change_password FROM app.login_accounts a
 JOIN app.workspaces w ON w.id=a.workspace_id AND w.status='ACTIVE'
 JOIN auth.sessions s ON s.id=session_uuid AND s.user_id=user_uuid AND s.user_id=a.supabase_auth_user_id
 WHERE a.id=account_uuid AND a.status='ACTIVE'
 AND (a.revoked_before IS NULL OR s.created_at>a.revoked_before)
 AND (NOT a.must_change_password OR a.temporary_password_expires_at>clock_timestamp())
$$;
REVOKE ALL ON FUNCTION app.login_target(text),app.accept_login_session(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.login_target(text),app.accept_login_session(uuid,uuid,uuid) TO tarbiyah_runtime;
