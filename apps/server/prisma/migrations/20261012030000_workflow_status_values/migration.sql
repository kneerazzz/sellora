-- PostgreSQL requires a commit between adding an enum value and using it.
ALTER TYPE "WorkflowRunStatus" ADD VALUE IF NOT EXISTS 'RETRY_WAIT';
ALTER TYPE "WorkflowRunStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
