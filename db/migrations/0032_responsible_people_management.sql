-- Responsible-only person and account provisioning for the operational UI.
-- Provider identities are still created through the Supabase Auth Admin API;
-- the local PROVISIONING state remains deny-by-default until that step succeeds.
CREATE POLICY persons_responsible_insert ON app.persons
FOR INSERT TO tarbiyah_runtime
WITH CHECK (app.actor_allows(workspace_id,NULL,true));

CREATE POLICY student_profiles_responsible_insert ON app.student_profiles
FOR INSERT TO tarbiyah_runtime
WITH CHECK (app.actor_allows(workspace_id,NULL,true));

CREATE POLICY login_accounts_responsible_insert ON app.login_accounts
FOR INSERT TO tarbiyah_runtime
WITH CHECK (app.actor_allows(workspace_id,NULL,true));

CREATE POLICY login_accounts_responsible_update ON app.login_accounts
FOR UPDATE TO tarbiyah_runtime
USING (app.actor_allows(workspace_id,NULL,true))
WITH CHECK (app.actor_allows(workspace_id,NULL,true));

GRANT INSERT ON app.persons,app.student_profiles,app.login_accounts TO tarbiyah_runtime;
GRANT UPDATE ON app.login_accounts TO tarbiyah_runtime;
