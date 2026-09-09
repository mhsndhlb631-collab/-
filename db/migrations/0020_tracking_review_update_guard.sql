CREATE FUNCTION app.guard_tracking_entry_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record;
BEGIN
  IF app.request_account_id() IS NULL THEN RETURN NEW; END IF;
  IF NEW.recorded_by_account_id=app.request_account_id() THEN RETURN NEW; END IF;
  SELECT role INTO actor FROM app.login_accounts WHERE id=app.request_account_id();
  IF actor.role NOT IN ('RESPONSIBLE','MENTOR') OR
     NOT app.actor_can_access_tracking_enrollment(OLD.workspace_id,OLD.enrollment_id,(OLD.period_end+1)::timestamptz,true) OR
     NEW.review_status NOT IN ('VERIFIED','NEEDS_CORRECTION') OR
     ROW(NEW.id,NEW.workspace_id,NEW.enrollment_id,NEW.tracking_definition_id,NEW.period_start,NEW.period_end,
         NEW.state,NEW.value,NEW.source,NEW.occurred_at,NEW.recorded_by_account_id,NEW.exemption_reason,
         NEW.current_version,NEW.created_at)
       IS DISTINCT FROM
     ROW(OLD.id,OLD.workspace_id,OLD.enrollment_id,OLD.tracking_definition_id,OLD.period_start,OLD.period_end,
         OLD.state,OLD.value,OLD.source,OLD.occurred_at,OLD.recorded_by_account_id,OLD.exemption_reason,
         OLD.current_version,OLD.created_at) THEN
    RAISE EXCEPTION 'tracking review may update status only' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tracking_entry_update_guard BEFORE UPDATE ON app.tracking_entries
FOR EACH ROW EXECUTE FUNCTION app.guard_tracking_entry_update();

DROP POLICY tracking_entries_update ON app.tracking_entries;
CREATE POLICY tracking_entries_update ON app.tracking_entries FOR UPDATE TO tarbiyah_runtime
USING(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,(period_end+1)::timestamptz,true))
WITH CHECK(app.actor_can_access_tracking_enrollment(workspace_id,enrollment_id,(period_end+1)::timestamptz,true));
