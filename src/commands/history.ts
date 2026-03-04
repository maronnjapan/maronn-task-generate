import { getRecentLogsAll } from "../db/queries";

/**
 * 直近7日間の学習履歴を表示する。
 */
export async function handleHistory(db: D1Database): Promise<string> {
  const logs = await getRecentLogsAll(db, 7);

  if (logs.length === 0) {
    return "📊 まだ記録がありません。\n「記録 英語 単語15分」のように記録してみましょう。";
  }

  const lines = logs.map((log) => {
    const condition = log.condition_level
      ? ` (コンディション: ${log.condition_level}/5)`
      : "";
    const summary = log.summary ?? "（学習記録なし）";
    return `📅 ${log.date}（${log.day_of_week}）${condition}\n   ${summary}`;
  });

  return `📊 直近の学習履歴\n\n${lines.join("\n\n")}`;
}
