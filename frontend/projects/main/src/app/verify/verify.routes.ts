import { Route, UrlMatchResult, UrlSegment } from '@angular/router';

/** Matches [first, second?, :param] case-insensitively (the old MVC routes were case-insensitive; QR codes say /Verify/BC/...). */
function matcher(first: string, second: string | null, param: string, extra: string | null = null) {
  return (segments: UrlSegment[]): UrlMatchResult | null => {
    const n = second ? 3 : 2;
    const total = extra ? n + 1 : n;
    if (segments.length !== total || segments[0].path.toLowerCase() !== first) return null;
    if (second && segments[1].path.toLowerCase() !== second) return null;
    const posParams: Record<string, UrlSegment> = { [param]: segments[n - 1] };
    if (extra) posParams[extra] = segments[n];
    return { consumed: segments, posParams };
  };
}

/** Matches /{prefix}/SA/ReportSummary/{id} case-insensitively (the old surveillance and consultancy applications). */
function reportMatcher(prefix: string) {
  return (segments: UrlSegment[]): UrlMatchResult | null =>
    segments.length === 4 &&
    segments[0].path.toLowerCase() === prefix &&
    segments[1].path.toLowerCase() === 'sa' &&
    segments[2].path.toLowerCase() === 'reportsummary'
      ? { consumed: segments, posParams: { id: segments[3] } }
      : null;
}

/**
 * Public certificate verification (/verify/{pc|bc|sc|gc}/{code}, also /Verify/BC/{code} as printed in the QR
 * codes) and the old report addresses from e-mails and pages already sent: /SA/ReportSummary/{id}?certification=X,
 * /surveillance/SA/ReportSummary/{id}?certification=X and /consultancy/SA/ReportSummary/{id}?certification=X&milestone=n
 * (these two reach this app only once IIS sends those paths here instead of the old applications).
 * Add before the '**' route in app.routes.ts: `...VERIFY_ROUTES`.
 */
export const VERIFY_ROUTES: Route[] = [
  {
    matcher: matcher('verify', null, 'type', 'code'),
    title: 'ZED | Certificate Verification',
    loadComponent: () => import('./verify').then((m) => m.VerifyPage),
  },
  {
    matcher: matcher('sa', 'reportsummary', 'id'),
    title: 'ZED | Assessment Report',
    loadComponent: () => import('./legacy-report').then((m) => m.LegacyReportRedirect),
  },
  {
    matcher: reportMatcher('surveillance'),
    title: 'ZED | Surveillance Report',
    data: { system: 'surveillance' },
    loadComponent: () => import('./legacy-report').then((m) => m.LegacyReportRedirect),
  },
  {
    matcher: reportMatcher('consultancy'),
    title: 'ZED | Handholding Report',
    data: { system: 'consultancy' },
    loadComponent: () => import('./legacy-report').then((m) => m.LegacyReportRedirect),
  },
];
