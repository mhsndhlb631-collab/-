CREATE FUNCTION app.password_change_target(session_uuid uuid,user_uuid uuid)
RETURNS TABLE(account_id uuid,normalized_login_name text,must_change_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT a.id,a.normalized_login_name,a.must_change_password
  FROM app.login_accounts a
  JOIN app.workspaces w ON w.id=a.workspace_id AND w.status='ACTIVE'
  JOIN auth.sessions s ON s.id=session_uuid AND s.user_id=user_uuid AND s.user_id=a.supabase_auth_user_id
  WHERE a.status='ACTIVE'
    AND (a.revoked_before IS NULL OR s.created_at>a.revoked_before)
    AND (NOT a.must_change_password OR a.temporary_password_expires_at>clock_timestamp())
$$;

CREATE FUNCTION app.complete_own_password_change(account_uuid uuid,session_uuid uuid,user_uuid uuid,request_uuid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target app.login_accounts%ROWTYPE;
BEGIN
  SELECT a.* INTO target FROM app.login_accounts a
  JOIN auth.sessions s ON s.id=session_uuid AND s.user_id=user_uuid AND s.user_id=a.supabase_auth_user_id
  WHERE a.id=account_uuid AND a.status='ACTIVE'
    AND (a.revoked_before IS NULL OR s.created_at>a.revoked_before)
  FOR UPDATE OF a;
  IF target.id IS NULL THEN RAISE EXCEPTION 'invalid password change session' USING ERRCODE='42501'; END IF;
  UPDATE app.login_accounts SET must_change_password=false,temporary_password_expires_at=NULL,
    revoked_before=clock_timestamp(),updated_at=clock_timestamp(),row_version=row_version+1 WHERE id=account_uuid;
  INSERT INTO app.audit_events(workspace_id,actor_account_id,actor_role,action,resource_type,resource_id,request_id)
    VALUES(target.workspace_id,target.id,target.role,'OWN_PASSWORD_CHANGED','login_account',target.id,request_uuid);
END $$;

REVOKE ALL ON FUNCTION app.password_change_target(uuid,uuid),app.complete_own_password_change(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.password_change_target(uuid,uuid),app.complete_own_password_change(uuid,uuid,uuid,uuid) TO tarbiyah_runtime;
