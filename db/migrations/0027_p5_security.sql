CREATE FUNCTION app.actor_can_access_p5_enrollment(target_workspace uuid,target_enrollment uuid,at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT app.actor_allows(target_workspace,NULL,true) OR EXISTS(
    SELECT 1 FROM app.login_accounts a JOIN app.group_memberships gm ON gm.enrollment_id=target_enrollment
    JOIN app.mentor_assignments ma ON ma.group_id=gm.group_id AND ma.mentor_person_id=a.person_id
    WHERE a.id=app.request_account_id() AND a.workspace_id=target_workspace AND a.role='MENTOR'
      AND gm.effective_from<=at_time AND (gm.effective_to IS NULL OR gm.effective_to>at_time)
      AND ma.effective_from<=at_time AND (ma.effective_to IS NULL OR ma.effective_to>at_time)
  )
$$;
REVOKE ALL ON FUNCTION app.actor_can_access_p5_enrollment(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_access_p5_enrollment(uuid,uuid,timestamptz) TO tarbiyah_runtime;

ALTER TABLE app.attentions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.attentions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.actions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.actions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.followups ENABLE ROW LEVEL SECURITY; ALTER TABLE app.followups FORCE ROW LEVEL SECURITY;
ALTER TABLE app.followup_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.followup_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.cases ENABLE ROW LEVEL SECURITY; ALTER TABLE app.cases FORCE ROW LEVEL SECURITY;
ALTER TABLE app.case_events ENABLE ROW LEVEL SECURITY; ALTER TABLE app.case_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.attentions,app.actions,app.followups,app.followup_revisions,app.cases,app.case_events FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON app.attentions,app.actions,app.followups,app.cases TO tarbiyah_runtime;
GRANT SELECT,INSERT ON app.followup_revisions,app.case_events TO tarbiyah_runtime;

CREATE POLICY attention_scope ON app.attentions FOR ALL TO tarbiyah_runtime USING(app.actor_can_access_p5_enrollment(workspace_id,enrollment_id,coalesce(due_at,created_at))) WITH CHECK(app.actor_can_access_p5_enrollment(workspace_id,enrollment_id,coalesce(due_at,created_at)));
CREATE POLICY action_scope ON app.actions FOR ALL TO tarbiyah_runtime USING(app.actor_can_access_p5_enrollment(workspace_id,enrollment_id,coalesce(due_at,created_at))) WITH CHECK(app.actor_can_access_p5_enrollment(workspace_id,enrollment_id,coalesce(due_at,created_at)));
CREATE POLICY followup_scope ON app.followups FOR ALL TO tarbiyah_runtime USING(app.actor_can_access_p5_enrollment(workspace_id,enrollment_id,occurred_at)) WITH CHECK(app.actor_can_access_p5_enrollment(workspace_id,enrollment_id,occurred_at));
CREATE POLICY followup_revision_scope ON app.followup_revisions FOR SELECT TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.followups f WHERE f.id=followup_id));
CREATE POLICY followup_revision_insert ON app.followup_revisions FOR INSERT TO tarbiyah_runtime WITH CHECK(actor_account_id=app.request_account_id() AND EXISTS(SELECT 1 FROM app.followups f WHERE f.id=followup_id));
CREATE POLICY case_scope ON app.cases FOR ALL TO tarbiyah_runtime USING(app.actor_can_access_p5_enrollment(workspace_id,enrollment_id,created_at)) WITH CHECK(app.actor_can_access_p5_enrollment(workspace_id,enrollment_id,created_at));
CREATE POLICY case_event_scope ON app.case_events FOR SELECT TO tarbiyah_runtime USING(EXISTS(SELECT 1 FROM app.cases c WHERE c.id=case_id));
CREATE POLICY case_event_insert ON app.case_events FOR INSERT TO tarbiyah_runtime WITH CHECK(actor_account_id=app.request_account_id() AND EXISTS(SELECT 1 FROM app.cases c WHERE c.id=case_id));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON app.attentions,app.actions,app.followups,app.followup_revisions,app.cases,app.case_events FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON app.attentions,app.actions,app.followups,app.followup_revisions,app.cases,app.case_events FROM authenticated; END IF;
END $$;
