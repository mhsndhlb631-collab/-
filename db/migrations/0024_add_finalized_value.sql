-- P4.1 step 1: extend the student_week_status enum with FINALIZED.
-- PostgreSQL requires ALTER TYPE ... ADD VALUE to run in its own transaction
-- (no other DDL in the same transaction block). The migrate runner applies
-- each numbered file in its own transaction, so this file MUST be the first
-- 0024 file applied. Any following 0024* file is then free to use FINALIZED.
ALTER TYPE app.student_week_status ADD VALUE IF NOT EXISTS 'FINALIZED';