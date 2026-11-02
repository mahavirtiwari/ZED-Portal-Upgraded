import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { AppTextsProvider, htmlToPlain, OfflineNoteProvider, useAppText } from '@zed/shared';
import type { MsmeApp } from './MsmeApp';

const AppContext = createContext<MsmeApp | null>(null);

export function MsmeAppProvider({ app, children }: { app: MsmeApp; children: React.ReactNode }) {
  return (
    <AppContext.Provider value={app}>
      <AppTextsProvider texts={app.texts}>
        <OfflineNote>{children}</OfflineNote>
      </AppTextsProvider>
    </AppContext.Provider>
  );
}

/** The red offline banner of every screen with the Admin's wording (app.msme.offline.note). */
function OfflineNote({ children }: { children: React.ReactNode }) {
  const t = useAppText('app.msme.offline.note');
  return <OfflineNoteProvider value={t ? htmlToPlain(t.html) : null}>{children}</OfflineNoteProvider>;
}

/** The app state; the calling component re-renders after every touch()/persist(). */
export function useMsme(): MsmeApp {
  const app = useContext(AppContext);
  if (!app) throw new Error('useMsme outside MsmeAppProvider');
  useSyncExternalStore(
    l => app.subscribe(l),
    () => app.getRevision(),
  );
  return app;
}
