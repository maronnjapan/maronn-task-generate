import {
  addBlogItem,
  updateBlogStatus,
  getAllBlogItems,
} from "../db/queries";

const STATUS_LABELS: Record<string, string> = {
  backlog: "📋 バックログ",
  researching: "🔍 調査中",
  testing: "🧪 検証中",
  writing: "✍️ 執筆中",
  published: "✅ 公開済",
};

/**
 * 「ブログ」コマンドを処理する。
 *
 * サブコマンド:
 * - ブログ一覧
 * - ブログ追加 <テーマ名>
 * - ブログ更新 <ID> <status> [メモ]
 */
export async function handleBlogCommand(
  db: D1Database,
  text: string
): Promise<string> {
  const trimmed = text.replace(/^ブログ\s*/, "");

  // ブログ一覧
  if (trimmed === "一覧" || trimmed === "") {
    const items = await getAllBlogItems(db);
    if (items.length === 0) {
      return "📋 ブログテーマはまだ登録されていません。\n「ブログ追加 テーマ名」で追加できます。";
    }
    const lines = items.map(
      (item) =>
        `${STATUS_LABELS[item.status] ?? item.status} [ID:${item.id}] ${item.title}${item.note ? `\n   📝 ${item.note}` : ""}`
    );
    return `📋 ブログパイプライン\n\n${lines.join("\n\n")}`;
  }

  // ブログ追加
  const addMatch = trimmed.match(/^追加\s+(.+)$/s);
  if (addMatch) {
    const title = addMatch[1].trim();
    const id = await addBlogItem(db, title);
    return `✅ ブログテーマを追加しました\n[ID:${id}] ${title}\nステータス: backlog`;
  }

  // ブログ更新
  const updateMatch = trimmed.match(/^更新\s+(\d+)\s+(backlog|researching|testing|writing|published)(?:\s+(.+))?$/s);
  if (updateMatch) {
    const id = parseInt(updateMatch[1], 10);
    const status = updateMatch[2];
    const note = updateMatch[3]?.trim();
    const success = await updateBlogStatus(db, id, status, note);
    if (success) {
      return `✅ ブログ [ID:${id}] を ${STATUS_LABELS[status] ?? status} に更新しました${note ? `\n📝 ${note}` : ""}`;
    }
    return `❌ ID:${id} のテーマが見つかりません。「ブログ一覧」で確認してください。`;
  }

  // ヘルプ
  return `📋 ブログコマンド:
  ブログ一覧
  ブログ追加 <テーマ名>
  ブログ更新 <ID> <status> [メモ]

  status: backlog / researching / testing / writing / published`;
}
