import { Provider } from '@angular/core';
import { ContentService } from './app/content/content-text';

/**
 * Providers for every spec. The Admin's Texts are not loaded in page specs: pages show their own copy, and no spec
 * has to answer the api/content request (content-text.spec.ts tests the real service).
 */
const providers: Provider[] = [{ provide: ContentService, useValue: { text: () => null } }];

export default providers;
