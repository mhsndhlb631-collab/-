-- P4.1 step 2: enforce the new OPEN <-> FINALIZED state machine.
-- Run only after 0024_add_finalized_value.sql has applied. This file
-- migrates any pre-existing READY/APPROVED rows to FINALIZED and adds a
-- DB-level transition guard so the application code cannot regress.
UPDATE app.student_week_summaries
SET status = 'FINALIZED', updated_at = clock_timestamp()
WHERE status IN ('READY', 'APPROVED');

CREATE OR REPLACE FUNCTION app.enforce_student_week_transition()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $$
DECLARE
  existing_status app.student_week_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('OPEN', 'FINALIZED') THEN
      RAISE EXCEPTION 'invalid initial student week status'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  existing_status := OLD.status;
  IF existing_status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF existing_status = 'OPEN' AND NEW.status = 'FINALIZED' THEN
    RETURN NEW;
  END IF;
  IF existing_status = 'FINALIZED' AND NEW.status = 'OPEN' THEN
    RETURN NEW;
  END IF;
  IF existing_status = 'FINALIZED' AND NEW.status = 'FINALIZED' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'illegal student week transition'
    USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS student_week_transition_guard
  ON app.student_week_summaries;
CREATE TRIGGER student_week_transition_guard
  BEFORE INSERT OR UPDATE ON app.student_week_summaries
  FOR EACH ROW EXECUTE FUNCTION app.enforce_student_week_transition();

-- P4.1 closing-boundary helper. A week is operationally closed when the
-- workspace's local date is strictly after the week_end inclusive date.
-- This is the only place that decides what "after the closing boundary"
-- means; the application code calls it through a parameter and never
-- composes timezone SQL itself.
CREATE OR REPLACE FUNCTION app.week_closed_in_timezone(
  week_end date,
  tz text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT ((now() at time zone tz)::date > week_end)
$$;
GRANT EXECUTE ON FUNCTION app.week_closed_in_timezone(date, text) TO tarbiyah_runtime;