CREATE FUNCTION app.actor_is_responsible(target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM app.login_accounts a WHERE a.id=app.request_account_id() AND a.workspace_id=target_workspace AND a.role='RESPONSIBLE' AND a.status='ACTIVE')
$$;
REVOKE ALL ON FUNCTION app.actor_is_responsible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_is_responsible(uuid) TO tarbiyah_runtime;

ALTER TABLE app.mentor_performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mentor_performance_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE app.report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.report_exports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.mentor_performance_snapshots,app.report_exports FROM PUBLIC;
GRANT SELECT,INSERT ON app.mentor_performance_snapshots,app.report_exports TO tarbiyah_runtime;
CREATE POLICY performance_responsible_read ON app.mentor_performance_snapshots FOR SELECT TO tarbiyah_runtime USING(app.actor_is_responsible(workspace_id));
CREATE POLICY performance_responsible_insert ON app.mentor_performance_snapshots FOR INSERT TO tarbiyah_runtime WITH CHECK(app.actor_is_responsible(workspace_id) AND generated_by_account_id=app.request_account_id());
CREATE POLICY exports_responsible_read ON app.report_exports FOR SELECT TO tarbiyah_runtime USING(app.actor_is_responsible(workspace_id));
CREATE POLICY exports_responsible_insert ON app.report_exports FOR INSERT TO tarbiyah_runtime WITH CHECK(app.actor_is_responsible(workspace_id) AND generated_by_account_id=app.request_account_id());

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON app.mentor_performance_snapshots,app.report_exports FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON app.mentor_performance_snapshots,app.report_exports FROM authenticated; END IF;
END $$;
