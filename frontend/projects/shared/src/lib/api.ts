import { HttpErrorResponse, HttpInterceptorFn, provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import { EnvironmentProviders } from '@angular/core';

/**
 * HttpClient set up for the ZED APIs: same-origin cookies, and the anti-forgery token the
 * API issues in the XSRF-TOKEN cookie is echoed back in the X-XSRF-TOKEN header.
 */
export function provideZedHttp(interceptors: HttpInterceptorFn[] = []): EnvironmentProviders {
  return provideHttpClient(
    withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
    withInterceptors(interceptors),
  );
}

/**
 * 2026-11-21 (server log): the short reference of a server error, the start of the trace id the API puts in its problem
 * details ("00-<trace id>-<span>-00"); Admin → Server Logs finds the error by it. Null when there is none.
 */
export function errorReference(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse) || err.status < 500) return null;
  const trace = (err.error as { traceId?: string } | null)?.traceId;
  const m = typeof trace === 'string' ? /^[0-9a-f]{2}-([0-9a-f]{32})-/i.exec(trace) : null;
  return m ? m[1].slice(0, 8).toLowerCase() : null;
}

/** The API reports errors as RFC 7807 problem details; the user-facing text is in `title` (a server error adds its reference). */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Unable to reach the server. Please check your connection and try again.';
    if (err.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    const title = (err.error as { title?: string } | null)?.title;
    const ref = errorReference(err);
    if (title) return ref ? `${title} (Reference: ${ref})` : title;
    if (ref) return `Unexpected error occurred. Please try after some time. (Reference: ${ref})`;
  }
  return 'Unexpected error occurred. Please try after some time.';
}

export interface MessageResponse {
  message: string;
}
