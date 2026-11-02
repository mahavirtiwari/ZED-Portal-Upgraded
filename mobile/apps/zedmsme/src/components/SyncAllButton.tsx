import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, Icon, sharedIcons, useNavigation } from '@zed/shared';
import { useMsme } from '../app/context';

/** Number of queued sends of the signed-in user, kept up to date. */
export function usePendingCount(): number {
  const app = useMsme();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (!app.loginId) return setCount(0);
      app.queue.pendingCount(app.loginId).then(n => alive && setCount(n)).catch(() => undefined);
    };
    refresh();
    const unsubscribe = app.queue.subscribe(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [app]);
  return count;
}

/**
 * The header's "Sync All" button (default_header.xml @id/sync_button, hidden in the legacy build), shown when
 * something waits to be sent; it opens the list of pending uploads.
 */
export function SyncAllButton() {
  const nav = useNavigation();
  const count = usePendingCount();
  if (count === 0) return null;
  return (
    <Pressable style={styles.button} onPress={() => nav.push('PendingUploads')} testID="sync-all">
      <Icon icon={sharedIcons.ic_sync_black_24dp} size={18} tint={colors.appColor} />
      <Text style={styles.text}>{`SYNC ALL (${count})`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    margin: 2,
  },
  text: { color: colors.appColor, fontWeight: 'bold', fontSize: 12, marginLeft: 4 },
});
