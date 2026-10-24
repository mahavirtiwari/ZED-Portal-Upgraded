import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { AppTextsProvider } from '@zed/shared';
import type { SaApp } from './SaApp';

const AppContext = createContext<SaApp | null>(null);

export function SaAppProvider({ app, children }: { app: SaApp; children: React.ReactNode }) {
  return (
    <AppContext.Provider value={app}>
      <AppTextsProvider texts={app.texts}>{children}</AppTextsProvider>
    </AppContext.Provider>
  );
}

/** The app state; the calling component re-renders after every touch()/update(). */
export function useSa(): SaApp {
  const app = useContext(AppContext);
  if (!app) throw new Error('useSa outside SaAppProvider');
  useSyncExternalStore(
    l => app.subscribe(l),
    () => app.getRevision(),
  );
  return app;
}
