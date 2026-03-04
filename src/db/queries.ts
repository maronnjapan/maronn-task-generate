import type { DailyLog, BlogItem } from "../types";

/**
 * 直近 N 件の学習記録を取得する（summary が入力済みのもののみ）。
 */
export async function getRecentLogs(
  db: D1Database,
  limit: number
): Promise<DailyLog[]> {
  const result = await db
    .prepare(
      `SELECT id, date, day_of_week, condition_level, summary
       FROM daily_logs
       WHERE summary IS NOT NULL
       ORDER BY date DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<DailyLog>();

  return result.results;
}

/**
 * 未公開のブログパイプラインを取得する。
 */
export async function getBlogPipeline(db: D1Database): Promise<BlogItem[]> {
  const result = await db
    .prepare(
      `SELECT id, title, status, note, updated_at
       FROM blog_pipeline
       WHERE status != 'published'
       ORDER BY updated_at DESC`
    )
    .all<BlogItem>();

  return result.results;
}

/**
 * 今日のコンディションログを保存する（UPSERT）。
 */
export async function saveDailyLog(
  db: D1Database,
  log: {
    date: string;
    dayOfWeek: string;
    conditionLevel: number;
    conditionReason: string;
    inputText: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO daily_logs (date, day_of_week, condition_level, condition_reason, input_text)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         condition_level = excluded.condition_level,
         condition_reason = excluded.condition_reason,
         input_text = excluded.input_text`
    )
    .bind(
      log.date,
      log.dayOfWeek,
      log.conditionLevel,
      log.conditionReason,
      log.inputText
    )
    .run();
}

/**
 * 学習記録のサマリーを更新する。
 */
export async function updateDailyLogSummary(
  db: D1Database,
  date: string,
  dayOfWeek: string,
  summary: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO daily_logs (date, day_of_week, summary)
       VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         summary = excluded.summary`
    )
    .bind(date, dayOfWeek, summary)
    .run();
}

/**
 * ブログテーマを追加する。
 */
export async function addBlogItem(
  db: D1Database,
  title: string
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO blog_pipeline (title) VALUES (?) RETURNING id`
    )
    .bind(title)
    .first<{ id: number }>();

  return result?.id ?? 0;
}

/**
 * ブログテーマのステータスを更新する。
 */
export async function updateBlogStatus(
  db: D1Database,
  id: number,
  status: string,
  note?: string
): Promise<boolean> {
  const validStatuses = ["backlog", "researching", "testing", "writing", "published"];
  if (!validStatuses.includes(status)) {
    return false;
  }

  const result = note !== undefined
    ? await db
        .prepare(
          `UPDATE blog_pipeline SET status = ?, note = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .bind(status, note, id)
        .run()
    : await db
        .prepare(
          `UPDATE blog_pipeline SET status = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .bind(status, id)
        .run();

  return result.meta.changes > 0;
}

/**
 * 全ブログテーマを取得する（公開済み含む）。
 */
export async function getAllBlogItems(db: D1Database): Promise<BlogItem[]> {
  const result = await db
    .prepare(
      `SELECT id, title, status, note, updated_at
       FROM blog_pipeline
       ORDER BY
         CASE status
           WHEN 'writing' THEN 1
           WHEN 'testing' THEN 2
           WHEN 'researching' THEN 3
           WHEN 'backlog' THEN 4
           WHEN 'published' THEN 5
         END,
         updated_at DESC`
    )
    .all<BlogItem>();

  return result.results;
}

/**
 * 直近 N 日分の学習記録を取得する（全件、summary なし含む）。
 */
export async function getRecentLogsAll(
  db: D1Database,
  limit: number
): Promise<DailyLog[]> {
  const result = await db
    .prepare(
      `SELECT id, date, day_of_week, condition_level, condition_reason, summary
       FROM daily_logs
       ORDER BY date DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<DailyLog>();

  return result.results;
}
