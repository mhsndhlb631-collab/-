CREATE FUNCTION app.resolve_session_actor(session_uuid uuid,user_uuid uuid)
RETURNS TABLE(account_id uuid,workspace_id uuid,person_id uuid,role app.account_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT a.id,a.workspace_id,a.person_id,a.role FROM app.login_accounts a
  JOIN app.workspaces w ON w.id=a.workspace_id AND w.status='ACTIVE'
  JOIN auth.sessions s ON s.id=session_uuid AND s.user_id=user_uuid
  WHERE a.supabase_auth_user_id=user_uuid AND a.status='ACTIVE' AND NOT a.must_change_password
    AND (a.revoked_before IS NULL OR s.created_at>a.revoked_before)
$$;
REVOKE ALL ON FUNCTION app.resolve_session_actor(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_session_actor(uuid,uuid) TO tarbiyah_runtime;

CREATE POLICY templates_responsible_insert ON app.program_templates FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY templates_responsible_update ON app.program_templates FOR UPDATE TO tarbiyah_runtime
USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY plans_responsible_insert ON app.program_plans FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY plans_responsible_update ON app.program_plans FOR UPDATE TO tarbiyah_runtime
USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY weeks_responsible_insert ON app.plan_weeks FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY weeks_responsible_update ON app.plan_weeks FOR UPDATE TO tarbiyah_runtime
USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY cohorts_responsible_insert ON app.cohorts FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY cohorts_responsible_update ON app.cohorts FOR UPDATE TO tarbiyah_runtime
USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY groups_responsible_insert ON app.groups FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY groups_responsible_update ON app.groups FOR UPDATE TO tarbiyah_runtime
USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY enrollments_responsible_insert ON app.enrollments FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY enrollments_responsible_update ON app.enrollments FOR UPDATE TO tarbiyah_runtime
USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY memberships_responsible_insert ON app.group_memberships FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY memberships_responsible_update ON app.group_memberships FOR UPDATE TO tarbiyah_runtime
USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY assignments_responsible_insert ON app.mentor_assignments FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY assignments_responsible_update ON app.mentor_assignments FOR UPDATE TO tarbiyah_runtime
USING(app.actor_allows(workspace_id,NULL,true)) WITH CHECK(app.actor_allows(workspace_id,NULL,true));

CREATE POLICY idempotency_actor_insert ON app.idempotency_records FOR INSERT TO tarbiyah_runtime
WITH CHECK(
  actor_account_id=app.request_account_id() AND
  app.actor_allows(workspace_id,NULL,true)
);
CREATE POLICY idempotency_actor_update ON app.idempotency_records FOR UPDATE TO tarbiyah_runtime
USING(actor_account_id=app.request_account_id() AND app.actor_allows(workspace_id,NULL,true))
WITH CHECK(actor_account_id=app.request_account_id() AND app.actor_allows(workspace_id,NULL,true));
CREATE POLICY audit_actor_insert ON app.audit_events FOR INSERT TO tarbiyah_runtime
WITH CHECK(
  actor_account_id=app.request_account_id() AND
  app.actor_allows(workspace_id,NULL,true) AND
  actor_role=(SELECT a.role FROM app.login_accounts a WHERE a.id=app.request_account_id())
);

GRANT INSERT,UPDATE ON app.program_templates,app.program_plans,app.plan_weeks,app.cohorts,
  app.groups,app.enrollments,app.group_memberships,app.mentor_assignments,app.idempotency_records TO tarbiyah_runtime;
GRANT INSERT ON app.audit_events TO tarbiyah_runtime;
