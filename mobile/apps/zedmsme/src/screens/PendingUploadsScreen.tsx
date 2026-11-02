import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { colors, dimens, OutlinedButton, ScreenFrame, shapes, TextButton, useNavigation, useUi, ZedButton, type SyncJob } from '@zed/shared';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { useOnline } from '../app/online';
import { syncNow } from '../sync/queue';

/**
 * New screen (not in the legacy app, which only showed "Don't forget to sync" notes): what this phone still has to
 * send, what failed and why, with "Sync now", retry and remove. Removing a job never deletes the local data; the
 * item can be sent again from its own screen.
 */
export function PendingUploadsScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const online = useOnline();
  const openDrawer = useOpenDrawer('pending');
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    if (!app.loginId) return;
    app.queue.list(app.loginId).then(setJobs).catch(() => undefined);
  }, [app]);

  useEffect(() => {
    load();
    return app.queue.subscribe(load);
  }, [app, load]);

  const sync = async () => {
    if (!online) return ui.toast('Network Unavailable', { long: true });
    setRunning(true);
    try {
      await app.queue.retryAllFailed(app.loginId ?? undefined);
      const s = await syncNow(app, true);
      if (s) {
        if (s.failed.length > 0) ui.showAlert(s.failed.map(f => `${f.label}: ${f.lastError ?? ''}`).join('\n\n'), 'Not sent');
        else if (s.offline) ui.toast('The server could not be reached. Pending uploads will be sent later.', { long: true });
        else if (s.sent.length > 0) ui.toast(`${s.sent.length} item(s) sent`, { long: true });
      }
    } finally {
      setRunning(false);
      load();
    }
  };

  return (
    <ScreenFrame title="Pending Uploads" onMenu={openDrawer} offline={!online} backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="pending-uploads">
      <FlatList
        data={jobs}
        keyExtractor={j => String(j.id)}
        contentContainerStyle={{ padding: dimens.padding2 }}
        ListEmptyComponent={<Text style={styles.empty}>Nothing is waiting to be sent.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row} testID={`job-${item.kind}`}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={[styles.status, item.status === 'failed' && { color: colors.ncRed }]}>
              {item.status === 'failed'
                ? `Not sent: ${item.lastError ?? ''}`
                : item.status === 'running'
                ? 'Sending…'
                : item.lastError
                ? `Waiting for the network (${item.attempts} attempt${item.attempts === 1 ? '' : 's'})`
                : 'Waiting to be sent'}
            </Text>
            <View style={styles.actions}>
              {item.status === 'failed' ? <TextButton title="Retry" onPress={() => app.queue.retry(item.key).then(() => syncNow(app, true))} /> : null}
              <TextButton
                title="Remove"
                onPress={() =>
                  ui.alert('Remove', 'The item stays saved on the phone and can be sent again from its screen. Remove it from this list?', [
                    { text: 'No' },
                    { text: 'Yes', onPress: () => app.queue.remove(item.key) },
                  ])
                }
              />
            </View>
          </View>
        )}
      />
      {jobs.length > 0 ? <ZedButton title={running ? 'Sending…' : 'Sync now'} disabled={running} onPress={sync} testID="sync-now" /> : <OutlinedButton title="Back" onPress={() => nav.pop()} />}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', padding: dimens.padding5, color: colors.labelColor, fontSize: dimens.textSize },
  row: { ...shapes.lightGreyOutlineFilled, margin: dimens.padding1, padding: dimens.padding2 },
  label: { fontWeight: 'bold', color: colors.textColor, fontSize: dimens.textSize },
  status: { color: colors.darkGrey2, fontSize: dimens.textSize14, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
