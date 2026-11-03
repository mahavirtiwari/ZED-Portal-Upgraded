import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { fileUri, formatDate, isNetworkAvailable, isNetworkError, isSuccess, removePhoto, useNavigation, useRoute, useUi, type PhotoData } from '@zed/shared';
import { useSa } from '../app/context';
import {
  addEntry,
  attendanceLog,
  formatDay,
  formatTime,
  isAttendanceDoneToday,
  isLoggedInToday,
  isLoggedOutToday,
  loginEntryToday,
  logoutEntryToday,
  newAttendance,
  timeOf,
  totalHours,
  type AttendanceLogRow,
} from '../attendance';
import { queueAttendance, submitAttendance } from '../flows/submissions';
import { useSaPhotoCapture } from '../photo/capture';
import { isFourthMilestone, UNKNOWN_ERROR, type Attendance } from '../models';
import { Badge, C, Card, GradientFill, HeroHeader, Page, SectionLabel, Strip, z, ZButton, ZIcon, ZScroll } from '../ui/zed';
import { base64Uri, BulletComments, ClockIcon, Footer, geoText, SelfieCard, SubmitButton, TimePlaceCard, useBulletComment } from './MeetingScreens';

type Result = (ok: boolean) => void;

/** The image of an attendance selfie (stored file, or the base64 while it is still in memory). */
const selfieUri = (p: PhotoData | null | undefined): string | null => (p?.photoPath ? fileUri(p.photoPath) : p?.photo ? base64Uri(p.photo) : null);

/** "Xh Ym" from a punch in to the punch out, or until now. */
function workingHours(inAt: number, outAt: number | null): string {
  const minutes = Math.max(0, Math.floor(((outAt ?? Date.now()) - inAt) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** getMilestoneStage */
const stageOf = (app: ReturnType<typeof useSa>) => (isFourthMilestone(app.details!) ? 'Technology Upgradation' : `Milestone - ${app.details!.milestone}`);

/**
 * AttendanceActivity ("Attendance"): today's punch in / out with a selfie and the day's agenda, and the record. (No
 * "Sync Pending Data" in this app: an entry saved offline is sent by the sync queue.)
 */
export function AttendanceScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ onResult?: Result }>();
  const data = app.details!.attendanceData!;
  const todayIn = loginEntryToday(data);
  const todayOut = logoutEntryToday(data);
  const rows = attendanceLog(data.attendanceList);

  /** finish() with the result for the screen that opened Attendance. */
  const finish = (ok: boolean) => {
    nav.popTo('Attendance');
    nav.pop();
    params.onResult?.(ok);
  };

  /** submitData + handleSubmissionResponse */
  const submit = async (a: Attendance): Promise<boolean> => {
    const isLogout = a.attendanceType === 'LOGOUT';
    ui.showLoading();
    let r;
    try {
      r = await submitAttendance(app, a);
    } catch (e) {
      ui.hideLoading();
      // New: no answer -> the entry stays pending and is sent when the connection returns.
      if (isNetworkError(e)) await queueAttendance(app, a);
      ui.alert('Alert', isNetworkError(e) ? e.message : UNKNOWN_ERROR, [{ text: 'OK' }], false);
      return false;
    }
    ui.hideLoading();
    await app.update();
    if (!isSuccess(r)) {
      ui.alert('Alert', r.errorMessage ?? UNKNOWN_ERROR, [{ text: 'OK' }], false);
      return false;
    }
    ui.alert(
      'Alert',
      'Data submitted successfully',
      [
        {
          text: 'OK',
          onPress: async () => {
            // handleLogoutForTechUpgradation: in technology upgradation, punching out ends it on the phone.
            if (isLogout && app.details && isFourthMilestone(app.details)) {
              await app.deleteAssessorData();
              nav.reset([{ name: 'Login' }]);
              return;
            }
            finish(true);
          },
        },
      ],
      false,
    );
    return true;
  };

  /** saveData (from the punch-in form). */
  const saveData = async (a: Attendance) => {
    await app.update();
    if (await isNetworkAvailable()) {
      await submit(a);
    } else {
      await queueAttendance(app, a);
      ui.alert('Alert', 'Network unavailable, your data will be saved locally.', [{ text: 'OK', onPress: () => finish(false) }], false);
    }
  };

  const loggedIn = isLoggedInToday(data);
  const loggedOut = isLoggedOutToday(data);
  const selfie = todayIn?.selfie ?? null;
  const shownUri = selfieUri(selfie);
  const shownGeo = geoText(selfie?.latitude, selfie?.longitude);
  const daysAttended = rows.filter(r => r.loginDate != null).length;

  const status = isAttendanceDoneToday(data)
    ? { tone: 'success' as const, icon: 'check' as const, title: 'Attendance captured for today', text: 'Punch-in and punch-out are recorded.' }
    : loggedIn
      ? { tone: 'success' as const, icon: 'check' as const, title: 'Punched in today', text: 'The sections are unlocked. Punch out at the end of the day.' }
      : { tone: 'primary' as const, icon: 'info' as const, title: 'Punch in to start the day', text: 'A geo-tagged selfie is captured at punch-in.' };

  return (
    <Page testID="attendance">
      <HeroHeader title="Attendance" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Strip tone={status.tone} icon={status.icon} title={status.title} text={status.text} />

        <Card>
          <SectionLabel label="Selfie" style={{ marginTop: 0 }} />
          <View style={styles.selfieWrap}>
            {shownUri ? (
              <View style={styles.selfieRing}>
                <Image source={{ uri: shownUri }} style={styles.selfieImage} resizeMode="cover" testID="attendance-selfie-image" />
                <View style={styles.selfieCheck}>
                  <ZIcon name="check" size={12} color={C.tInverse} strokeWidth={2.6} />
                </View>
              </View>
            ) : (
              <View style={styles.selfieEmpty}>
                <ZIcon name="camera" size={32} color={C.primaryDark} />
              </View>
            )}
            <Text style={[styles.selfieNote, { color: shownUri ? C.success : C.primaryDark }]}>
              {shownUri && todayIn ? `✓ Selfie captured — ${formatTime(timeOf(todayIn))}` : 'No selfie yet — captured at punch-in'}
            </Text>
          </View>
          <View style={[styles.geoBox, shownGeo ? styles.geoBoxOn : null]}>
            {shownGeo ? <ZIcon name="map-pin" size={14} color={C.success} /> : null}
            <Text style={[styles.geoText, shownGeo ? { color: C.tPrimary, fontWeight: '600' } : null]} numberOfLines={1}>
              {shownGeo ?? 'Geo-tag will be attached automatically'}
            </Text>
          </View>
        </Card>

        <Card>
          <SectionLabel label={`Today · ${formatDate(new Date(), 'dd MMM yyyy')}`} style={{ marginTop: 0 }} />
          <View style={styles.punchRow}>
            {!loggedIn ? (
              <Pressable style={({ pressed }) => [styles.punchTile, styles.tileFilled, pressed && { opacity: 0.85 }]} onPress={() => nav.push('PunchIn', { saveData })} testID="punch-in">
                <GradientFill />
                <Text style={[styles.punchTitle, { color: C.tInverse }]}>Punch-in</Text>
                <Text style={[styles.punchSub, { color: C.heroSubText }]} testID="punch-in-value">
                  Tap to start
                </Text>
              </Pressable>
            ) : (
              <View style={[styles.punchTile, styles.tileDone]}>
                <Text style={[styles.punchTitle, { color: C.success }]}>Punch-in</Text>
                <Text style={[styles.punchSub, { color: C.success }]} testID="punch-in-value">
                  {todayIn ? `${formatTime(timeOf(todayIn))} · recorded` : '--:--'}
                </Text>
              </View>
            )}
            {loggedIn && !loggedOut ? (
              <Pressable style={({ pressed }) => [styles.punchTile, styles.tileFilled, pressed && { opacity: 0.85 }]} onPress={() => nav.push('PunchIn', { saveData })} testID="punch-out">
                <GradientFill />
                <Text style={[styles.punchTitle, { color: C.tInverse }]}>Punch-out</Text>
                <Text style={[styles.punchSub, { color: C.heroSubText }]} testID="punch-out-value">
                  Tap to close the day
                </Text>
              </Pressable>
            ) : loggedOut ? (
              <View style={[styles.punchTile, styles.tileDone]}>
                <Text style={[styles.punchTitle, { color: C.success }]}>Punch-out</Text>
                <Text style={[styles.punchSub, { color: C.success }]} testID="punch-out-value">
                  {todayOut ? `${formatTime(timeOf(todayOut))} · recorded` : '--:--'}
                </Text>
              </View>
            ) : (
              <View style={[styles.punchTile, styles.tileLocked]}>
                <Text style={[styles.punchTitle, { color: C.tMuted }]}>Punch-out</Text>
                <Text style={styles.punchSub} testID="punch-out-value">
                  --:--
                </Text>
              </View>
            )}
          </View>
          <View style={styles.divider} />
          <View style={z.rowBetween}>
            <Text style={[z.sub, !todayIn && { color: C.tMuted }]} testID="working-hours">
              {`Working hours: ${todayIn ? workingHours(timeOf(todayIn), todayOut ? timeOf(todayOut) : null) : '--h --m'}`}
            </Text>
            <Text style={z.muted}>{loggedOut ? 'Day closed' : loggedIn ? 'In progress' : 'Not punched in yet'}</Text>
          </View>
        </Card>

        <Card>
          <SectionLabel
            label={`${stageOf(app)} attendance log`}
            style={{ marginTop: 0 }}
            right={
              data.attendanceList.length > 0 ? (
                <Pressable onPress={() => nav.push('AttendanceLog')} hitSlop={8} testID="attendance-log">
                  <Text style={styles.link}>View record</Text>
                </Pressable>
              ) : null
            }
          />
          {rows.length > 0 ? (
            <AttendanceTable rows={rows} />
          ) : (
            <View style={styles.emptyLog}>
              <View style={styles.emptyWell}>
                <ClockIcon size={24} color={C.tMuted} />
              </View>
              <Text style={styles.emptyTitle}>No attendance recorded yet</Text>
              <Text style={z.muted}>Days appear here as you punch in and out.</Text>
            </View>
          )}
        </Card>
        {rows.length > 0 ? <DaysAttended count={daysAttended} /> : null}
        <Text style={styles.footnote}>One punch-in and one punch-out a day. Attendance is geo-tagged and time-stamped.</Text>
      </ZScroll>
    </Page>
  );
}

/** The day-wise attendance table: day / date, in, out, hours, status. */
function AttendanceTable({ rows }: { rows: AttendanceLogRow[] }) {
  return (
    <View>
      <View style={[styles.tr, styles.thRow]}>
        {['DAY / DATE', 'IN', 'OUT', 'HRS', 'STATUS'].map((h, i) => (
          <Text key={h} style={[styles.th, { flex: COLS[i] }]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((item, index) => (
        <View key={index} style={[styles.tr, styles.dayRow, { borderLeftColor: item.logoutDate != null ? C.success : C.primary }]}>
          <View style={{ flex: COLS[0] }}>
            <Text style={styles.day}>{`Day ${index + 1}`}</Text>
            <Text style={styles.date}>{formatDay(item.date)}</Text>
          </View>
          <Text style={[styles.td, { flex: COLS[1] }]}>{item.loginDate != null ? formatTime(item.loginDate) : '—'}</Text>
          <Text style={[styles.td, { flex: COLS[2] }]}>{item.logoutDate != null ? formatTime(item.logoutDate) : '—'}</Text>
          <Text style={[styles.td, { flex: COLS[3] }]}>{totalHours(item) || '—'}</Text>
          <View style={{ flex: COLS[4] }}>
            <Badge label={item.status} tone={item.status === 'Synced' ? 'success' : 'warning'} small />
          </View>
        </View>
      ))}
    </View>
  );
}

const COLS = [1.45, 1.1, 1.1, 0.8, 1.1];

function DaysAttended({ count }: { count: number }) {
  return (
    <View style={styles.totals}>
      <Text style={styles.totalsLabel}>Total days attended</Text>
      <View style={styles.totalsPill}>
        <Text style={styles.totalsValue} testID="days-attended">
          {String(count)}
        </Text>
      </View>
    </View>
  );
}

/**
 * PunchInFragment: the selfie and "Day Agenda" (the screen was always opened as a punch-in, so the punch-out's
 * "Remarks (Optional)" label never showed), then "Done" (punch in, or out after today's punch in). The comment is
 * optional (its "Required" mark only flashed).
 */
export function PunchInScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ saveData: (a: Attendance) => Promise<void> }>();
  const capturer = useSaPhotoCapture();
  const [selfie, setSelfie] = useState<PhotoData | null>(null);
  // The day's agenda as "• point" lines (no limit, as before).
  const agenda = useBulletComment();
  const out = isLoggedInToday(app.details!.attendanceData!);
  const geo = geoText(selfie?.latitude, selfie?.longitude);

  /** The selfie (one photo): capture, or retake (the old one is removed as the photo field's delete did). */
  const take = async () => {
    const photo = await capturer.capture('camera');
    if (!photo) return;
    if (selfie) await removePhoto(app.photos, selfie);
    setSelfie(photo);
  };

  const done = async () => {
    if (!selfie) return ui.snackbar('Please capture selfie');
    const comments = agenda.final() ?? '';
    const d = app.details!.attendanceData!;
    const a = newAttendance(selfie, comments.trim() === '' ? null : comments, isLoggedInToday(d) ? 'LOGOUT' : 'LOGIN');
    const error = addEntry(d, a);
    if (error) return ui.snackbar(error);
    nav.pop();
    await params.saveData(a);
  };

  return (
    <Page testID="punch-in-form">
      <HeroHeader title="Attendance" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={styles.punchHead}>
            <Text style={styles.caps}>ATTENDANCE</Text>
            <Text style={z.h1}>{out ? 'Punch out' : 'Punch in'}</Text>
            <Text style={[z.muted, { marginTop: 4 }]}>{out ? 'Capture your selfie & confirm to close the day.' : 'Capture your selfie & confirm to start the day.'}</Text>
          </View>
          <TimePlaceCard time={formatDate(new Date(), 'dd MMM yyyy, hh:mm a')} place={geo ?? 'Location is captured with the selfie'} />
          <SelfieCard uri={selfieUri(selfie)} geo={geo} onPress={take} testID="attendance-selfie" />
        </Card>
        <SectionLabel label="Day Agenda" right={<Text style={z.muted}>Optional</Text>} />
        <BulletComments b={agenda} placeholder="Add a point of today's agenda" testID="attendance-comments" />
      </ZScroll>
      <Footer>
        <View style={z.rowCenter}>
          <ZButton title="Cancel" variant="ghost" onPress={() => nav.pop()} style={styles.cancel} testID="punch-cancel" />
          <SubmitButton title={out ? 'Punch out & submit' : 'Punch in & submit'} ready={!!selfie} onPress={done} style={{ flex: 1, marginLeft: 12 }} testID="punch-done" />
        </View>
      </Footer>
    </Page>
  );
}

/** AttendanceLogFragment: one row per day (tap to show In/Out/Total/Stage), "Close". */
export function AttendanceLogScreen() {
  const app = useSa();
  const nav = useNavigation();
  const rows = attendanceLog(app.details!.attendanceData!.attendanceList);
  const stage = stageOf(app);
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <Page testID="attendance-log-screen">
      <HeroHeader title="Attendance" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <SectionLabel label={`${stage} attendance log`} style={{ marginTop: 0 }} right={<Text style={z.muted}>{`${rows.length} day(s)`}</Text>} />
        {rows.map((item, index) => {
          const shown = open.has(index);
          return (
            <Card key={index} style={[styles.dayCard, shown && styles.dayCardOpen]}>
              <Pressable
                style={z.rowBetween}
                onPress={() => setOpen(s => (s.has(index) ? new Set([...s].filter(x => x !== index)) : new Set([...s, index])))}
                testID={`log-${index}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.dayTitle}>{`Day ${index + 1} · ${formatDay(item.date)}`}</Text>
                  <Text style={z.muted}>{item.logoutDate != null ? 'Punched in and out' : item.loginDate != null ? 'Punch-out pending' : 'Punch-in missing'}</Text>
                </View>
                <Badge label={item.status} tone={item.status === 'Synced' ? 'success' : 'warning'} small />
                <View style={{ marginLeft: 8 }}>
                  <ZIcon name={shown ? 'chevron-down' : 'chevron-right'} size={18} color={C.tMuted} />
                </View>
              </Pressable>
              {shown ? (
                <View style={styles.pair}>
                  {[
                    ['Date', formatDay(item.date)],
                    ['In Time', item.loginDate != null ? formatTime(item.loginDate) : ''],
                    ['Out Time', item.logoutDate != null ? formatTime(item.logoutDate) : ''],
                    ['Total Hours', totalHours(item)],
                    ['Stage', stage],
                  ].map(([l, v]) => (
                    <View key={l} style={styles.logLine}>
                      <Text style={styles.logLabel}>{l}</Text>
                      <Text style={styles.logValue}>{v || '—'}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })}
        <DaysAttended count={rows.filter(r => r.loginDate != null).length} />
        <Text style={styles.footnote}>Attendance is geo-tagged and time-stamped.</Text>
      </ZScroll>
      <Footer>
        <SubmitButton title="Close" ready onPress={() => nav.pop()} testID="log-close" />
      </Footer>
    </Page>
  );
}

const styles = StyleSheet.create({
  selfieWrap: { alignItems: 'center', paddingVertical: 8 },
  selfieRing: { width: 108, height: 108, borderRadius: 54, borderWidth: 3, borderColor: C.success, alignItems: 'center', justifyContent: 'center' },
  selfieImage: { width: 98, height: 98, borderRadius: 49 },
  selfieCheck: { position: 'absolute', right: 2, bottom: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: C.success, borderColor: C.surface, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  selfieEmpty: { width: 104, height: 104, borderRadius: 52, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  selfieNote: { fontSize: 13, fontWeight: '700', marginTop: 12 },
  geoBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderColor: C.border, borderWidth: 1, borderRadius: 8, backgroundColor: C.bg, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  geoBoxOn: { backgroundColor: C.successBg, borderColor: C.successBg },
  geoText: { fontSize: 11, color: C.tMuted, textAlign: 'center', marginLeft: 6 },
  punchRow: { flexDirection: 'row', gap: 14, marginTop: 6 },
  punchTile: { flex: 1, height: 64, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileFilled: { backgroundColor: C.primary, overflow: 'hidden' },
  tileDone: { backgroundColor: C.successBg, borderColor: C.success, borderWidth: 1 },
  tileLocked: { backgroundColor: C.muted },
  punchTitle: { fontSize: 15, fontWeight: '700' },
  punchSub: { fontSize: 11, color: C.tMuted, marginTop: 3 },
  divider: { height: 1, backgroundColor: C.divider, marginVertical: 14 },
  link: { fontSize: 12, fontWeight: '600', color: C.primaryDark },
  emptyLog: { alignItems: 'center', paddingVertical: 12 },
  emptyWell: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: C.tMuted, marginBottom: 2 },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  thRow: { borderBottomColor: C.divider, borderBottomWidth: 1, paddingTop: 0, paddingLeft: 11 },
  dayRow: { borderLeftWidth: 3, paddingLeft: 8, marginTop: 6, backgroundColor: C.bg, borderRadius: 6 },
  th: { fontSize: 9, fontWeight: '700', color: C.tMuted, letterSpacing: 0.4 },
  td: { fontSize: 11, color: C.tSecondary },
  day: { fontSize: 12, fontWeight: '700', color: C.tPrimary },
  date: { fontSize: 9, color: C.tMuted, marginTop: 2 },
  totals: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.successBg, borderRadius: 12, paddingHorizontal: 14, height: 56, marginTop: 4 },
  totalsLabel: { fontSize: 14, fontWeight: '700', color: C.tPrimary },
  totalsPill: { backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  totalsValue: { fontSize: 15, fontWeight: '700', color: C.success },
  footnote: { fontSize: 10, color: C.tMuted, marginTop: 10 },
  punchHead: { paddingBottom: 14, marginBottom: 14, borderBottomColor: C.divider, borderBottomWidth: 1 },
  caps: { fontSize: 11, fontWeight: '700', color: C.tSecondary, letterSpacing: 0.5, marginBottom: 2 },
  cancel: { width: 110, minHeight: 52, borderRadius: 12 },
  dayCard: { paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  dayCardOpen: { borderColor: C.primary },
  dayTitle: { fontSize: 14, fontWeight: '700', color: C.tPrimary },
  pair: { backgroundColor: C.bg, borderRadius: 10, padding: 10, marginTop: 10 },
  logLine: { flexDirection: 'row', paddingVertical: 3 },
  logLabel: { width: 110, color: C.tSecondary, fontSize: 13 },
  logValue: { flex: 1, color: C.tPrimary, fontSize: 13, fontWeight: '600' },
});
