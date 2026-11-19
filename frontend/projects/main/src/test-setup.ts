import { afterEach } from 'vitest';
import { setPageTexts } from './app/content/page-text';

/**
 * 2026-11-19: the Admin's page wording is module state (content/page-text.ts). A spec that sets it (to show the Admin's
 * wording replacing the standard text) must not leak it into the next spec, so it is cleared after every test.
 */
afterEach(() => setPageTexts(null));
