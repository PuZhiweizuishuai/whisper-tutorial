import { Buffer } from "node:buffer";
import type { Ai } from "workers-ai";

export interface Env {
  AI: Ai;
  // 如果需要，添加您的 KV 命名空间以存储转录。
  // MY_KV_NAMESPACE: KVNamespace;
}

/**
 * 从提供的 URL 获取音频文件并将其分割成块。
 * 此函数明确遵循重定向。
 *
 * @param audioUrl - 音频文件的 URL。
 * @returns 一个 ArrayBuffer 数组，每个代表一个音频块。
 */
async function getAudioChunks(audioUrl: string): Promise<ArrayBuffer[]> {
  const response = await fetch(audioUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`获取音频失败：${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();

  // 示例：将音频分割成 1MB 的块。
  const chunkSize = 1024 * 1024; // 1MB
  const chunks: ArrayBuffer[] = [];
  for (let i = 0; i < arrayBuffer.byteLength; i += chunkSize) {
    const chunk = arrayBuffer.slice(i, i + chunkSize);
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * 使用 Whisper‑large‑v3‑turbo 模型转录单个音频块。
 * 该函数将音频块转换为 Base64 编码的字符串，并
 * 通过 AI 绑定将其发送到模型。
 *
 * @param chunkBuffer - 作为 ArrayBuffer 的音频块。
 * @param env - Cloudflare Worker 环境，包括 AI 绑定。
 * @returns 来自模型的转录文本。
 */
async function transcribeChunk(
  chunkBuffer: ArrayBuffer,
  env: Env,
): Promise<string> {
  const base64 = Buffer.from(chunkBuffer, "binary").toString("base64");
  const res = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: base64,
    // 可选参数（如果需要，取消注释并设置）：
    task: "transcribe", // 或 "translate"
    // language: "en",
    // vad_filter: "false",
    // initial_prompt: "如果需要，提供上下文。",
    // prefix: "转录：",
  });
  return JSON.stringify(res); // 假设转录结果包括一个 "text" 属性。
}

/**
 * 主 fetch 处理程序。它提取 'url' 查询参数，获取音频，
 * 以块为单位处理它，并返回完整的转录。
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // 从查询参数中提取音频 URL。
    const { searchParams } = new URL(request.url);
    const audioUrl = searchParams.get("url");

    if (!audioUrl) {
      return new Response("缺少 'url' 查询参数", { status: 400 });
    }

    // 获取音频块。
    const audioChunks: ArrayBuffer[] = await getAudioChunks(audioUrl);
    let fullTranscript = "";

    // 处理每个块并构建完整的转录。
    for (const chunk of audioChunks) {
      try {
        const transcript = await transcribeChunk(chunk, env);
        fullTranscript += transcript + "\n";
      } catch (error) {
        fullTranscript += "[转录块时出错]\n";
      }
    }

    return new Response(fullTranscript, {
      headers: { "Content-Type": "text/plain; charset=UTF-8" },
    });
  },
} satisfies ExportedHandler<Env>;