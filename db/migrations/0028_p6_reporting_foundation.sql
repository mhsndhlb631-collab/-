CREATE TABLE app.mentor_performance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  mentor_account_id uuid NOT NULL, period_start date NOT NULL, period_end date NOT NULL CHECK(period_end>=period_start),
  rules_version text NOT NULL CHECK(char_length(rules_version) BETWEEN 3 AND 80), dimensions jsonb NOT NULL CHECK(jsonb_typeof(dimensions)='object'),
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'), score numeric(6,3) CHECK(score BETWEEN 0 AND 100),
  opportunity_count integer NOT NULL CHECK(opportunity_count>=0), limited_data boolean NOT NULL,
  generated_by_account_id uuid NOT NULL, request_id uuid NOT NULL, generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id), UNIQUE(request_id),
  FOREIGN KEY(workspace_id,mentor_account_id) REFERENCES app.login_accounts(workspace_id,id),
  FOREIGN KEY(workspace_id,generated_by_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE INDEX mentor_performance_history ON app.mentor_performance_snapshots(workspace_id,mentor_account_id,period_start,period_end,generated_at DESC);

CREATE TABLE app.report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspaces(id),
  report_type text NOT NULL CHECK(report_type IN ('STUDENT_WEEK','GROUP_WEEK','MENTOR_WEEK','PROGRAM')),
  format text NOT NULL CHECK(format='CSV'), filters jsonb NOT NULL CHECK(jsonb_typeof(filters)='object'),
  row_count integer NOT NULL CHECK(row_count>=0), generated_by_account_id uuid NOT NULL, request_id uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(workspace_id,id), UNIQUE(request_id),
  FOREIGN KEY(workspace_id,generated_by_account_id) REFERENCES app.login_accounts(workspace_id,id)
);
CREATE INDEX report_export_history ON app.report_exports(workspace_id,generated_at DESC,id);

CREATE TRIGGER mentor_performance_snapshot_immutable BEFORE UPDATE OR DELETE ON app.mentor_performance_snapshots FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();
CREATE TRIGGER report_export_immutable BEFORE UPDATE OR DELETE ON app.report_exports FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();
