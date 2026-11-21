import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { AppTexts, fillPlaceholders, type ResolvedText } from './appTexts';

type TextsContext = { texts: AppTexts; app: string | null };

const Ctx = createContext<TextsContext | null>(null);

/**
 * @param app the app's key prefix in Admin → Texts (`app.msme`, `app.assessor`, `app.consultant`), so that shared
 * components (voice typing) find the app's own texts with {@link useSharedAppText}.
 */
export function AppTextsProvider({ texts, app, children }: { texts: AppTexts; app?: string; children: React.ReactNode }) {
  const value = React.useMemo(() => ({ texts, app: app ?? null }), [texts, app]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const EMPTY = new AppTexts(null, {});

/**
 * The Admin's text for a key (re-rendered when a newer answer arrives), else the built-in wording; `null` when the
 * Admin switched it off. Without a provider: the `fallback` given here.
 */
export function useAppText(key: string, fields?: Record<string, string | number | null | undefined>, fallback?: string): ResolvedText {
  const ctx = useContext(Ctx);
  const source = ctx?.texts ?? EMPTY;
  useSyncExternalStore(
    l => source.subscribe(l),
    () => source.getRevision(),
  );
  if (!ctx) return fallback == null ? { html: '', fromServer: false } : { html: fallback, fromServer: false };
  return ctx.texts.get(key, fields);
}

/**
 * A shared component's text: `<app prefix>.<suffix>` of the app around it (see {@link AppTextsProvider}), else the
 * `fallback` wording. Plain HTML as the Admin saved it; `null` when the Admin switched it off.
 */
export function useSharedAppText(suffix: string, fallback: string, fields?: Record<string, string | number | null | undefined>): ResolvedText {
  const ctx = useContext(Ctx);
  const resolved = useAppText(ctx?.app ? `${ctx.app}.${suffix}` : '', fields, fallback);
  if (!ctx?.app) return { html: fillPlaceholders(fallback, fields), fromServer: false };
  if (resolved && !resolved.fromServer && resolved.html === '') return { html: fillPlaceholders(fallback, fields), fromServer: false };
  return resolved;
}
