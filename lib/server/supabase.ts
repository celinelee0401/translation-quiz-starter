import type { DataConfig } from './config.ts';

export class SupabaseRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('Supabase request failed.');
    this.status = status;
  }
}

export async function supabaseRpc<T>(
  config: DataConfig,
  functionName: string,
  parameters: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(
      `${config.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      {
        method: 'POST',
        headers: {
          apikey: config.supabaseSecretKey,
          authorization: `Bearer ${config.supabaseSecretKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(parameters),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new SupabaseRequestError(503);
  }

  if (!response.ok) throw new SupabaseRequestError(response.status);
  try {
    return (await response.json()) as T;
  } catch {
    throw new SupabaseRequestError(502);
  }
}
