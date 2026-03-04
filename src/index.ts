import { Hono } from "hono";
import type { Bindings } from "./types";
import webhook from "./routes/webhook";

const app = new Hono<{ Bindings: Bindings }>();

// ヘルスチェック
app.get("/", (c) => c.text("input-cycle-bot is running"));

// LINE Webhook
app.route("/webhook", webhook);

export default app;
