// AI 供應商設定。AI_PROVIDER=none 時整個系統只用固定規則＋教師覆核；
// 未設定 AI_PROVIDER 時，有 OPENAI_API_KEY 就用 OpenAI，沒有就關閉。
// 要加 Gemini、Claude 等供應商，在這裡新增一種 provider 並實作 requestStructuredJson。
export type AiConfig = { provider: 'openai'; apiKey: string; model: string };

const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';

export function getAiConfig(): AiConfig | null {
  // The deploy form cannot leave a secret blank, so `none` also means "no key".
  const rawKey = process.env.OPENAI_API_KEY?.trim();
  const apiKey = rawKey && rawKey.toLowerCase() !== 'none' ? rawKey : '';
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() || (apiKey ? 'openai' : 'none');
  if (provider !== 'openai' || !apiKey) return null;
  return { provider, apiKey, model: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL };
}

export const aiNotConfiguredMessage = 'AI 功能未開啟（AI_PROVIDER=none 或尚未設定 OPENAI_API_KEY）。';

export function aiHttpErrorMessage(status: number, code?: string): string {
  if (status === 429 && code === 'insufficient_quota') return 'AI 額度不足（insufficient_quota）。請到 OpenAI 帳單頁儲值或提高額度後再試。';
  if (status === 429 && code === 'rate_limit_exceeded') return 'AI 呼叫太頻繁（rate limit）。請稍後再按一次，系統會從沒做完的題目接著做。';
  if (status === 401 || status === 403) return `AI 金鑰無效、已過期或沒有權限（HTTP ${status}）。請檢查 OPENAI_API_KEY。`;
  if (status === 400 || status === 404) return `AI 模型名稱或請求格式不被接受（HTTP ${status}）。請檢查 OPENAI_MODEL。`;
  if (status === 429) return 'AI 額度不足或呼叫太頻繁（HTTP 429）。請檢查 OpenAI 帳單額度，稍後再試。';
  if (status >= 500) return `OpenAI 服務暫時異常（HTTP ${status}），請稍後再試。`;
  return `AI 服務暫時無法使用（HTTP ${status}）。`;
}

/** Sends one structured-output request and returns the JSON text the model produced. */
export async function requestStructuredJson(
  ai: AiConfig,
  request: {
    instructions: string;
    input: string;
    schemaName: string;
    schema: Record<string, unknown>;
    maxOutputTokens: number;
    timeoutMs: number;
  },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${ai.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ai.model,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: request.maxOutputTokens,
      instructions: request.instructions,
      input: request.input,
      text: { format: { type: 'json_schema', name: request.schemaName, strict: true, schema: request.schema } },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new Error(aiHttpErrorMessage(response.status, detail?.error?.code));
  }
  const body = await response.json() as {
    status?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const output = body.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text;
  if (body.status !== 'completed' || !output) throw new Error('AI 尚未產生完整結果，請稍後再試。');
  return output;
}
