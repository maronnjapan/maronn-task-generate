import { Hono } from "hono";
import type { Bindings, LineWebhookBody } from "../types";
import { verifySignature, fetchAudioContent, replyMessage } from "../services/line";
import { transcribeAudio } from "../services/transcribe";
import { handleMessage } from "../commands/router";

const webhook = new Hono<{ Bindings: Bindings }>();

webhook.post("/line", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-line-signature") ?? "";

  // 署名検証
  const valid = await verifySignature(
    body,
    signature,
    c.env.LINE_CHANNEL_SECRET
  );
  if (!valid) {
    return c.text("Invalid signature", 401);
  }

  const parsed: LineWebhookBody = JSON.parse(body);

  // 各イベントを処理（LINE は複数イベントを1リクエストで送る場合がある）
  for (const event of parsed.events) {
    if (event.type !== "message") continue;

    let userText: string;

    if (event.message.type === "audio") {
      try {
        const audioMessage = event.message as { type: "audio"; id: string; duration: number };
        const audioBuffer = await fetchAudioContent(
          audioMessage.id,
          c.env.LINE_CHANNEL_ACCESS_TOKEN
        );
        userText = await transcribeAudio(c.env.AI, audioBuffer);
        if (!userText.trim()) {
          await replyMessage(
            event.replyToken,
            "🎤 音声を認識できませんでした。もう一度送信するか、テキストで入力してください。",
            c.env.LINE_CHANNEL_ACCESS_TOKEN
          );
          continue;
        }
      } catch (error) {
        console.error("Audio transcription error:", error);
        await replyMessage(
          event.replyToken,
          "⚠️ 音声の処理中にエラーが発生しました。テキストで入力してください。",
          c.env.LINE_CHANNEL_ACCESS_TOKEN
        );
        continue;
      }
    } else if (event.message.type === "text") {
      userText = (event.message as { type: "text"; text: string }).text;
    } else {
      // 画像・スタンプ等は無視
      continue;
    }

    try {
      const response = await handleMessage(userText, c.env.DB);
      await replyMessage(
        event.replyToken,
        response,
        c.env.LINE_CHANNEL_ACCESS_TOKEN
      );
    } catch (error) {
      console.error("Message handling error:", error);
      await replyMessage(
        event.replyToken,
        "⚠️ エラーが発生しました。もう一度お試しください。",
        c.env.LINE_CHANNEL_ACCESS_TOKEN
      );
    }
  }

  // LINE は常に 200 を返す必要がある（再送を防ぐため）
  return c.text("OK", 200);
});

export default webhook;
