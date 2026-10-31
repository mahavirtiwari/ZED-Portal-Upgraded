import { useEffect, useSyncExternalStore } from 'react';
import { useNavigation } from '../navigation/stack';
import type { AppSession } from './appSession';

/** Route param of the login page opened by {@link SessionExpiryGate}: the server's text to show. */
export const SESSION_EXPIRED_PARAM = 'sessionExpired';

/**
 * New in V4 (audit C1): rendered inside the StackNavigator (its `overlay`). When the server refuses the app sign-in
 * token, the app goes to its login page with the server's text (route param {@link SESSION_EXPIRED_PARAM}) and stays
 * there until the next sign-in: a screen that navigates on after its refused call (for example "saved on the
 * phone") is sent back to the login page.
 */
export function SessionExpiryGate({ session, loginRoute }: { session: AppSession; loginRoute: string }) {
  const nav = useNavigation();
  const message = useSyncExternalStore(
    l => session.subscribe(l),
    () => session.expiredMessage,
  );
  const top = nav.routes[nav.routes.length - 1];
  useEffect(() => {
    if (message == null || top?.name === loginRoute) return;
    nav.reset([{ name: loginRoute, params: { [SESSION_EXPIRED_PARAM]: message } }]);
  }, [message, top?.name, top?.key, loginRoute, nav]);
  return null;
}
