CREATE TABLE forum_posts (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT REFERENCES forum_posts (id),
  submitter TEXT NOT NULL,
  digest TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  sources TEXT NOT NULL,
  status TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(submitter, digest),
  CHECK((kind='question' AND thread_id IS NULL AND title IS NOT NULL)
    OR (kind IN ('finding','challenge') AND thread_id IS NOT NULL AND title IS NULL)),
  CHECK(status IN ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE INDEX forum_public_thread ON forum_posts (status, thread_id, submitted_at, id);
--> statement-breakpoint
CREATE INDEX forum_submitter_daily ON forum_posts (submitter, submitted_at);
