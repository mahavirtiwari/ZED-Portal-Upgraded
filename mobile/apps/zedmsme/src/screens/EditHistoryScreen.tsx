import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, dimens, errorOf, isSuccess, ScreenFrame, useNavigation } from '@zed/shared';
import type { EditHistoryRow } from '../api';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';

/** "App: password changed" -> "Password changed" (the web keeps the channel in its own column). */
export function changeTitle(action: string): string {
  const t = action.replace(/^(App|Web|Profile|Certification payment)\s*:\s*/i, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : action;
}

/** What was submitted, as "Field: value" lines; secrets (shown as *** by the server) are left out altogether. */
export function changeDetails(data: string | null | undefined): string[] {
  if (!data) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value === null || value === undefined || value === '' || value === '***') return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path} ${i + 1}`));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, path ? `${path} ${k}` : k);
    else out.push(`${path}: ${String(value)}`);
  };
  // The top level holds the request's argument names (req, request, ...): not shown.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) for (const v of Object.values(parsed as Record<string, unknown>)) walk(v, '');
  return out.filter(l => !/^userName:/i.test(l)).slice(0, 12);
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** New (2026-11-07): the unit's Edit History, as on the web (portal Msme/AppEditHistory), newest first, by day. */
export function EditHistoryScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const openDrawer = useOpenDrawer('history');
  const [rows, setRows] = useState<EditHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const r = await app.api.getEditHistory(p);
        if (!isSuccess(r)) setError(errorOf(r));
        else {
          setRows(prev => (p === 1 ? (r.Rows ?? []) : [...prev, ...(r.Rows ?? [])]));
          setTotal(r.Total ?? 0);
          setPage(p);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error occurred');
      } finally {
        setLoading(false);
      }
    },
    [app],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  let lastDay = '';
  return (
    <ScreenFrame title="Edit History" onMenu={openDrawer} backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="edit-history">
      <ScrollView contentContainerStyle={styles.page}>
        {error ? (
          <Pressable onPress={() => load(1)} testID="history-retry">
            <Text style={styles.error}>{`${error} Tap to try again.`}</Text>
          </Pressable>
        ) : null}
        {rows.map(r => {
          const d = day(r.At);
          const header = d !== lastDay ? <Text style={styles.day}>{d}</Text> : null;
          lastDay = d;
          const details = changeDetails(r.Data);
          const saved = r.Result === 'Success';
          return (
            <View key={r.Id}>
              {header}
              <Pressable style={styles.item} onPress={() => setOpen(open === r.Id ? null : r.Id)} testID="history-item">
                <View style={styles.itemHead}>
                  <Text style={styles.title}>{changeTitle(r.Action)}</Text>
                  <Text style={styles.time}>{time(r.At)}</Text>
                </View>
                <Text style={styles.meta}>
                  {r.Channel === 'Mobile' ? 'MSME app' : 'Web'} · <Text style={saved ? styles.saved : styles.notSaved}>{saved ? 'Saved' : 'Not saved'}</Text>
                  {r.Message ? ` · ${r.Message}` : ''}
                </Text>
                {open === r.Id && details.length ? (
                  <View style={styles.details}>
                    {details.map((l, i) => (
                      <Text key={i} style={styles.detail}>
                        {l}
                      </Text>
                    ))}
                  </View>
                ) : details.length ? (
                  <Text style={styles.more}>Show details</Text>
                ) : null}
              </Pressable>
            </View>
          );
        })}
        {!loading && !error && rows.length === 0 ? <Text style={styles.empty}>No changes recorded yet.</Text> : null}
        {loading ? <ActivityIndicator color={colors.appColor} style={{ margin: dimens.padding4 }} /> : null}
        {!loading && rows.length < total ? (
          <Pressable onPress={() => load(page + 1)} style={styles.loadMore} testID="history-more">
            <Text style={styles.more}>Show older changes</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  page: { padding: dimens.padding3, backgroundColor: colors.white, flexGrow: 1 },
  day: { color: colors.labelColor, fontSize: 13, marginTop: dimens.padding3, marginBottom: dimens.padding1 },
  item: { borderWidth: 1, borderColor: '#E3E6E8', borderRadius: 10, padding: dimens.padding3, marginBottom: dimens.padding2 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: 'bold', color: colors.black, flexShrink: 1 },
  time: { color: colors.labelColor, marginLeft: dimens.padding2 },
  meta: { color: colors.darkGrey2, marginTop: 4, fontSize: 13 },
  saved: { color: '#1D6B35', fontWeight: 'bold' },
  notSaved: { color: colors.ncRed, fontWeight: 'bold' },
  details: { marginTop: dimens.padding2, backgroundColor: colors.lightGrey2, borderRadius: 6, padding: dimens.padding2 },
  detail: { fontSize: 13, color: colors.darkGrey },
  more: { color: colors.appColorDark, fontWeight: 'bold', marginTop: 4 },
  loadMore: { alignItems: 'center', padding: dimens.padding3 },
  empty: { textAlign: 'center', color: colors.labelColor, marginTop: 48 },
  error: { color: colors.ncRed, textAlign: 'center', marginVertical: dimens.padding3 },
});
