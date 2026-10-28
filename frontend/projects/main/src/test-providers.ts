import { Provider } from '@angular/core';
import { PORTAL_LINK_DEFAULTS, PortalLinkKey, PortalLinksService } from '@zed/shared';
import { ContentService } from './app/content/content-text';

/**
 * Providers for every spec. The Admin's Texts are not loaded in page specs: pages show their own copy, and no spec
 * has to answer the api/content request (content-text.spec.ts tests the real service). Likewise the links of Admin →
 * Links are the default addresses (app/portal-links.spec.ts tests the real service).
 */
const providers: Provider[] = [
  { provide: ContentService, useValue: { text: () => null } },
  { provide: PortalLinksService, useValue: { url: (key: PortalLinkKey) => PORTAL_LINK_DEFAULTS[key] } },
];

export default providers;
