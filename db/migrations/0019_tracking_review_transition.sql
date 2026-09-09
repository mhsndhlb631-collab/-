CREATE FUNCTION app.apply_tracking_review_status(
  target_entry uuid,
  expected_entry_version integer,
  expected_row_version bigint,
  target_status app.tracking_review_status
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; actor_role app.account_role; next_row_version bigint;
BEGIN
  IF target_status NOT IN ('VERIFIED','NEEDS_CORRECTION') THEN
    RAISE EXCEPTION 'invalid tracking review status' USING ERRCODE='23514';
  END IF;
  SELECT e.workspace_id,e.enrollment_id,e.period_end,e.current_version,e.row_version,d.requires_review
    INTO item FROM app.tracking_entries e JOIN app.tracking_definitions d ON d.id=e.tracking_definition_id
    WHERE e.id=target_entry FOR UPDATE OF e;
  IF item.workspace_id IS NULL THEN RETURN NULL; END IF;
  SELECT role INTO actor_role FROM app.login_accounts WHERE id=app.request_account_id();
  IF actor_role NOT IN ('RESPONSIBLE','MENTOR') OR NOT item.requires_review OR
     NOT app.actor_can_access_tracking_enrollment(item.workspace_id,item.enrollment_id,(item.period_end+1)::timestamptz,true) THEN
    RAISE EXCEPTION 'tracking review denied' USING ERRCODE='42501';
  END IF;
  IF item.current_version<>expected_entry_version OR item.row_version<>expected_row_version THEN
    RAISE EXCEPTION 'tracking review version conflict' USING ERRCODE='40001';
  END IF;
  UPDATE app.tracking_entries SET review_status=target_status,row_version=row_version+1
    WHERE id=target_entry RETURNING row_version INTO next_row_version;
  RETURN next_row_version;
END $$;
REVOKE ALL ON FUNCTION app.apply_tracking_review_status(uuid,integer,bigint,app.tracking_review_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.apply_tracking_review_status(uuid,integer,bigint,app.tracking_review_status) TO tarbiyah_runtime;
