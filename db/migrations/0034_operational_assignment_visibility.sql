-- Students may read only the target rows that belong to their own enrollment.
-- Staff write access remains governed by assignment_targets_access from 0033.
CREATE POLICY assignment_targets_student_read ON app.assignment_targets
FOR SELECT TO tarbiyah_runtime
USING (
  EXISTS (
    SELECT 1
    FROM app.assignment_definitions d
    WHERE d.id = assignment_definition_id
      AND d.workspace_id = assignment_targets.workspace_id
      AND app.actor_can_access_tracking_enrollment(
        assignment_targets.workspace_id,
        assignment_targets.enrollment_id,
        assignment_targets.created_at,
        false
      )
  )
);

DROP POLICY assignment_evaluation_notes_read ON app.assignment_evaluation_notes;
CREATE POLICY assignment_evaluation_notes_read ON app.assignment_evaluation_notes
FOR SELECT TO tarbiyah_runtime
USING (
  EXISTS (
    SELECT 1
    FROM app.assignment_evaluations e
    JOIN app.login_accounts a ON a.id = app.request_account_id()
    WHERE e.id = evaluation_id
      AND app.actor_can_access_tracking_enrollment(
        e.workspace_id,
        e.enrollment_id,
        e.updated_at,
        false
      )
      AND (a.role <> 'STUDENT' OR visibility = 'STUDENT')
  )
);
