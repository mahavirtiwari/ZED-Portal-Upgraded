import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { htmlToPlain, isNetworkAvailable, SESSION_EXPIRED_MESSAGE, useAppText, useBackHandler, useNavigation, useRoute, useUi, zedDevice } from '@zed/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import type { AssessmentDetails } from '../models';
import {
  counts,
  formatDate,
  formatRange,
  keyOf,
  labelOf,
  matches,
  memberRole,
  nameOf,
  placeOf,
  progressOf,
  roleOf,
  toneOf,
  type AssessmentSummary,
  type ReportSummary,
  type TeamMember,
} from '../portfolio';
import { Avatar, Badge, BottomTabs, C, Card, Chip, EmptyState, HeroHeader, LevelBadge, ListRow, Page, PlainHeader, ProgressBar, SectionLabel, Sheet, z, ZButton, ZIcon, ZScroll, type IconName, type TabKey } from '../ui/zed';
import { cleanData, viewAssessment } from './assessmentActions';
import { showExitAlert } from './common';

/** The units kept on the phone (their AssessorData rows), for the progress and "Clean data". */
function useStored(app: SaApp, list: AssessmentSummary[], revision: number) {
  const [stored, setStored] = useState<Record<string, AssessmentDetails>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, AssessmentDetails> = {};
      for (const a of list) {
        const d = await app.storedAssessment(a.zedId);
        if (d) out[a.zedId] = d;
      }
      if (alive) setStored(out);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [app, list, revision]);
  return stored;
}

/** The stage shown: the server's, "in progress" once work was done on the phone for a scheduled one. */
function stageOf(a: AssessmentSummary, d: AssessmentDetails | undefined): string {
  const stage = a.stage ?? 'scheduled';
  return stage === 'scheduled' && d && progressOf(d).done > 0 ? 'inProgress' : stage;
}

const statusLabel = (a: AssessmentSummary, d: AssessmentDetails | undefined) => {
  const stage = stageOf(a, d);
  return stage === (a.stage ?? 'scheduled') ? labelOf(a) : labelOf({ stage });
};

/** New (redesign): Home, Assessments, Reports and Profile behind the bottom tabs. */
export function HomeScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ tab?: TabKey; saDateDue?: boolean }>();
  const windowNote = useAppText('app.assessor.login.windowNote');
  const [tab, setTab] = useState<TabKey>(params.tab ?? 'home');
  const [refreshing, setRefreshing] = useState(false);
  const [cleaned, setCleaned] = useState(0);
  const stored = useStored(app, app.assessments, cleaned);

  useBackHandler(() => {
    if (tab !== 'home') setTab('home');
    else showExitAlert(ui);
    return true;
  });

  const refresh = useCallback(async () => {
    if (!(await isNetworkAvailable())) return;
    await Promise.all([app.refreshAssessments(), app.refreshNotifications(), app.refreshReports()].map(p => p.catch(() => undefined)));
  }, [app]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // An assessment opened more than 2 days before its SA date comes back here with the window note (was the login).
  useEffect(() => {
    if (params.saDateDue && windowNote) ui.alert(null, htmlToPlain(windowNote.html), [{ text: 'OK' }], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.saDateDue]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      setCleaned(c => c + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const view = (a: AssessmentSummary) => viewAssessment(app, ui, nav, a);
  const clean = (a: AssessmentSummary) => cleanData(app, ui, a, () => setCleaned(c => c + 1));
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />;

  return (
    <Page testID="home">
      <View style={{ flex: 1 }}>
        {tab === 'home' ? <Dashboard stored={stored} onView={view} onClean={clean} onTab={setTab} refreshControl={refreshControl} /> : null}
        {tab === 'assessments' ? <AssessmentList stored={stored} onView={view} onClean={clean} refreshControl={refreshControl} /> : null}
        {tab === 'reports' ? <Reports refreshControl={refreshControl} /> : null}
        {tab === 'profile' ? <ProfileHome /> : null}
      </View>
      <BottomTabs active={tab} onChange={setTab} />
    </Page>
  );
}

type ListProps = {
  stored: Record<string, AssessmentDetails>;
  onView: (a: AssessmentSummary) => void;
  onClean: (a: AssessmentSummary) => void;
  refreshControl: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
};

// ------------------------------------------------------------------ 04 Dashboard

function Dashboard({ stored, onView, onClean, onTab, refreshControl }: ListProps & { onTab: (t: TabKey) => void }) {
  const app = useSa();
  const nav = useNavigation();
  const [team, setTeam] = useState<AssessmentSummary | null>(null);
  const me = app.assessor;
  const list = app.assessments;
  const n = counts(list.map(a => ({ stage: stageOf(a, stored[a.zedId]) })));
  const byDate = (x: AssessmentSummary, y: AssessmentSummary) => (x.assessmentDate ?? '').localeCompare(y.assessmentDate ?? '');
  const next = list.filter(a => stageOf(a, stored[a.zedId]) === 'scheduled').sort(byDate)[0];
  const ongoing = list.filter(a => stageOf(a, stored[a.zedId]) === 'inProgress');
  const lead = list.some(a => a.userType === 1);
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <View style={[st.dashHero, { paddingTop: insets.top + 14 }]} testID="dashboard-header">
        <View style={z.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={st.welcome}>Welcome back,</Text>
            <Text style={st.dashName} numberOfLines={1} testID="header-title">
              {me?.name || me?.assessorId || ''}
            </Text>
            <Text style={st.heroMeta}>{[lead ? 'Lead Assessor' : list.length ? 'Assessor' : '', me?.assessorId].filter(Boolean).join(' · ')}</Text>
          </View>
          <Pressable style={st.bell} onPress={() => nav.push('Notifications')} testID="header-bell" accessibilityLabel="Notifications">
            <ZIcon name="bell" size={26} color={C.tInverse} />
            {app.unreadCount > 0 ? (
              <View style={st.bellDot}>
                <Text style={st.bellDotText}>{app.unreadCount > 9 ? '9+' : app.unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
        <View style={st.stats}>
          {(
            [
              ['TOTAL', n.total],
              ['UPCOMING', n.upcoming],
              ['ONGOING', n.ongoing],
              ['SUBMITTED', n.submitted],
            ] as const
          ).map(([label, value]) => (
            <View key={label} style={st.stat} testID={`stat-${label.toLowerCase()}`}>
              <Text style={st.statValue}>{value}</Text>
              <Text style={st.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
      <ZScroll contentContainerStyle={z.screenPad} refreshControl={refreshControl}>
        {list.length === 0 ? (
          <EmptyState
            icon="clipboard"
            headline="No assessments yet"
            lines={['Assessments allotted to you by QCI appear here.', 'Pull down to refresh.']}
            testID="dashboard-empty"
          />
        ) : null}
        {next ? (
          <>
            <SectionLabel label="Next assessment" right={<Text style={st.link} onPress={() => onTab('assessments')} testID="see-all">See all</Text>} />
            <AssessmentCard a={next} d={stored[next.zedId]} onView={onView} onClean={onClean} onTeam={setTeam} hideId />
          </>
        ) : null}
        {ongoing.length ? <SectionLabel label="Ongoing assessments" /> : null}
        {ongoing.map(a => (
          <AssessmentCard key={keyOf(a)} a={a} d={stored[a.zedId]} onView={onView} onClean={onClean} onTeam={setTeam} />
        ))}
        <SectionLabel label="Quick actions" />
        <View style={st.quick}>
          <QuickAction icon="clipboard" label="Assessments" onPress={() => onTab('assessments')} testID="quick-assessments" />
          <QuickAction icon="document" label="Reports" onPress={() => onTab('reports')} testID="quick-reports" />
          <QuickAction icon="bell" label="Alerts" onPress={() => nav.push('Notifications')} testID="quick-notifications" />
          <QuickAction icon="help" label="Help" onPress={() => nav.push('Help')} testID="quick-help" />
        </View>
      </ZScroll>
      {team ? <TeamPopup a={team} onClose={() => setTeam(null)} /> : null}
    </View>
  );
}

function QuickAction({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable style={st.quickItem} onPress={onPress} testID={testID} accessibilityLabel={label}>
      <View style={st.quickWell}>
        <ZIcon name={icon} size={22} color={C.primary} />
      </View>
      <Text style={st.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function AssessmentCard({
  a,
  d,
  onView,
  onClean,
  onTeam,
  hideId,
}: {
  a: AssessmentSummary;
  d?: AssessmentDetails;
  onView: (a: AssessmentSummary) => void;
  onClean: (a: AssessmentSummary) => void;
  onTeam?: (a: AssessmentSummary) => void;
  hideId?: boolean;
}) {
  const status = statusLabel(a, d);
  const progress = progressOf(d);
  const teamSize = a.team?.length ?? 0;
  const id = a.zedId;
  return (
    <Card testID={`assessment-${id}`}>
      <View style={z.rowBetween}>
        {hideId ? <LevelBadge certification={a.certificationType} small /> : <Text style={z.idText}>{id}</Text>}
        <Badge label={status} tone={toneOf(stageOf(a, d))} small testID={`status-${id}`} />
      </View>
      <View style={[z.rowCenter, { marginTop: 6, flexWrap: 'wrap', gap: 8 }]}>
        <Text style={z.h2}>{nameOf(a)}</Text>
        {hideId ? null : <LevelBadge certification={a.certificationType} small />}
      </View>
      {placeOf(a) ? (
        <View style={[z.rowCenter, st.meta]}>
          <ZIcon name="map-pin" size={14} color={C.tSecondary} />
          <Text style={st.metaText}>{placeOf(a)}</Text>
        </View>
      ) : null}
      <View style={[z.rowBetween, st.meta]}>
        <View style={z.rowCenter}>
          <ZIcon name="calendar" size={14} color={C.tSecondary} />
          <Text style={st.metaText}>{formatRange(a.assessmentDate, a.assessmentEndDate)}</Text>
        </View>
        {teamSize > 1 && onTeam ? (
          <Pressable style={st.teamChip} onPress={() => onTeam(a)} testID={`team-${id}`}>
            <ZIcon name="users" size={13} color={C.primaryDark} />
            <Text style={st.teamText}>{`${teamSize} member team`}</Text>
            <ZIcon name="chevron-right" size={12} color={C.primaryDark} />
          </Pressable>
        ) : null}
      </View>
      {d && progress.total ? (
        <View style={{ marginTop: 10 }}>
          <ProgressBar value={progress.ratio} />
          <Text style={[z.sub, { marginTop: 6 }]}>{`${Math.round(progress.ratio * 100)}% complete`}</Text>
        </View>
      ) : null}
      <View style={st.cardActions}>
        {a.canOpen !== false || d ? (
          <ZButton title="View" icon="arrow-right" small onPress={() => onView(a)} style={{ minWidth: 110 }} testID={`view-${id}`} />
        ) : (
          <Text style={[z.muted, { alignSelf: 'center' }]}>{a.statusDate ? `Updated ${formatDate(a.statusDate)}` : ''}</Text>
        )}
        {d ? <ZButton title="Clean data" icon="close" variant="dangerOutline" small onPress={() => onClean(a)} style={{ minWidth: 136 }} testID={`clean-${id}`} /> : null}
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------ 04a Team popup

function TeamPopup({ a, onClose }: { a: AssessmentSummary; onClose: () => void }) {
  const team = a.team ?? [];
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} visible>
      <Sheet onClose={onClose} testID="team-popup">
        <Text style={st.overline}>ASSESSMENT TEAM</Text>
        <Text style={z.h2}>{nameOf(a)}</Text>
        <Text style={[z.sub, { marginBottom: 8 }]}>{`${team.length} member${team.length === 1 ? '' : 's'} assigned by QCI`}</Text>
        <TeamList team={team} />
      </Sheet>
    </Modal>
  );
}

/** The team of an assessment (popup and report cards): name, role, e-mail and phone. */
function TeamList({ team }: { team: TeamMember[] }) {
  return (
    <>
      {team.map((m, i) => (
        <View key={`${m.assessorId ?? i}`} style={[st.member, i > 0 && st.memberDivider]}>
          <Avatar name={m.name ?? m.assessorId ?? '?'} size={44} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={z.title}>{m.name ?? m.assessorId}</Text>
            {memberRole(m) ? (
              <View style={{ flexDirection: 'row', marginVertical: 3 }}>
                <Badge label={memberRole(m)} tone="primary" small />
              </View>
            ) : null}
            {m.email ? (
              <Pressable style={z.rowCenter} onPress={() => Linking.openURL('mailto:' + m.email).catch(() => undefined)}>
                <ZIcon name="mail" size={12} color={C.tSecondary} />
                <Text style={st.memberText}>{m.email}</Text>
              </Pressable>
            ) : null}
            {m.mobile ? (
              <Pressable style={z.rowCenter} onPress={() => Linking.openURL('tel:' + m.mobile).catch(() => undefined)}>
                <ZIcon name="phone" size={12} color={C.tSecondary} />
                <Text style={st.memberText}>{m.mobile}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ 06 Assessment list

const LEVEL_FILTERS = ['All', 'Bronze', 'Silver', 'Gold'];

function AssessmentList({ stored, onView, onClean, refreshControl }: ListProps) {
  const app = useSa();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('All');
  const list = app.assessments;
  const shown = useMemo(() => list.filter(a => matches(a, query, level)), [list, query, level]);
  return (
    <View style={{ flex: 1 }}>
      <PlainHeader title="My assessments" testID="list-header" />
      <ZScroll contentContainerStyle={z.screenPad} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Text style={[z.muted, { marginBottom: 10 }]}>{`${list.length} total · ${shown.length} shown`}</Text>
        <View style={st.search}>
          <ZIcon name="search" size={18} color={C.tMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by org, ZED ID or level"
            placeholderTextColor={C.tMuted}
            style={st.searchInput}
            autoCapitalize="none"
            testID="list-search"
          />
        </View>
        <View style={st.filters}>
          {LEVEL_FILTERS.map(l => (
            <Chip key={l} label={l} active={level === l} onPress={() => setLevel(l)} testID={`filter-${l.toLowerCase()}`} />
          ))}
        </View>
        {shown.map(a => (
          <AssessmentCard key={keyOf(a)} a={a} d={stored[a.zedId]} onView={onView} onClean={onClean} />
        ))}
        {list.length === 0 ? (
          <EmptyState icon="clipboard" headline="No assessments assigned" lines={['When QCI allots an assessment to you, it appears here.']} testID="list-empty" />
        ) : shown.length === 0 ? (
          <EmptyState icon="search" headline="No matching assessments" lines={['Try another name, ZED ID or level.']} testID="list-no-match" />
        ) : null}
      </ZScroll>
    </View>
  );
}

// ------------------------------------------------------------------ 15 Reports

function Reports({ refreshControl }: { refreshControl: ListProps['refreshControl'] }) {
  const app = useSa();
  const ui = useUi();
  const [query, setQuery] = useState('');
  const all = app.reports;
  const q = query.trim().toLowerCase();
  const list = q ? all.filter(r => [r.enterpriseName, r.zedId, r.baseZedId, r.levelName].some(v => (v ?? '').toLowerCase().includes(q))) : all;

  const download = async (r: ReportSummary) => {
    if (!(await isNetworkAvailable())) return ui.toast('Network Unavailable', { long: true });
    const fileName = `SA_Report_${r.zedId}_${r.certificationType}.pdf`;
    ui.showLoading();
    try {
      const local = await zedDevice().downloadFile(app.reportUrl(r.zedId, r.certificationType, r.reportPath), fileName, app.session.appToken);
      zedDevice().openPdf(local, fileName);
    } catch (e) {
      const message = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : '';
      if (/\bHTTP 401\b/.test(message)) app.session.expire(SESSION_EXPIRED_MESSAGE);
      else ui.toast('Unknown error occurred while downloading file', { long: true });
    } finally {
      ui.hideLoading();
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <PlainHeader title="Reports" testID="reports-header" />
      <ZScroll contentContainerStyle={z.screenPad} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Text style={[z.muted, { marginBottom: 10 }]}>Submitted and approved assessment reports</Text>
        <View style={[st.search, { marginBottom: 14 }]}>
          <ZIcon name="search" size={18} color={C.tMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by org or ZED ID"
            placeholderTextColor={C.tMuted}
            style={st.searchInput}
            autoCapitalize="none"
            testID="reports-search"
          />
        </View>
        {list.map(r => (
          <Card key={keyOf(r)} testID={`report-${r.zedId}`}>
            <View style={z.rowBetween}>
              <Text style={z.idText}>{r.baseZedId || r.zedId}</Text>
              <Badge label={labelOf(r)} tone={toneOf(r.stage)} small />
            </View>
            <Text style={[z.h2, { marginTop: 6 }]}>{r.enterpriseName || r.baseZedId || r.zedId}</Text>
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
              <LevelBadge certification={r.certificationType} small />
            </View>
            {r.assessmentDate ? (
              <View style={[z.rowCenter, st.meta]}>
                <ZIcon name="calendar" size={14} color={C.tSecondary} />
                <Text style={st.metaText}>{`Assessment conducted ${formatDate(r.assessmentDate)}`}</Text>
              </View>
            ) : null}
            {r.team?.length ? (
              <View style={[st.memberDivider, { marginTop: 12, paddingTop: 10 }]}>
                <Text style={st.overline}>ASSESSMENT TEAM</Text>
                <TeamList team={r.team} />
              </View>
            ) : null}
            {r.reportAvailable ? (
              <ZButton title="View report" icon="document" variant="outline" small onPress={() => download(r)} style={{ marginTop: 12 }} testID={`report-open-${r.zedId}`} />
            ) : (
              <Text style={[z.muted, { marginTop: 10 }]}>The report is available once the assessment is reviewed.</Text>
            )}
          </Card>
        ))}
        {all.length === 0 ? (
          <EmptyState icon="document" headline="No reports yet" lines={['Reports of the assessments you submit appear here.']} testID="reports-empty" />
        ) : null}
      </ZScroll>
    </View>
  );
}

// ------------------------------------------------------------------ 17 Profile

function ProfileHome() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const me = app.assessor;
  const lead = app.assessments.some(a => a.userType === 1);
  const levels = me?.levels ?? [];

  const signOut = () =>
    ui.alert(null, 'Do you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          app.signOut();
          nav.reset([{ name: 'Login' }]);
        },
      },
    ]);

  return (
    <ZScroll contentContainerStyle={{ paddingBottom: 32 }} testID="profile">
      <HeroHeader title="" right={<View />}>
        <View style={{ alignItems: 'center' }}>
          <Avatar name={me?.name || me?.assessorId || '?'} size={72} color={C.heroOverlay} />
          <Text style={st.profileName}>{me?.name || me?.assessorId}</Text>
          <Text style={st.heroMeta}>{roleOf(lead ? 1 : 2)}</Text>
          <View style={st.idPill}>
            <Text style={st.idPillText}>{me?.assessorId}</Text>
          </View>
        </View>
      </HeroHeader>
      <View style={z.screenPad}>
        <SectionLabel label="Account" />
        <Card style={{ paddingVertical: 4 }}>
          <ListRow icon="user" title="View profile" onPress={() => nav.push('ViewProfile')} testID="profile-view" />
          <ListRow icon="help" title="Help & support" onPress={() => nav.push('Help')} testID="profile-help" />
          <ListRow icon="shield" title="About ZED" onPress={() => nav.push('About')} last testID="profile-about" />
        </Card>
        <SectionLabel label="Certification levels you're qualified for" />
        <Card style={{ paddingVertical: 4 }}>
          {levels.length ? (
            levels.map((l, i) => (
              <View key={`${l.code ?? i}`} style={[st.levelRow, i < levels.length - 1 && st.memberDivider]}>
                <View style={st.levelWell}>
                  <ZIcon name="shield" size={14} color={C.primary} />
                </View>
                <Text style={z.body}>{`ZED ${l.name || l.code} Certification`}</Text>
              </View>
            ))
          ) : (
            <Text style={[z.sub, { paddingVertical: 12 }]}>No qualification levels yet</Text>
          )}
        </Card>
        <ZButton title="Sign out" icon="logout" variant="dangerOutline" onPress={signOut} style={{ marginTop: 8 }} testID="sign-out" />
      </View>
    </ZScroll>
  );
}

const st = StyleSheet.create({
  dashHero: { backgroundColor: C.primary, paddingHorizontal: 20, paddingBottom: 18 },
  welcome: { color: C.heroSubText, fontSize: 13 },
  dashName: { color: C.tInverse, fontSize: 22, fontWeight: '700', marginTop: 2 },
  bell: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.heroOverlay, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  bellDotText: { color: C.tInverse, fontSize: 10, fontWeight: '700' },
  heroMeta: { color: C.heroSubText, fontSize: 13, marginTop: 2 },
  stats: { flexDirection: 'row', backgroundColor: C.heroOverlay, borderRadius: 14, paddingVertical: 14, marginTop: 16 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: C.tInverse, fontSize: 22, fontWeight: '700' },
  statLabel: { color: C.heroSubText, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginTop: 4 },
  link: { color: C.primaryDark, fontWeight: '700', fontSize: 13 },
  meta: { marginTop: 8 },
  metaText: { fontSize: 13, color: C.tSecondary, marginLeft: 6 },
  teamChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primaryBg, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, gap: 4 },
  teamText: { color: C.primaryDark, fontSize: 11, fontWeight: '700' },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between', borderTopColor: C.divider, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  quick: { flexDirection: 'row', justifyContent: 'space-around' },
  quickItem: { alignItems: 'center', width: 76 },
  quickWell: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 11, color: C.tSecondary, marginTop: 6 },
  overline: { fontSize: 11, fontWeight: '700', color: C.tMuted, letterSpacing: 0.8 },
  member: { flexDirection: 'row', paddingVertical: 10 },
  memberDivider: { borderTopColor: C.divider, borderTopWidth: 1 },
  memberText: { fontSize: 12, color: C.tSecondary, marginLeft: 6 },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.muted, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: C.tPrimary },
  filters: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  profileName: { color: C.tInverse, fontSize: 20, fontWeight: '700', marginTop: 10 },
  idPill: { backgroundColor: C.heroOverlay, borderRadius: 10, paddingHorizontal: 40, paddingVertical: 3, marginTop: 10 },
  idPillText: { color: C.tInverse, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  levelRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  levelWell: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
});
