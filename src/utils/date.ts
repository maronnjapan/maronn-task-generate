const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * UTC の Date から JST の日付文字列を返す（例: "2026-03-04"）
 */
export function toJSTDateString(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * UTC の Date から JST の曜日を返す（例: "火"）
 */
export function toJSTDayOfWeek(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return DAY_NAMES[jst.getUTCDay()];
}

/**
 * UTC の Date から JST の時（0-23）を返す
 */
export function toJSTHour(date: Date): number {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours();
}
