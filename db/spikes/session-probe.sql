-- EXPERIMENTAL: install only in the dedicated P0 staging project.
-- Not a production migration or a permanently approved auth.sessions dependency.
-- JWT signature/issuer/expiry must be verified by the server before calling.
CREATE FUNCTION app.spike_session_probe(session_uuid uuid, user_uuid uuid, account_uuid uuid)
RETURNS TABLE(original_created_at timestamptz, accepted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT s.created_at,
    a.status='ACTIVE' AND NOT a.must_change_password
      AND w.status='ACTIVE'
      AND (a.revoked_before IS NULL OR s.created_at > a.revoked_before)
  FROM auth.sessions s
  JOIN app.login_accounts a ON a.supabase_auth_user_id=s.user_id
  JOIN app.workspaces w ON w.id=a.workspace_id
  WHERE s.id=session_uuid AND s.user_id=user_uuid AND a.id=account_uuid;
$$;
REVOKE ALL ON FUNCTION app.spike_session_probe(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.spike_session_probe(uuid,uuid,uuid) TO tarbiyah_runtime;
