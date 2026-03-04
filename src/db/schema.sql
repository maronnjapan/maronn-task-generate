CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  day_of_week TEXT NOT NULL,
  condition_level INTEGER,
  condition_reason TEXT,
  input_text TEXT,
  summary TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);

CREATE TABLE IF NOT EXISTS blog_pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'backlog',
  note TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
