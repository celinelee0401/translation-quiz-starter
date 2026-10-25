const MAX_JSON_BODY_BYTES = 16 * 1024;

export class RequestInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(
  data: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

export function configurationRequired(): Response {
  return json(
    {
      status: 'error',
      code: 'CONFIGURATION_REQUIRED',
      error: '系統尚未完成安全設定，請稍後再試。',
    },
    503,
  );
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    throw new RequestInputError('無法確認請求來源。', 403);
  }
  if (origin !== expectedOrigin) {
    throw new RequestInputError('無法確認請求來源。', 403);
  }
}

export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestInputError('送出的資料過大。', 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new RequestInputError('送出的資料過大。', 413);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestInputError('請求內容格式不正確。');
  }
}
