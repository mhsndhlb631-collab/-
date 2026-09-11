CREATE INDEX group_memberships_scope_read
  ON app.group_memberships(workspace_id,group_id,enrollment_id,effective_from,effective_to);

CREATE INDEX group_memberships_enrollment_read
  ON app.group_memberships(workspace_id,enrollment_id,group_id,effective_from,effective_to);

CREATE INDEX mentor_assignments_scope_read
  ON app.mentor_assignments(workspace_id,group_id,mentor_person_id,effective_from,effective_to);
