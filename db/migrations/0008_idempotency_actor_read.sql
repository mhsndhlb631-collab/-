-- PostgreSQL evaluates the conflicting row during INSERT ... ON CONFLICT.
-- Keep that lookup scoped to the authenticated actor's own command records.
CREATE POLICY idempotency_actor_read ON app.idempotency_records
FOR SELECT TO tarbiyah_runtime
USING(
  actor_account_id=app.request_account_id() AND
  app.actor_allows(workspace_id,NULL,true)
);
