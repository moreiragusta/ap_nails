export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function api<T = unknown>(path: string, opts: { method?: string; body?: Body } = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? (isForm ? (opts.body as FormData) : JSON.stringify(opts.body)) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Sem conexão. Verifique a internet e tente de novo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path.startsWith('/api/admin') && !path.endsWith('/login')) {
      window.dispatchEvent(new Event('apn:unauthorized'));
    }
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'Algo deu errado.', data as Record<string, unknown>);
  }
  return data as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');
