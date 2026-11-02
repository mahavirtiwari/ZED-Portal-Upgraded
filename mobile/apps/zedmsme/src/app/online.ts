import { useEffect, useState } from 'react';
import { lastKnownOnline, watchConnectivity, isNetworkAvailable } from '@zed/shared';

/** The legacy CONNECTIVITY_ACTION receiver (EvidencesActivity.registerNetworkStateReceiver). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(lastKnownOnline());
  useEffect(() => {
    let alive = true;
    isNetworkAvailable().then(o => alive && setOnline(o));
    const unsubscribe = watchConnectivity(o => alive && setOnline(o));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return online;
}
