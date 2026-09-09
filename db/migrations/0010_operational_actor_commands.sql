DROP POLICY idempotency_actor_insert ON app.idempotency_records;
DROP POLICY idempotency_actor_update ON app.idempotency_records;
DROP POLICY idempotency_actor_read ON app.idempotency_records;
DROP POLICY audit_actor_insert ON app.audit_events;
CREATE POLICY idempotency_actor_insert ON app.idempotency_records FOR INSERT TO tarbiyah_runtime
WITH CHECK(actor_account_id=app.request_account_id() AND app.actor_allows(workspace_id,NULL,false));
CREATE POLICY idempotency_actor_update ON app.idempotency_records FOR UPDATE TO tarbiyah_runtime
USING(actor_account_id=app.request_account_id() AND app.actor_allows(workspace_id,NULL,false))
WITH CHECK(actor_account_id=app.request_account_id() AND app.actor_allows(workspace_id,NULL,false));
CREATE POLICY idempotency_actor_read ON app.idempotency_records FOR SELECT TO tarbiyah_runtime
USING(actor_account_id=app.request_account_id() AND app.actor_allows(workspace_id,NULL,false));
CREATE POLICY audit_actor_insert ON app.audit_events FOR INSERT TO tarbiyah_runtime
WITH CHECK(actor_account_id=app.request_account_id() AND app.actor_allows(workspace_id,NULL,false)
AND actor_role=(SELECT a.role FROM app.login_accounts a WHERE a.id=app.request_account_id()));
