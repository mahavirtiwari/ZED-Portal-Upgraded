import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBackHandler, useFocusEffect, useNavigation, useRoute, useUi } from '@zed/shared';
import { useCallback } from 'react';
import { useSa } from '../app/context';
import { milestoneProgress } from '../milestone';
import { formatRange, keyOf, labelOf, milestoneLabel, milestonesOf, nameOf, placeOf, roleOf, toneOf, type MilestoneInfo } from '../portfolio';
import { Badge, C, Card, EmptyState, HeroHeader, LevelBadge, Page, ProgressBar, SectionLabel, Strip, SubmitButton, z, ZIcon, ZScroll } from '../ui/zed';
import { openMap, openMilestone } from './assessmentActions';
import { currentCopy, stageOf, statusLabel, TeamList, useStored } from './HomeScreen';

/**
 * 06 Case Detail (redesign): the unit and its milestones; the current milestone opens its page (the legacy company
 * profile + dashboard). Earlier milestones show as done, later ones locked, as the server lists them.
 */
export function CaseDetailScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ key: string }>();
  const [revision, setRevision] = useState(0);
  const a = app.assessments.find(x => keyOf(x) === params.key) ?? null;
  const list = React.useMemo(() => (a ? [a] : []), [a]);
  const stored = useStored(app, list, revision);

  useBackHandler(() => {
    nav.pop();
    return true;
  });

  // Back from the milestone page: its progress is read again.
  useFocusEffect(
    useCallback(() => {
      setRevision(r => r + 1);
    }, []),
  );

  if (!a) {
    return (
      <Page testID="case-detail">
        <HeroHeader title="Case" onBack={() => nav.pop()} />
        <EmptyState icon="clipboard" headline="Case not found" lines={['Pull down on the case list to refresh it.']} />
      </Page>
    );
  }

  const d = stored[a.zedId];
  const copy = currentCopy(a, d);
  const progress = milestoneProgress(copy);
  const milestones = milestonesOf(a);
  const current = a.milestone ?? milestones.find(m => m.status === 'current')?.no ?? null;
  const address = a.address || placeOf(a);
  const canOpen = a.canOpen !== false || !!copy;

  const card = (m: MilestoneInfo) => {
    const isCurrent = m.no === current;
    const status = m.status === 'done' ? 'Completed' : isCurrent ? statusLabel(a, d) : m.status === 'locked' ? 'Locked' : (m.status ?? '');
    const tone = m.status === 'done' ? 'success' : isCurrent ? toneOf(stageOf(a, d)) : 'neutral';
    const ratio = m.status === 'done' ? 1 : isCurrent ? progress.ratio : 0;
    return (
      <Card key={m.no} style={isCurrent ? st.current : undefined} testID={`milestone-${m.no}`}>
        <View style={z.rowBetween}>
          <Badge label={milestoneLabel(m.no)} tone="primary" small />
          {status ? <Badge label={status} tone={tone} small /> : null}
        </View>
        {m.label ? <Text style={[z.sub, { marginTop: 6 }]}>{m.label}</Text> : null}
        <View style={[z.rowCenter, { marginTop: 10 }]}>
          <View style={{ flex: 1 }}>
            <ProgressBar value={ratio} color={m.status === 'locked' ? C.tMuted : undefined} />
          </View>
          <Text style={st.count}>{isCurrent && progress.total ? `${progress.done}/${progress.total}` : m.status === 'done' ? 'Done' : ''}</Text>
        </View>
      </Card>
    );
  };

  const rows: Array<[string, string | null | undefined]> = [
    ['ZED ID', a.zedId],
    ['Certification level', a.levelName || a.certificationType],
    ['Your role', roleOf(a.userType === 1 || a.role === 'Lead' ? 1 : 2)],
    ['Visit', formatRange(a.assessmentDate, a.assessmentEndDate)],
  ];

  return (
    <Page testID="case-detail">
      <HeroHeader title={nameOf(a)} subtitle={a.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Card>
          <Text style={st.overline}>UNIT DETAILS</Text>
          {rows
            .filter(([, v]) => !!v)
            .map(([label, value]) => (
              <View key={label} style={st.kv}>
                <Text style={z.muted}>{label}</Text>
                <Text style={st.kvValue}>{value}</Text>
              </View>
            ))}
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <LevelBadge certification={a.certificationType} small />
          </View>
          {address ? (
            <Pressable style={[z.rowCenter, st.address]} onPress={() => openMap(ui, address, a.latitude, a.longitude)} testID="case-address">
              <ZIcon name="map-pin" size={16} color={C.primary} />
              <Text style={st.addressText}>{address}</Text>
              <ZIcon name="chevron-right" size={16} color={C.primary} />
            </Pressable>
          ) : null}
        </Card>

        <SectionLabel label="Milestone progress" />
        {milestones.length ? milestones.map(card) : <Text style={z.muted}>{labelOf(a)}</Text>}

        {a.team?.length ? (
          <>
            <SectionLabel label="Consultant team" />
            <Card>
              <TeamList team={a.team} />
            </Card>
          </>
        ) : null}

        {d && d !== copy ? (
          <Strip tone="warning" icon="info" text="The phone has the work of an earlier milestone. Sync it, then use Clear data on the case card to start this milestone." />
        ) : null}

        {current ? (
          <SubmitButton
            title={`Open ${milestoneLabel(current)}`}
            ready={canOpen}
            onPress={() => (canOpen ? openMilestone(app, ui, nav, a) : ui.showAlert('This case cannot be opened now.'))}
            style={{ marginTop: 16 }}
            testID="open-milestone"
          />
        ) : null}
      </ZScroll>
    </Page>
  );
}

const st = StyleSheet.create({
  overline: { fontSize: 11, fontWeight: '700', color: C.tMuted, letterSpacing: 0.8, marginBottom: 6 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  kvValue: { fontSize: 13, fontWeight: '700', color: C.tPrimary, flexShrink: 1, textAlign: 'right' },
  address: { marginTop: 12, paddingTop: 12, borderTopColor: C.divider, borderTopWidth: 1, gap: 8 },
  addressText: { flex: 1, color: C.primaryDark, fontWeight: '700', fontSize: 13 },
  current: { borderColor: C.primary, borderWidth: 1.5 },
  count: { width: 52, textAlign: 'right', fontSize: 13, fontWeight: '700', color: C.primaryDark },
});
