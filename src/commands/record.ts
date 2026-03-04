import { toJSTDateString, toJSTDayOfWeek } from "../utils/date";
import { updateDailyLogSummary } from "../db/queries";

/**
 * 「記録」コマンドをパースする。
 * フォーマット: 「記録 <内容>」
 */
export function parseRecord(text: string): string | null {
  const match = text.match(/^記録\s+(.+)$/s);
  return match ? match[1].trim() : null;
}

/**
 * 学習記録を保存し、確認メッセージを返す。
 */
export async function handleRecord(
  db: D1Database,
  content: string
): Promise<string> {
  const now = new Date();
  const date = toJSTDateString(now);
  const dayOfWeek = toJSTDayOfWeek(now);

  await updateDailyLogSummary(db, date, dayOfWeek, content);

  return `✅ 記録しました（${date} ${dayOfWeek}）\n${content}`;
}
