/**
 * Typed client for the SIAB API.
 *
 * Every call attaches the caller's Supabase access token, and every failure
 * surfaces as an ApiClientError carrying a translation key — so screens show
 * a localised message rather than a raw English string from the server.
 */
import { accessToken, API_URL } from './supabase';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** Distinguishes "no internet" from "the server said no". */
export class NetworkError extends Error {
  readonly messageKey = 'error.network';
  constructor() {
    super('Network request failed');
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Some endpoints are readable signed out. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, anonymous = false, signal } = options;

  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';

  if (!anonymous) {
    const token = await accessToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch {
    // Thrown when the device is offline or the host is unreachable.
    throw new NetworkError();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; messageKey?: string; details?: unknown } })
      ?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? 'unknown',
      err?.messageKey ?? 'error.generic',
      err?.message ?? `Request failed with ${res.status}`,
      err?.details,
    );
  }

  return json as T;
}

/** Pulls a translation key out of any error, so screens never render raw text. */
export function errorKey(err: unknown): string {
  if (err instanceof ApiClientError) return err.messageKey;
  if (err instanceof NetworkError) return err.messageKey;
  return 'error.generic';
}

export function errorParams(err: unknown): Record<string, unknown> {
  if (err instanceof ApiClientError && err.details && typeof err.details === 'object') {
    return err.details as Record<string, unknown>;
  }
  return {};
}
