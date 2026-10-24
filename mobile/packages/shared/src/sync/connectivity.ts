import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

/**
 * Network state. The legacy Utils.isNetworkAvailable is `activeNetworkInfo?.isConnectedOrConnecting`: a connected
 * network, whether or not it reaches the internet. Keep that meaning for the "online/offline" decisions of the
 * screens; the requests themselves decide whether the server is reachable.
 */
export function isOnlineState(state: Pick<NetInfoState, 'isConnected'> | null | undefined): boolean {
  return state?.isConnected === true;
}

let last: boolean | null = null;

export async function isNetworkAvailable(): Promise<boolean> {
  const state = await NetInfo.fetch();
  last = isOnlineState(state);
  return last;
}

/** Last known state without waiting (false before the first answer). */
export function lastKnownOnline(): boolean {
  return last === true;
}

/**
 * Calls `listener(online)` on every change, and `onReconnect` when the device goes from offline to online
 * (the moment the sync queue sends what is pending). Returns the unsubscribe function.
 */
export function watchConnectivity(listener: (online: boolean) => void, onReconnect?: () => void): () => void {
  let previous: boolean | null = null;
  return NetInfo.addEventListener(state => {
    const online = isOnlineState(state);
    last = online;
    listener(online);
    if (online && previous === false) onReconnect?.();
    previous = online;
  });
}
