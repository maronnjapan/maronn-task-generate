// --- LINE Webhook 型 ---

export type LineWebhookBody = {
  events: LineWebhookEvent[];
};

export type LineWebhookEvent = {
  type: "message" | "follow" | "unfollow" | string;
  replyToken: string;
  message: LineMessage;
};

export type LineMessage =
  | { type: "text"; text: string }
  | { type: "audio"; id: string; duration: number }
  | { type: string };

// --- DB 型 ---

export type DailyLog = {
  id: number;
  date: string;
  day_of_week: string;
  condition_level: number | null;
  condition_reason: string | null;
  input_text: string | null;
  summary: string | null;
  created_at: string;
};

export type BlogItem = {
  id: number;
  title: string;
  status: "backlog" | "researching" | "testing" | "writing" | "published";
  note: string | null;
  updated_at: string;
};

// --- コンディション判定 ---

export type ConditionLevel = 1 | 2 | 3 | 4 | 5;

export type ConditionResult = {
  level: ConditionLevel;
  reason: string;
  matchedKeywords: string[];
};

// --- Bindings ---

export type Bindings = {
  AI: Ai;
  DB: D1Database;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
};
