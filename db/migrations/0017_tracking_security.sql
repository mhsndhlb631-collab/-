CREATE FUNCTION app.actor_can_access_tracking_enrollment(target_workspace uuid,target_enrollment uuid,at_time timestamptz,write_access boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT app.actor_allows(target_workspace,NULL,true) OR EXISTS(
    SELECT 1 FROM app.login_accounts a JOIN app.enrollments e ON e.id=target_enrollment AND e.workspace_id=target_workspace
    JOIN app.student_profiles sp ON sp.id=e.student_profile_id
    WHERE a.id=app.request_account_id() AND a.workspace_id=target_workspace AND (
      a.person_id=sp.person_id OR (a.role='MENTOR' AND EXISTS(
        SELECT 1 FROM app.group_memberships gm JOIN app.mentor_assignments ma ON ma.group_id=gm.group_id
        WHERE gm.enrollment_id=e.id AND gm.effective_from<=at_time AND (gm.effective_to IS NULL OR gm.effective_to>at_time)
          AND ma.mentor_person_id=a.person_id AND ma.effective_from<=at_time AND (ma.effective_to IS NULL OR ma.effective_to>at_time)
      ))
    ) AND (NOT write_access OR a.role IN ('MENTOR','STUDENT'))
  )
$$;
REVOKE ALL ON FUNCTION app.actor_can_access_tracking_enrollment(uuid,uuid,timestamptz,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_access_tracking_enrollment(uuid,uuid,timestamptz,boolean) TO tarbiyah_runtime;

ALTER TABLE app.tracking_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.tracking_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.tracking_schedules ENABLE ROW LEVEL SECURITY; ALTER TABLE app.tracking_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE app.tracking_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE app.tracking_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE app.tracking_entry_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE app.tracking_entry_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE app.tracking_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE app.tracking_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.tracking_definitions,app.tracking_schedules,app.tracking_entries,app.tracking_entry_revisions,app.tracking_reviews FROM PUBLIC;
GRANT SELECT,INSERT ON app.tracking_definitions,app.tracking_schedules TO tarbiyah_runtime;
GRANT SELECT,INSERT,UPDATE ON app.tracking_entries TO tarbiyah_runtime;
GRANT SELECT ON app.tracking_entry_revisions TO tarbiyah_runtime;
GRANT SELECT,INSERT ON app.tracking_reviews TO tarbiyah_runtime;

CREATE POLICY tracking_definitions_read ON app.tracking_definitions FOR SELECT TO tarbiyah_runtime
USING(app.actor_can_read_plan(workspace_id,plan_id));
CREATE POLICY tracking_definitions_insert ON app.tracking_definitions FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY tracking_schedules_read ON app.tracking_schedules FOR SELECT TO tarbiyah_runtime
USING(EXISTS(SELECT 1 FROM app.tracking_definitions d WHERE d.id=tracking_schedules.tracking_definition_id AND app.actor_can_read_plan(tracking_schedules.workspace_id,d.plan_id)));
CREATE POLICY tracking_schedules_insert ON app.tracking_schedules FOR INSERT TO tarbiyah_runtime
WITH CHECK(app.actor_allows(workspace_id,NULL,true));
CREATE POLICY tracking_entries_read ON app.tracking_entries FOR SELECT TO tarbiyah_runtime
USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,(period_end+1)::timestamptz,false));
CREATE POLICY tracking_entries_insert ON app.tracking_entries FOR INSERT TO tarbiyah_runtime
WITH CHECK(recorded_by_account_id=app.request_account_id() AND app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,(period_end+1)::timestamptz,true));
CREATE POLICY tracking_entries_update ON app.tracking_entries FOR UPDATE TO tarbiyah_runtime
USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,(period_end+1)::timestamptz,true))
WITH CHECK(recorded_by_account_id=app.request_account_id() AND app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,(period_end+1)::timestamptz,true));
CREATE POLICY tracking_revisions_read ON app.tracking_entry_revisions FOR SELECT TO tarbiyah_runtime
USING(EXISTS(SELECT 1 FROM app.tracking_entries e WHERE e.id=tracking_entry_revisions.tracking_entry_id));
CREATE POLICY tracking_reviews_read ON app.tracking_reviews FOR SELECT TO tarbiyah_runtime
USING(EXISTS(SELECT 1 FROM app.tracking_entries e WHERE e.id=tracking_reviews.tracking_entry_id));
CREATE POLICY tracking_reviews_insert ON app.tracking_reviews FOR INSERT TO tarbiyah_runtime
WITH CHECK(reviewer_account_id=app.request_account_id() AND EXISTS(
  SELECT 1 FROM app.tracking_entries e JOIN app.login_accounts a ON a.id=app.request_account_id()
  WHERE e.id=tracking_reviews.tracking_entry_id AND a.role IN ('RESPONSIBLE','MENTOR')
    AND app.actor_can_access_tracking_enrollment(tracking_reviews.workspace_id,e.enrollment_id,(e.period_end+1)::timestamptz,true)
));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON app.tracking_definitions,app.tracking_schedules,app.tracking_entries,app.tracking_entry_revisions,app.tracking_reviews FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON app.tracking_definitions,app.tracking_schedules,app.tracking_entries,app.tracking_entry_revisions,app.tracking_reviews FROM authenticated;
  END IF;
END $$;
