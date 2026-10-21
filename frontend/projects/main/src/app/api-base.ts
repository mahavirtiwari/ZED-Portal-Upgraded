import { HttpInterceptorFn } from '@angular/common/http';

/**
 * The pages call the API with absolute paths (`/api/...`). The Consultancy and Surveillance builds are served under
 * their old IIS folder (baseHref /Consultancy/, /surveillance/), where `/api` would reach main's API; this prefixes
 * those calls with the document's base path. Main (base "/") is unchanged.
 * Wire it in app.config.ts: provideHttpClient(..., withInterceptors([apiBaseInterceptor])).
 */
export function apiBasePath(baseHref: string = document.querySelector('base')?.getAttribute('href') ?? '/'): string {
  const path = baseHref.replace(/\/+$/, '');
  return path === '' || path === '/' ? '' : path.startsWith('/') ? path : '/' + path;
}

/** `/api/x` → `{base}/api/x`; any other URL is left alone. */
export function withApiBase(url: string, base: string = apiBasePath()): string {
  return base && (url === '/api' || url.startsWith('/api/')) ? base + url : url;
}

export const apiBaseInterceptor: HttpInterceptorFn = (req, next) => {
  const url = withApiBase(req.url);
  return next(url === req.url ? req : req.clone({ url }));
};
