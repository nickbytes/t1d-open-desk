CREATE TABLE submissions (
  id TEXT PRIMARY KEY NOT NULL,
  submitter TEXT NOT NULL,
  task_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  packet TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE(submitter, digest)
);
--> statement-breakpoint
CREATE INDEX submissions_submitter ON submissions (submitter);
--> statement-breakpoint
CREATE INDEX submissions_recent ON submissions (submitted_at DESC, id DESC);
