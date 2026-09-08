-- P0-only authorization scope foundation. P1 replaces these explicit person links
-- with effective-time group mentor assignments without widening any policy.
CREATE TABLE app.mentor_student_scopes (
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  mentor_person_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  PRIMARY KEY(workspace_id,mentor_person_id,student_person_id,effective_from),
  FOREIGN KEY(workspace_id,mentor_person_id) REFERENCES app.persons(workspace_id,id),
  FOREIGN KEY(workspace_id,student_person_id) REFERENCES app.persons(workspace_id,id),
  CHECK(mentor_person_id<>student_person_id),
  CHECK(effective_to IS NULL OR effective_to>effective_from)
);
ALTER TABLE app.mentor_student_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mentor_student_scopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.mentor_student_scopes FROM PUBLIC;

CREATE FUNCTION app.actor_can_read_person(target_workspace uuid,target_person uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
   SELECT 1 FROM app.login_accounts a
   JOIN app.workspaces w ON w.id=a.workspace_id AND w.status='ACTIVE'
   JOIN auth.sessions s ON s.id=app.request_session_id() AND s.user_id=a.supabase_auth_user_id
   WHERE a.id=app.request_account_id() AND a.status='ACTIVE' AND NOT a.must_change_password
   AND a.workspace_id=target_workspace
   AND (a.revoked_before IS NULL OR s.created_at>a.revoked_before)
   AND (
     a.role='RESPONSIBLE' OR a.person_id=target_person OR
     (a.role='MENTOR' AND EXISTS(
       SELECT 1 FROM app.mentor_student_scopes scope
       WHERE scope.workspace_id=a.workspace_id
       AND scope.mentor_person_id=a.person_id
       AND scope.student_person_id=target_person
       AND scope.effective_from<=clock_timestamp()
       AND (scope.effective_to IS NULL OR scope.effective_to>clock_timestamp())
     ))
   )
 )
$$;
REVOKE ALL ON FUNCTION app.actor_can_read_person(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_can_read_person(uuid,uuid) TO tarbiyah_runtime;

DROP POLICY persons_read ON app.persons;
CREATE POLICY persons_read ON app.persons FOR SELECT TO tarbiyah_runtime
USING(app.actor_can_read_person(workspace_id,id));
DROP POLICY students_read ON app.student_profiles;
CREATE POLICY students_read ON app.student_profiles FOR SELECT TO tarbiyah_runtime
USING(app.actor_can_read_person(workspace_id,person_id));

-- Scope rows are never returned to students. Mentors see only their current links;
-- RESPONSIBLE sees all links in the workspace.
GRANT SELECT ON app.mentor_student_scopes TO tarbiyah_runtime;
CREATE POLICY mentor_scopes_read ON app.mentor_student_scopes FOR SELECT TO tarbiyah_runtime
USING(
  app.actor_allows(workspace_id,NULL,true) OR
  mentor_person_id=(SELECT a.person_id FROM app.login_accounts a WHERE a.id=app.request_account_id())
);
