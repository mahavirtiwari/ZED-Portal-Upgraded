import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, useNavigation, zedDevice } from '@zed/shared';
import { useSa } from '../app/context';
import { formatDateTime } from '../portfolio';
import { C, Card, EmptyState, HeroHeader, images, ListRow, Page, SectionLabel, z, ZIcon, ZScroll, type IconName } from '../ui/zed';

export const WEB_LOGIN = 'loginzed.msme.gov.in';

const ICONS: Record<string, IconName> = { allotment: 'clipboard', reminder: 'bell', report: 'document', certificate: 'shield', nc: 'flag', sentBack: 'sync' };

// ------------------------------------------------------------------ 05 Notifications

/** New (redesign): what changed on the assessor's assessments (SA/Notifications). */
export function NotificationsScreen() {
  const app = useSa();
  const nav = useNavigation();
  const list = app.notifications;

  useEffect(() => {
    isNetworkAvailable().then(online => {
      if (online) app.refreshNotifications().catch(() => undefined);
    });
  }, [app]);

  const markRead = (
    <Pressable onPress={() => app.markAllRead()} hitSlop={8} testID="notifications-mark-read" disabled={app.unreadCount === 0}>
      <Text style={[st.markRead, app.unreadCount === 0 && { opacity: 0.6 }]}>Mark read</Text>
    </Pressable>
  );

  return (
    <Page testID="notifications">
      <HeroHeader title="Notifications" onBack={() => nav.pop()} right={markRead} />
      <ZScroll contentContainerStyle={z.screenPad}>
        {list.map(n => {
          const unread = !app.isRead(n.id);
          return (
            <Card key={n.id} style={[st.note, unread && st.noteUnread]} testID={`notification-${n.id}`}>
              <View style={st.noteWell}>
                <ZIcon name={ICONS[n.type ?? ''] ?? 'bell'} size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={z.rowBetween}>
                  <Text style={[z.title, { flex: 1 }]}>{n.title}</Text>
                  {unread ? <View style={st.dot} /> : null}
                </View>
                {n.text ? <Text style={[z.sub, { marginTop: 2 }]}>{n.text}</Text> : null}
                {n.date ? <Text style={[z.muted, { marginTop: 4 }]}>{formatDateTime(n.date)}</Text> : null}
              </View>
            </Card>
          );
        })}
        {list.length === 0 ? (
          <EmptyState icon="bell" headline="No notifications yet" lines={['New allotments, reminders and report updates appear here.']} testID="notifications-empty" />
        ) : null}
      </ZScroll>
    </Page>
  );
}

// ------------------------------------------------------------------ 17 View profile

/** New (redesign): the profile, read-only on the phone (it is changed by the agency on the web). */
export function ViewProfileScreen() {
  const app = useSa();
  const nav = useNavigation();
  const me = app.assessor;
  const rows: Array<[string, string | null | undefined]> = [
    ['Assessor ID', me?.assessorId],
    ['Name', me?.name],
    ['Email', me?.email],
    ['Mobile', me?.mobile],
    ['Assessor type', me?.assessorType],
    ['Certificate no.', me?.certificateNo],
    ['Sector', me?.sectorActivity],
    ['Agency', me?.agencyName || me?.agencyId],
    ['Certification levels', me?.levels?.length ? me.levels.map(l => l.name || l.code).join(', ') : null],
  ];
  return (
    <Page testID="view-profile">
      <HeroHeader title="My profile" subtitle={me?.assessorId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Card>
          {rows
            .filter(([, v]) => !!v)
            .map(([label, value], i) => (
              <View key={label} style={[st.kv, i > 0 && st.divider]}>
                <Text style={z.muted}>{label}</Text>
                <Text style={[z.body, { marginTop: 2 }]}>{value}</Text>
              </View>
            ))}
        </Card>
        <Text style={[z.muted, { textAlign: 'center' }]}>
          {me?.agencyEmail ? `Your profile is kept by your assessment agency. To change it, write to ${me.agencyEmail}.` : 'Your profile is kept by your assessment agency.'}
        </Text>
      </ZScroll>
    </Page>
  );
}

// ------------------------------------------------------------------ 19 Help & support

const FAQS: Array<[string, string]> = [
  [
    'How do I work offline during an assessment?',
    'Open the assessment once with the network on: it is kept on the phone. Answers and photos are saved on the phone; attendance, meetings and the selfie are sent when you reconnect, parameters and site tour photos from Sync Assessment.',
  ],
  [
    'Why can I not start the assessment yet?',
    'The steps open on the allotted SA date, after today\'s punch-in. The lead assessor first allocates the parameters and holds the opening meeting.',
  ],
  ['When can I open an assessment?', 'From 2 days before the allotted Site Assessment date.'],
  [
    'What does "Clean data" do?',
    'It removes the phone\'s copy of an assessment. It is refused while anything of that assessment is not on the server yet; the assessment is downloaded again when you open it.',
  ],
];

export function HelpScreen() {
  const app = useSa();
  const nav = useNavigation();
  const [open, setOpen] = useState(0);
  const me = app.assessor;
  return (
    <Page testID="help">
      <HeroHeader title="Help & support" onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <SectionLabel label="Your assessment agency" />
        <Card style={{ paddingVertical: 4 }} testID="help-agency">
          <ListRow icon="users" title={me?.agencyName || me?.agencyId || 'Not available'} subtitle="Agency" testID="help-agency-name" />
          {me?.agencyEmail ? (
            <ListRow icon="mail" title={me.agencyEmail} subtitle="Email" onPress={() => Linking.openURL('mailto:' + me.agencyEmail).catch(() => undefined)} testID="help-email" />
          ) : null}
          {me?.agencyMobile ? (
            <ListRow icon="phone" title={me.agencyMobile} subtitle="Mobile" onPress={() => Linking.openURL('tel:' + me.agencyMobile).catch(() => undefined)} testID="help-mobile" />
          ) : null}
          <ListRow icon="document" title={WEB_LOGIN} subtitle="ZED portal (web)" onPress={() => Linking.openURL('https://' + WEB_LOGIN).catch(() => undefined)} last testID="help-web" />
        </Card>
        <SectionLabel label="Frequently asked" />
        <Card style={{ paddingVertical: 4 }}>
          {FAQS.map(([q, a], i) => (
            <Pressable key={q} style={[st.faq, i > 0 && st.divider]} onPress={() => setOpen(open === i ? -1 : i)} testID={`faq-${i}`}>
              <View style={z.rowBetween}>
                <Text style={[z.body, { flex: 1 }]}>{q}</Text>
                <ZIcon name={open === i ? 'chevron-down' : 'chevron-right'} size={16} color={C.tMuted} />
              </View>
              {open === i ? <Text style={[z.sub, { marginTop: 6 }]}>{a}</Text> : null}
            </Pressable>
          ))}
        </Card>
      </ZScroll>
    </Page>
  );
}

// ------------------------------------------------------------------ 20 About

export function AboutScreen() {
  const app = useSa();
  const nav = useNavigation();
  const info = zedDevice().getAppInfo();
  const lead = app.assessments.some(a => a.userType === 1);
  return (
    <Page testID="about">
      <HeroHeader title="About" onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Image source={images.zedLogo} style={st.logo} resizeMode="contain" />
        <Text style={[z.sub, { textAlign: 'center' }]} testID="about-version">{`ZED Site Assessment - v${info.versionName} (build ${info.versionCode})`}</Text>
        <SectionLabel label="What is ZED?" />
        <Card>
          <Text style={z.body}>
            MSME ZED (Zero Defect Zero Effect) is a Ministry of MSME certification, administered by QCI, that rates Indian MSMEs on quality and environmental performance across
            Bronze, Silver and Gold.
          </Text>
        </Card>
        <SectionLabel label="Your role" />
        <Card>
          <Text style={z.body}>
            {lead
              ? 'As Lead Assessor you allocate parameters, hold the opening and closing meetings, run the on-site assessment, answer each checkpoint with evidence, and sync the case for the agency.'
              : 'As Assessor you run the on-site assessment of the parameters allotted to you, answer each checkpoint with evidence, and sync your parameters for the agency.'}
          </Text>
        </Card>
        <Text style={st.footer}>{`Web login: ${WEB_LOGIN}`}</Text>
        <Text style={st.footer}>{`© ${new Date().getFullYear()} Quality Council of India · Ministry of MSME`}</Text>
      </ZScroll>
    </Page>
  );
}

const st = StyleSheet.create({
  markRead: { color: C.tInverse, fontWeight: '700', fontSize: 14 },
  note: { flexDirection: 'row', gap: 12 },
  noteUnread: { borderLeftColor: C.primary, borderLeftWidth: 4 },
  noteWell: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginLeft: 8 },
  kv: { paddingVertical: 10 },
  divider: { borderTopColor: C.divider, borderTopWidth: 1 },
  faq: { paddingVertical: 12 },
  logo: { width: 190, height: 190, alignSelf: 'center', marginBottom: 8 },
  footer: { textAlign: 'center', fontSize: 11, color: C.tMuted, marginTop: 8 },
});
