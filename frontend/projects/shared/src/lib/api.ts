import { HttpErrorResponse, provideHttpClient, withXsrfConfiguration } from '@angular/common/http';
import { EnvironmentProviders } from '@angular/core';

/**
 * HttpClient set up for the ZED APIs: same-origin cookies, and the anti-forgery token the
 * API issues in the XSRF-TOKEN cookie is echoed back in the X-XSRF-TOKEN header.
 */
export function provideZedHttp(): EnvironmentProviders {
  return provideHttpClient(
    withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
  );
}

/** The API reports errors as RFC 7807 problem details; the user-facing text is in `title`. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Unable to reach the server. Please check your connection and try again.';
    if (err.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    const title = (err.error as { title?: string } | null)?.title;
    if (title) return title;
  }
  return 'Unexpected error occured. Please try after some time.';
}

export interface MessageResponse {
  message: string;
}
