import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { htmlToPlain, isNetworkAvailable, SESSION_EXPIRED_MESSAGE, useAppText, useBackHandler, useNavigation, useRoute, useUi, zedDevice } from '@zed/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { milestoneProgress } from '../milestone';
import type { AssessmentDetails } from '../models';
import {
  ACTIVE_STAGES,
  counts,
  formatDate,
  formatRange,
  keyOf,
  labelOf,
  matches,
  memberRole,
  milestoneLabel,
  nameOf,
  placeOf,
  roleOf,
  toneOf,
  type AssessmentSummary,
  type ReportSummary,
  type TeamMember,
} from '../portfolio';
import { Avatar, Badge, BottomTabs, C, Card, Chip, EmptyState, GradientFill, HeroHeader, LevelBadge, ListRow, Page, PlainHeader, ProgressBar, SectionLabel, Sheet, Strip, z, ZButton, ZIcon, ZScroll, type IconName, type TabKey } from '../ui/zed';
import { clearData } from './assessmentActions';
import { showExitAlert } from './common';

/** The units kept on the phone (their AssessorData rows), for the progress and "Clear data". */
export function useStored(app: SaApp, list: AssessmentSummary[], revision: number) {
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

/** The phone's copy counts for the case's current milestone only (a copy of an earlier milestone is stale). */
export const currentCopy = (a: AssessmentSummary, d: AssessmentDetails | undefined) => (d && (!a.milestone || d.milestone === a.milestone) ? d : undefined);

/** The stage shown: the server's, "in progress" once work was done on the phone for a scheduled one. */
export function stageOf(a: AssessmentSummary, d: AssessmentDetails | undefined): string {
  const stage = a.stage ?? 'scheduled';
  const copy = currentCopy(a, d);
  return stage === 'scheduled' && copy && milestoneProgress(copy).done > 0 ? 'inProgress' : stage;
}

export const statusLabel = (a: AssessmentSummary, d: AssessmentDetails | undefined) => {
  const stage = stageOf(a, d);
  return stage === (a.stage ?? 'scheduled') ? labelOf(a) : labelOf({ stage });
};

/** New (redesign): Home, Cases, Reports and Profile behind the bottom tabs. */
export function HomeScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ tab?: TabKey; saDateDue?: boolean }>();
  const windowNote = useAppText('app.consultant.login.windowNote');
  const [tab, setTab] = useState<TabKey>(params.tab ?? 'home');
  const [refreshing, setRefreshing] = useState(false);
  const [cleared, setCleared] = useState(0);
  const stored = useStored(app, app.assessments, cleared);

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

  // A case opened more than 2 days before its visit date comes back here with the window note (was the login).
  useEffect(() => {
    if (params.saDateDue && windowNote) ui.alert(null, htmlToPlain(windowNote.html), [{ text: 'OK' }], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.saDateDue]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      setCleared(c => c + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const view = (a: AssessmentSummary) => nav.push('CaseDetail', { key: keyOf(a) });
  const clear = (a: AssessmentSummary) => clearData(app, ui, a.zedId, () => setCleared(c => c + 1));
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />;

  return (
    <Page testID="home">
      <View style={{ flex: 1 }}>
        {tab === 'home' ? <Dashboard stored={stored} onView={view} onClear={clear} onTab={setTab} refreshControl={refreshControl} /> : null}
        {tab === 'assessments' ? <CaseList stored={stored} onView={view} onClear={clear} refreshControl={refreshControl} /> : null}
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
  onClear: (a: AssessmentSummary) => void;
  refreshControl: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
};

/** The phone keeps the milestone's work until it is synced: another phone does not have it. */
const SAME_PHONE = 'Use the same phone for the whole milestone — work not yet synced stays on this phone.';

// ------------------------------------------------------------------ 04 Dashboard

function Dashboard({ stored, onView, onClear, onTab, refreshControl }: ListProps & { onTab: (t: TabKey) => void }) {
  const app = useSa();
  const nav = useNavigation();
  const [team, setTeam] = useState<AssessmentSummary | null>(null);
  const me = app.assessor;
  const list = app.assessments;
  const n = counts(list.map(a => ({ stage: stageOf(a, stored[a.zedId]) })));
  const byDate = (x: AssessmentSummary, y: AssessmentSummary) => (x.assessmentDate ?? '').localeCompare(y.assessmentDate ?? '');
  const next = list.filter(a => stageOf(a, stored[a.zedId]) === 'scheduled').sort(byDate)[0];
  const ongoing = list.filter(a => ['inProgress', 'sentBack'].includes(stageOf(a, stored[a.zedId])));
  const lead = list.some(a => a.userType === 1);
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <View style={[st.dashHero, { paddingTop: insets.top + 14 }]} testID="dashboard-header">
        <GradientFill />
        <View style={z.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={st.welcome}>Welcome back,</Text>
            <Text style={st.dashName} numberOfLines={1} testID="header-title">
              {me?.name || me?.assessorId || ''}
            </Text>
            <Text style={st.heroMeta}>{[list.length ? roleOf(lead ? 1 : 2) : '', me?.assessorId].filter(Boolean).join(' · ')}</Text>
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
          <EmptyState icon="clipboard" headline="No cases yet" lines={['Handholding cases allotted to you appear here.', 'Pull down to refresh.']} testID="dashboard-empty" />
        ) : null}
        {next ? (
          <>
            <SectionLabel label="Next milestone visit" right={<Text style={st.link} onPress={() => onTab('assessments')} testID="see-all">See all</Text>} />
            <CaseCard a={next} d={stored[next.zedId]} onView={onView} onClear={onClear} onTeam={setTeam} />
          </>
        ) : null}
        {ongoing.length ? <SectionLabel label="Ongoing cases" /> : null}
        {ongoing.map(a => (
          <CaseCard key={keyOf(a)} a={a} d={stored[a.zedId]} onView={onView} onClear={onClear} onTeam={setTeam} />
        ))}
        {list.length ? <Strip tone="danger" icon="info" text={SAME_PHONE} /> : null}
        <SectionLabel label="Quick actions" />
        <View style={st.quick}>
          <QuickAction icon="clipboard" label="Cases" onPress={() => onTab('assessments')} testID="quick-assessments" />
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

export function MilestoneBadge({ no }: { no: number | null | undefined }) {
  return <Badge label={milestoneLabel(no)} tone="primary" small />;
}

function CaseCard({
  a,
  d,
  onView,
  onClear,
  onTeam,
  detail,
}: {
  a: AssessmentSummary;
  d?: AssessmentDetails;
  onView: (a: AssessmentSummary) => void;
  onClear: (a: AssessmentSummary) => void;
  onTeam?: (a: AssessmentSummary) => void;
  /** The case list's line: sections done and the role. */
  detail?: boolean;
}) {
  const status = statusLabel(a, d);
  const copy = currentCopy(a, d);
  const progress = milestoneProgress(copy);
  const teamSize = a.team?.length ?? 0;
  const id = a.zedId;
  const role = a.userType === 1 || a.role === 'Lead' ? 'Lead' : 'Co-consultant';
  return (
    <Card style={st.caseCard} testID={`assessment-${id}`}>
      <View style={z.rowBetween}>
        <Text style={z.idText}>{id}</Text>
        <Badge label={status} tone={toneOf(stageOf(a, d))} small testID={`status-${id}`} />
      </View>
      <Text style={[z.h2, { marginTop: 6 }]}>{nameOf(a)}</Text>
      <View style={[z.rowCenter, { marginTop: 6, flexWrap: 'wrap', gap: 8 }]}>
        {a.milestone ? <MilestoneBadge no={a.milestone} /> : null}
        <LevelBadge certification={a.certificationType} small />
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
      {copy && progress.total ? (
        <View style={{ marginTop: 10 }}>
          <ProgressBar value={progress.ratio} />
          <Text style={[z.sub, { marginTop: 6 }]}>
            {detail ? `${progress.done} of ${progress.total} sections · ${role}` : `${Math.round(progress.ratio * 100)}% complete`}
          </Text>
        </View>
      ) : detail ? (
        <Text style={[z.sub, { marginTop: 8 }]}>{`Not started · ${role}`}</Text>
      ) : null}
      <View style={st.cardActions}>
        <ZButton title="View" icon="arrow-right" small onPress={() => onView(a)} style={{ minWidth: 110 }} testID={`view-${id}`} />
        {d ? <ZButton title="Clear data" icon="close" variant="dangerOutline" small onPress={() => onClear(a)} style={{ minWidth: 136 }} testID={`clean-${id}`} /> : null}
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------ 04b Team popup

function TeamPopup({ a, onClose }: { a: AssessmentSummary; onClose: () => void }) {
  const team = a.team ?? [];
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} visible>
      <Sheet onClose={onClose} testID="team-popup">
        <Text style={st.overline}>CONSULTANT TEAM</Text>
        <Text style={z.h2}>{nameOf(a)}</Text>
        <Text style={[z.sub, { marginBottom: 8 }]}>{`${team.length} member${team.length === 1 ? '' : 's'}`}</Text>
        <TeamList team={team} />
      </Sheet>
    </Modal>
  );
}

/** The team of a case (popup, case detail and report cards): name, role, e-mail and phone. */
export function TeamList({ team }: { team: TeamMember[] }) {
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

// ------------------------------------------------------------------ 05 Case list

const FILTERS = ['Active', 'Completed', 'All'] as const;

function CaseList({ stored, onView, onClear, refreshControl }: ListProps) {
  const app = useSa();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Active');
  const list = app.assessments;
  const active = list.filter(a => ACTIVE_STAGES.includes(stageOf(a, stored[a.zedId])));
  const shown = useMemo(
    () =>
      list.filter(a => {
        const isActive = ACTIVE_STAGES.includes(stageOf(a, stored[a.zedId]));
        if (filter === 'Active' && !isActive) return false;
        if (filter === 'Completed' && isActive) return false;
        return matches(a, query, 'All');
      }),
    [list, stored, query, filter],
  );
  return (
    <View style={{ flex: 1 }}>
      <PlainHeader title="My cases" subtitle={`${active.length} active · ${list.length - active.length} completed`} testID="list-header" />
      <ZScroll contentContainerStyle={z.screenPad} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <View style={st.search}>
          <ZIcon name="search" size={18} color={C.tMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search unit name or ZED ID"
            placeholderTextColor={C.tMuted}
            style={st.searchInput}
            autoCapitalize="none"
            testID="list-search"
          />
        </View>
        <View style={st.filters}>
          {FILTERS.map(f => (
            <Chip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} testID={`filter-${f.toLowerCase()}`} />
          ))}
        </View>
        {shown.map(a => (
          <CaseCard key={keyOf(a)} a={a} d={stored[a.zedId]} onView={onView} onClear={onClear} detail />
        ))}
        {list.length === 0 ? (
          <EmptyState icon="clipboard" headline="No cases assigned" lines={['When a handholding case is allotted to you, it appears here.']} testID="list-empty" />
        ) : shown.length === 0 ? (
          <EmptyState icon="search" headline="No matching cases" lines={['Try another name or ZED ID, or another filter.']} testID="list-no-match" />
        ) : null}
        {active.length ? <Strip tone="danger" icon="info" text={SAME_PHONE} /> : null}
      </ZScroll>
    </View>
  );
}

// ------------------------------------------------------------------ 08 Reports

function Reports({ refreshControl }: { refreshControl: ListProps['refreshControl'] }) {
  const app = useSa();
  const ui = useUi();
  const [query, setQuery] = useState('');
  const all = app.reports;
  const q = query.trim().toLowerCase();
  const list = q ? all.filter(r => [r.enterpriseName, r.zedId, r.baseZedId, r.levelName].some(v => (v ?? '').toLowerCase().includes(q))) : all;

  const download = async (r: ReportSummary) => {
    if (!(await isNetworkAvailable())) return ui.toast('Network Unavailable', { long: true });
    const fileName = `Consultancy_Report_${r.zedId}_${r.certificationType}_M${r.milestone ?? ''}.pdf`;
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
        <Text style={[z.muted, { marginBottom: 10 }]}>Milestone reports of your cases</Text>
        <View style={[st.search, { marginBottom: 14 }]}>
          <ZIcon name="search" size={18} color={C.tMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by unit or ZED ID"
            placeholderTextColor={C.tMuted}
            style={st.searchInput}
            autoCapitalize="none"
            testID="reports-search"
          />
        </View>
        {list.map(r => (
          <Card key={keyOf(r) + (r.reportPath ?? '')} testID={`report-${r.zedId}`}>
            <View style={z.rowBetween}>
              <Text style={z.idText}>{r.baseZedId || r.zedId}</Text>
              <Badge label={labelOf(r)} tone={toneOf(r.stage)} small />
            </View>
            <Text style={[z.h2, { marginTop: 6 }]}>{r.enterpriseName || r.baseZedId || r.zedId}</Text>
            {r.milestoneLabel ? <Text style={[z.sub, { marginTop: 2 }]}>{r.milestoneLabel}</Text> : null}
            <View style={[z.rowCenter, { marginTop: 4, gap: 8 }]}>
              {r.milestone ? <MilestoneBadge no={r.milestone} /> : null}
              <LevelBadge certification={r.certificationType} small />
            </View>
            {r.assessmentDate ? (
              <View style={[z.rowCenter, st.meta]}>
                <ZIcon name="calendar" size={14} color={C.tSecondary} />
                <Text style={st.metaText}>{`Visit ${formatDate(r.assessmentDate)}`}</Text>
              </View>
            ) : null}
            {r.team?.length ? (
              <View style={[st.memberDivider, { marginTop: 12, paddingTop: 10 }]}>
                <Text style={st.overline}>CONSULTANT TEAM</Text>
                <TeamList team={r.team} />
              </View>
            ) : null}
            {r.reportAvailable ? (
              <ZButton title="View report" icon="document" variant="outline" small onPress={() => download(r)} style={{ marginTop: 12 }} testID={`report-open-${r.zedId}`} />
            ) : (
              <Text style={[z.muted, { marginTop: 10 }]}>The report is available once the milestone is reviewed.</Text>
            )}
          </Card>
        ))}
        {all.length === 0 ? <EmptyState icon="document" headline="No reports yet" lines={['Reports of the milestones you complete appear here.']} testID="reports-empty" /> : null}
      </ZScroll>
    </View>
  );
}

// ------------------------------------------------------------------ 09 Profile

function ProfileHome() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const me = app.assessor;
  const lead = app.assessments.some(a => a.userType === 1);

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
          <ListRow icon="shield" title="About the app" onPress={() => nav.push('About')} last testID="profile-about" />
        </Card>
        <ZButton title="Sign out" icon="logout" variant="dangerOutline" onPress={signOut} style={{ marginTop: 8 }} testID="sign-out" />
      </View>
    </ZScroll>
  );
}

const st = StyleSheet.create({
  dashHero: { backgroundColor: C.primary, paddingHorizontal: 20, paddingBottom: 18, overflow: 'hidden' },
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
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderColor: C.primaryEdge, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
  caseCard: { borderLeftWidth: 4, borderLeftColor: C.primary },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: C.tPrimary },
  filters: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  profileName: { color: C.tInverse, fontSize: 20, fontWeight: '700', marginTop: 10 },
  idPill: { backgroundColor: C.heroOverlay, borderRadius: 10, paddingHorizontal: 40, paddingVertical: 3, marginTop: 10 },
  idPillText: { color: C.tInverse, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
