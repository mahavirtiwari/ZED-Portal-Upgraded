import { useCallback, useSyncExternalStore } from 'react';
import { htmlToPlain, type AppTexts } from '@zed/shared';
import { useSa } from '../app/context';
import type { Problem } from './visits';

/** The prefix of the scheme visits' texts (Admin → Texts, "Assessor app", backend ContentCatalogue.Apps.cs). */
export const SCHEME_TEXTS = 'app.assessor.schemes.';

export type TextFields = Record<string, string | number | null | undefined>;

/**
 * A scheme visit text as plain text: the Admin's wording (Admin → Texts) or the standard one (builtInTexts.ts, generated from
 * the server's catalogue); empty when the Admin switched it off.
 */
export function schemeText(texts: AppTexts, key: string, fields?: TextFields): string {
  const r = texts.get(SCHEME_TEXTS + key, fields);
  return r ? htmlToPlain(r.html).trim() : '';
}

/** `t(key, fields)` of the scheme visit screens, re-rendered when newer Admin texts arrive. */
export function useSchemeTexts(): (key: string, fields?: TextFields) => string {
  const app = useSa();
  const revision = useSyncExternalStore(
    l => app.texts.subscribe(l),
    () => app.texts.getRevision(),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((key: string, fields?: TextFields) => schemeText(app.texts, key, fields), [app, revision]);
}

/** The line of a readiness problem (app.assessor.schemes.ready.*). */
export const problemText = (t: (key: string, fields?: TextFields) => string, p: Problem) => t('ready.' + p.code, p.fields);
