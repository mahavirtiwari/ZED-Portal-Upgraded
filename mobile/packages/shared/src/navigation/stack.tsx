import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

/**
 * A minimal stack navigator, enough for the legacy apps' activity/fragment back stacks: every route stays mounted
 * underneath (state kept, like a stopped activity), only the top one is shown and gets the back button.
 * No native dependency.
 */
export type Route = { key: string; name: string; params?: Record<string, unknown> };

export type Navigation = {
  push(name: string, params?: Record<string, unknown>): void;
  /** Replace the top route (startActivity + finish()). */
  replace(name: string, params?: Record<string, unknown>): void;
  pop(count?: number): void;
  /** New task (FLAG_ACTIVITY_NEW_TASK | CLEAR_TASK). */
  reset(routes: Array<{ name: string; params?: Record<string, unknown> }>): void;
  /** Pops routes above the first one with this name; returns false if there is none. */
  popTo(name: string): boolean;
  readonly routes: Route[];
  canGoBack(): boolean;
};

type Ctx = {
  nav: Navigation;
  register(key: string, handler: (() => boolean) | null): void;
  topKey: string;
};

const NavContext = createContext<Ctx | null>(null);
const RouteContext = createContext<Route | null>(null);

let keySeq = 0;
const newKey = (name: string) => `${name}-${++keySeq}`;

export type ScreenMap = Record<string, React.ComponentType<{ route: Route }>>;

export function StackNavigator({
  screens,
  initial,
  onExit,
  overlay,
}: {
  screens: ScreenMap;
  /** Rendered above the screens inside the navigator (a drawer that navigates). */
  overlay?: React.ReactNode;
  initial: { name: string; params?: Record<string, unknown> };
  /** Back on the last route (default: BackHandler.exitApp). */
  onExit?: () => void;
}) {
  const [routes, setRoutes] = useState<Route[]>(() => [{ key: newKey(initial.name), ...initial }]);
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const handlers = useRef(new Map<string, () => boolean>());

  const nav = useMemo<Navigation>(
    () => ({
      push: (name, params) => setRoutes(r => [...r, { key: newKey(name), name, params }]),
      replace: (name, params) => setRoutes(r => [...r.slice(0, -1), { key: newKey(name), name, params }]),
      pop: (count = 1) => setRoutes(r => (r.length > count ? r.slice(0, r.length - count) : r.slice(0, 1))),
      reset: list => setRoutes(list.map(x => ({ key: newKey(x.name), ...x }))),
      popTo: name => {
        const i = routesRef.current.findIndex(x => x.name === name);
        if (i < 0) return false;
        setRoutes(r => r.slice(0, i + 1));
        return true;
      },
      get routes() {
        return routesRef.current;
      },
      canGoBack: () => routesRef.current.length > 1,
    }),
    [],
  );

  const register = useCallback((key: string, handler: (() => boolean) | null) => {
    if (handler) handlers.current.set(key, handler);
    else handlers.current.delete(key);
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const top = routesRef.current[routesRef.current.length - 1];
      const h = top ? handlers.current.get(top.key) : undefined;
      if (h && h()) return true;
      if (routesRef.current.length > 1) {
        nav.pop();
        return true;
      }
      if (onExit) {
        onExit();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [nav, onExit]);

  const topKey = routes[routes.length - 1]!.key;
  const ctx = useMemo(() => ({ nav, register, topKey }), [nav, register, topKey]);

  return (
    <NavContext.Provider value={ctx}>
      {routes.map(route => {
        const Screen = screens[route.name];
        if (!Screen) throw new Error(`Unknown screen ${route.name}`);
        const top = route.key === topKey;
        return (
          <RouteContext.Provider key={route.key} value={route}>
            <View style={[StyleSheet.absoluteFill, !top && styles.hidden]} pointerEvents={top ? 'auto' : 'none'}>
              <Screen route={route} />
            </View>
          </RouteContext.Provider>
        );
      })}
      {overlay}
    </NavContext.Provider>
  );
}

export function useNavigation(): Navigation {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNavigation outside StackNavigator');
  return ctx.nav;
}

export function useRoute<P extends Record<string, unknown> = Record<string, unknown>>(): Route & { params: P } {
  const r = useContext(RouteContext);
  if (!r) throw new Error('useRoute outside a screen');
  // A screen opened without params gets an empty object.
  return (r.params ? r : { ...r, params: {} }) as Route & { params: P };
}

export function useIsFocused(): boolean {
  const ctx = useContext(NavContext);
  const r = useContext(RouteContext);
  return ctx != null && r != null && ctx.topKey === r.key;
}

/** onResume: runs whenever this screen becomes the top one. */
export function useFocusEffect(effect: () => void | (() => void)) {
  const focused = useIsFocused();
  const ref = useRef(effect);
  ref.current = effect;
  useEffect(() => {
    if (focused) return ref.current() ?? undefined;
    return undefined;
  }, [focused]);
}

/** onBackPressed of this screen: return true when handled (the route is then not popped). */
export function useBackHandler(handler: () => boolean) {
  const ctx = useContext(NavContext);
  const r = useContext(RouteContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!ctx || !r) return;
    ctx.register(r.key, () => ref.current());
    return () => ctx.register(r.key, null);
  }, [ctx, r]);
}

const styles = StyleSheet.create({ hidden: { display: 'none' } });
