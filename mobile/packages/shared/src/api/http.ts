/**
 * HTTP client for the V4 mobile API, with the legacy apps' conventions (Retrofit + Gson + OkHttp):
 * JSON bodies, multipart uploads, 60 s timeouts, no authentication header.
 *
 * Errors keep what the legacy screens showed: an HTTP error status becomes "HTTP <code> <message>"
 * (Retrofit's HttpException text), a failed connection is a {@link NetworkError} (the sync queue retries
 * those later instead of treating them as a refusal).
 */

export const DEFAULT_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The request never got an HTTP answer (no network, DNS, timeout, TLS). */
export class NetworkError extends ApiError {
  constructor(message: string) {
    super(message, null);
    this.name = 'NetworkError';
  }
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError || (e instanceof Error && e.name === 'NetworkError');
}

/** A file part: a local file (file:// or content://) sent like OkHttp's asRequestBody. */
export type FilePart = { uri: string; name: string; type: string };

export type MultipartField = { name: string; value: string } | { name: string; file: FilePart };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HttpClientOptions = {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Called for each request (for logs without bodies). */
  onRequest?: (method: string, url: string) => void;
};

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Request Entity Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export class HttpClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly onRequest?: (method: string, url: string) => void;

  constructor(options: HttpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.onRequest = options.onRequest;
  }

  async getJson<T>(url: string): Promise<T> {
    return this.parse<T>(await this.send('GET', url, undefined, {}));
  }

  /** JSON body as Gson wrote it: null fields left out. */
  async postJson<T>(url: string, body: unknown): Promise<T> {
    const json = JSON.stringify(body, (_k, v) => (v === null ? undefined : v));
    return this.parse<T>(await this.send('POST', url, json, { 'Content-Type': 'application/json; charset=UTF-8' }));
  }

  async postMultipart<T>(url: string, fields: MultipartField[]): Promise<T> {
    const form = new FormData();
    for (const f of fields) {
      if ('file' in f) {
        // React Native's FormData takes {uri, name, type} for file parts.
        form.append(f.name, f.file as unknown as Blob);
      } else {
        form.append(f.name, f.value);
      }
    }
    return this.parse<T>(await this.send('POST', url, form, {}));
  }

  /** Downloads raw text (used for checks); throws like the JSON calls. */
  async getText(url: string): Promise<string> {
    const res = await this.send('GET', url, undefined, {});
    return res.text();
  }

  private async send(method: string, url: string, body: BodyInit | undefined, headers: Record<string, string>) {
    this.onRequest?.(method, url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, body, headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    } catch (e) {
      const aborted = controller.signal.aborted;
      throw new NetworkError(aborted ? 'timeout' : e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // V4 answers unhandled errors with a legacy JSON body ({status:"0", errorMessage}); Retrofit still threw on
      // the status code, so the screens showed "HTTP 500 ...". Keep that.
      throw new ApiError(`HTTP ${res.status} ${res.statusText || STATUS_TEXT[res.status] || ''}`.trim(), res.status);
    }
    return res;
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (text.trim() === '') throw new ApiError('Empty response', res.status);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError('Invalid response from server', res.status);
    }
  }
}
