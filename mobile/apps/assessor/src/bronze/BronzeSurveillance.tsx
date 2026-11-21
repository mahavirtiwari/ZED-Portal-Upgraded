/**
 * 2026-11-21: Bronze surveillance in ZED SA. The retired ZED Surveillance app's screens (@zed/bronze-surveillance) are
 * registered beside ZED SA's with the prefix "Bronze.", each wrapped in the Bronze module's own context (its app state, its
 * app.msme.* texts) for the unit opened last; the case list on Home and My assessments is ZED SA's (its look, its
 * app.assessor.bronze.* texts).
 */
import React, { useCallback, useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { htmlToPlain, isNetworkAvailable, useNavigation, useUi, type ScreenMap } from '@zed/shared';
import { BRONZE_SCREENS, BRONZE_START, BronzeHostProvider, MsmeAppProvider, routeName, syncNow, type BronzeHost } from '@zed/bronze-surveillance';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { formatDate } from '../portfolio';
import { Badge, C, Card, levelBadgeOf, SectionLabel, z, ZButton, ZIcon } from '../ui/zed';
import { bronzeName, bronzePlace, openBronzeCase, type BronzeCase } from './cases';

/** The prefix of ZED SA's Bronze surveillance texts (Admin → Texts, "Assessor app"; backend ContentCatalogue.Apps.cs). */
export const BRONZE_TEXTS = 'app.assessor.bronze.';

/**
 * The module inside ZED SA: its routes under "Bronze."; its resets to its Dashboard (after a final submit) or to its login
 * page go to ZED SA's Home; Back on its first page returns to ZED SA.
 */
export const BRONZE_HOST: BronzeHost = {
  prefix: 'Bronze.',
  exits: { Dashboard: [{ name: 'Home' }], Launcher: [{ name: 'Home' }] },
  embedded: true,
};

/** A Bronze page: rendered only while the assessor is signed in and a Bronze unit is open (nothing after a sign-out). */
function withBronze<P extends object>(Screen: React.ComponentType<P>): React.ComponentType<P> {
  return function BronzeScreen(props: P) {
    const app = useSa();
    const user = useSyncExternalStore(
      l => app.bronze.subscribe(l),
      () => app.bronze.user,
    );
    if (!app.assessor || !user) return null;
    return (
      <MsmeAppProvider app={app.bronze}>
        <BronzeHostProvider host={BRONZE_HOST}>
          <Screen {...props} />
        </BronzeHostProvider>
      </MsmeAppProvider>
    );
  };
}

/** The Bronze pages for App.tsx SCREENS. */
export const BRONZE_ROUTES: ScreenMap = Object.fromEntries(
  Object.entries(BRONZE_SCREENS).map(([name, Screen]) => [routeName(BRONZE_HOST, name), withBronze(Screen)]),
);

/** A Bronze text as plain text (the Admin's wording, else the built-in one), re-rendered when newer texts arrive. */
export function useBronzeTexts(): (key: string, fields?: Record<string, string | number | null | undefined>) => string {
  const app = useSa();
  const revision = useSyncExternalStore(
    l => app.texts.subscribe(l),
    () => app.texts.getRevision(),
  );
  return useCallback(
    (key: string, fields?: Record<string, string | number | null | undefined>) => {
      const r = app.texts.get(BRONZE_TEXTS + key, fields);
      return r ? htmlToPlain(r.html).trim() : '';
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, revision],
  );
}

type Nav = ReturnType<typeof useNavigation>;
type Ui = ReturnType<typeof useUi>;

/** "Open": the unit's session from the surveillance host (or the phone, offline), then the Bronze steps. */
export async function viewBronzeCase(app: SaApp, ui: Ui, nav: Nav, c: BronzeCase, t: (key: string) => string) {
  const online = await isNetworkAvailable();
  if (online) ui.showLoading('Please Wait...');
  let out;
  try {
    out = await openBronzeCase(app, c, online);
  } finally {
    if (online) ui.hideLoading();
  }
  if (out.kind === 'open') {
    nav.push(routeName(BRONZE_HOST, BRONZE_START), { fromLogin: true });
    return;
  }
  ui.toast('key' in out ? t('open.' + out.key) : out.message, { long: true });
}

/** "Bronze Surveillance" in the Bronze level's colours (the level badge shows the level's name only). */
function BronzeLabel({ label }: { label: string }) {
  const lv = levelBadgeOf('Bronze');
  return (
    <View style={[st.label, lv ? { backgroundColor: lv.bg } : null]} testID="bronze-label">
      <Text style={[st.labelText, lv ? { color: lv.fg } : null]}>{label}</Text>
    </View>
  );
}

/** The Bronze surveillance cases on Home and My assessments (nothing when there are none). */
export function BronzeCasesSection({ testID = 'bronze-cases' }: { testID?: string }) {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const t = useBronzeTexts();
  const cases = app.bronzeCases;
  if (!cases.length) return null;
  return (
    <View testID={testID}>
      <SectionLabel label={t('home.title')} />
      <Text style={[z.muted, { marginBottom: 8 }]}>{t('home.subtitle')}</Text>
      {cases.map(c => (
        <Card key={c.zedId} style={st.caseCard} testID={`bronze-case-${c.zedId}`}>
          <View style={z.rowBetween}>
            <Text style={z.idText}>{c.zedId}</Text>
            <BronzeLabel label={t('case.label')} />
          </View>
          <Text style={[z.h2, { marginTop: 6 }]}>{bronzeName(c)}</Text>
          {bronzePlace(c) ? (
            <View style={[z.rowCenter, st.meta]}>
              <ZIcon name="map-pin" size={14} color={C.tSecondary} />
              <Text style={st.metaText}>{bronzePlace(c)}</Text>
            </View>
          ) : null}
          <View style={st.actions}>
            <View style={{ flexShrink: 1 }}>
              {c.ncRound ? (
                <Badge label={t('case.ncRound', { Round: c.ncRound })} tone="warning" small testID={`bronze-status-${c.zedId}`} />
              ) : (
                <Badge label={t('case.status')} tone="info" small testID={`bronze-status-${c.zedId}`} />
              )}
              {c.statusDate ? <Text style={[z.sub, { marginTop: 4 }]}>{t('case.allotted', { Date: formatDate(c.statusDate) })}</Text> : null}
            </View>
            <ZButton title={t('case.open')} icon="arrow-right" small onPress={() => viewBronzeCase(app, ui, nav, c, t)} style={{ minWidth: 110 }} testID={`bronze-open-${c.zedId}`} />
          </View>
        </Card>
      ))}
    </View>
  );
}

/**
 * Rendered in the navigator's overlay: the surveillance host ended the open unit's session (its "SURV" token): back to
 * Home with the server's text; the unit is opened again from the list (a new session). The work on the phone stays.
 */
export function BronzeExpiryGate() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const message = useSyncExternalStore(
    l => app.bronze.session.subscribe(l),
    () => app.bronze.session.expiredMessage,
  );
  const top = nav.routes[nav.routes.length - 1];
  useEffect(() => {
    if (message == null || !top?.name.startsWith(BRONZE_HOST.prefix)) return;
    nav.reset([{ name: 'Home' }]);
    ui.alert(null, message, [{ text: 'OK' }], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, top?.key]);
  return null;
}

/** The Bronze unit's queue (the module's own sync), with ZED SA's triggers (connection back, foreground, every 30 s). */
export const syncBronze = (app: SaApp) => syncNow(app.bronze);

const st = StyleSheet.create({
  caseCard: { borderLeftWidth: 4, borderLeftColor: C.primary, marginBottom: 12 },
  // The small level badge's shape (ui/zed.tsx badge + badgeSmall).
  label: { height: 18, paddingHorizontal: 8, borderRadius: 9, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  labelText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  meta: { marginTop: 8 },
  metaText: { fontSize: 13, color: C.tSecondary, marginLeft: 6 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopColor: C.divider,
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
});
