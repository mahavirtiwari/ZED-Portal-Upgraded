import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { AppTexts, type ResolvedText } from './appTexts';

const Ctx = createContext<AppTexts | null>(null);

export function AppTextsProvider({ texts, children }: { texts: AppTexts; children: React.ReactNode }) {
  return <Ctx.Provider value={texts}>{children}</Ctx.Provider>;
}

const EMPTY = new AppTexts(null, {});

/**
 * The Admin's text for a key (re-rendered when a newer answer arrives), else the built-in wording; `null` when the
 * Admin switched it off. Without a provider: the `fallback` given here.
 */
export function useAppText(key: string, fields?: Record<string, string | number | null | undefined>, fallback?: string): ResolvedText {
  const texts = useContext(Ctx);
  const source = texts ?? EMPTY;
  useSyncExternalStore(
    l => source.subscribe(l),
    () => source.getRevision(),
  );
  if (!texts) return fallback == null ? { html: '', fromServer: false } : { html: fallback, fromServer: false };
  return texts.get(key, fields);
}
