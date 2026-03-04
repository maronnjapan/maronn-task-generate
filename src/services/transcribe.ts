/**
 * Cloudflare Workers AI (Whisper) で音声を文字起こしする。
 */
export async function transcribeAudio(
  ai: Ai,
  audioBuffer: ArrayBuffer
): Promise<string> {
  const result = await ai.run("@cf/openai/whisper", {
    audio: [...new Uint8Array(audioBuffer)],
  });
  return result.text ?? "";
}
