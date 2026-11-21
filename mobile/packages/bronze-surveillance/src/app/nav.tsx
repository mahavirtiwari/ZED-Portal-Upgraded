import React, { createContext, useContext, useMemo } from 'react';
import { useNavigation as useStackNavigation, type Navigation } from '@zed/shared';

/**
 * Where the Bronze surveillance screens live (2026-11-21). In the ZED Surveillance build they are the app's own routes
 * (no prefix). In ZED SA they are registered with a prefix ("Bronze.") beside ZED SA's screens, the module's own routes are
 * looked up with it, and the routes that left the module in the old app (its Dashboard after a final submit, the login page)
 * go to the host's pages instead (`exits`).
 */
export type BronzeHost = {
  /** Put before every route name of the module. */
  prefix: string;
  /** A reset to one of these module routes (by its unprefixed name) goes to the host's routes instead, as they are. */
  exits?: Readonly<Record<string, ReadonlyArray<{ name: string; params?: Record<string, unknown> }>>>;
  /** Shown inside another app: Back on the module's first page returns to the host instead of asking to exit. */
  embedded?: boolean;
};

const STANDALONE: BronzeHost = { prefix: '' };

const HostContext = createContext<BronzeHost>(STANDALONE);

export function BronzeHostProvider({ host, children }: { host: BronzeHost; children: React.ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useBronzeHost(): BronzeHost {
  return useContext(HostContext);
}

/** The route name of a module page in the host's navigator. */
export const routeName = (host: BronzeHost, name: string) => host.prefix + name;

/** {@link useStackNavigation} with the module's route names put in the host's navigator. */
export function useNavigation(): Navigation {
  const nav = useStackNavigation();
  const host = useBronzeHost();
  return useMemo(() => {
    if (!host.prefix && !host.exits) return nav;
    const name = (n: string) => routeName(host, n);
    const wrapped: Navigation = {
      push: (n, params) => nav.push(name(n), params),
      replace: (n, params) => nav.replace(name(n), params),
      pop: count => nav.pop(count),
      reset: list => {
        const exit = list.length > 0 ? host.exits?.[list[0]!.name] : undefined;
        if (exit) nav.reset(exit.map(r => ({ ...r })));
        else nav.reset(list.map(r => ({ ...r, name: name(r.name) })));
      },
      popTo: n => nav.popTo(name(n)),
      get routes() {
        return nav.routes;
      },
      canGoBack: () => nav.canGoBack(),
    };
    return wrapped;
  }, [nav, host]);
}
