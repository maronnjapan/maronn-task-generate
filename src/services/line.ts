/**
 * LINE Webhook の署名検証
 */
export async function verifySignature(
  body: string,
  signature: string,
  channelSecret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

/**
 * LINE Content API で音声バイナリを取得する
 */
export async function fetchAudioContent(
  messageId: string,
  accessToken: string
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch audio content: ${res.status} ${res.statusText}`);
  }
  return res.arrayBuffer();
}

/**
 * LINE Reply API でテキストメッセージを返信する。
 * LINE のテキストメッセージは5000文字制限があるため、超過時は分割して送信する。
 */
export async function replyMessage(
  replyToken: string,
  text: string,
  accessToken: string
): Promise<void> {
  const MAX_LENGTH = 5000;
  const chunks: string[] = [];

  if (text.length <= MAX_LENGTH) {
    chunks.push(text);
  } else {
    let remaining = text;
    while (remaining.length > 0 && chunks.length < 5) {
      chunks.push(remaining.slice(0, MAX_LENGTH));
      remaining = remaining.slice(MAX_LENGTH);
    }
  }

  const messages = chunks.map((chunk) => ({
    type: "text" as const,
    text: chunk,
  }));

  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`LINE reply failed: ${res.status} ${errorBody}`);
  }
}
