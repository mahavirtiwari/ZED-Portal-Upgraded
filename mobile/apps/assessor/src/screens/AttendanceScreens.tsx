import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  fileUri,
  formatDate,
  isNetworkAvailable,
  isNetworkError,
  isSuccess,
  removePhoto,
  useBackHandler,
  useNavigation,
  useRoute,
  useUi,
  type PhotoData,
} from '@zed/shared';
import { useSa } from '../app/context';
import {
  addEntry,
  anyPendingData,
  attendanceLog,
  formatDay,
  formatTime,
  isAttendanceTakenToday,
  isLatestEntryLogin,
  lastLoginEntry,
  lastLogoutEntry,
  newAttendance,
  timeOf,
  totalHours,
  type AttendanceLogRow,
} from '../attendance';
import { queueAttendance, submitAttendance } from '../flows/submissions';
import { useSaPhotoCapture } from '../photo/capture';
import { UNKNOWN_ERROR, type Attendance } from '../models';
import { Badge, C, Card, GradientFill, HeroHeader, Page, SectionLabel, Sheet, Strip, z, ZButton, ZIcon, ZScroll } from '../ui/zed';
import { base64Uri, DashedBox, geoText, SelfieCard, SubmitButton, TimePlaceCard } from './MeetingScreens';

type Result = (ok: boolean) => void;

/** The image of an attendance selfie (stored file, or the base64 while it is still in memory). */
const selfieUri = (p: PhotoData | null | undefined): string | null => (p?.photoPath ? fileUri(p.photoPath) : p?.photo ? base64Uri(p.photo) : null);

/** "9:18 AM", with the day when it is not today. */
const when = (t: number) => (formatDay(t) === formatDay(Date.now()) ? formatTime(t) : `${formatTime(t)} · ${formatDay(t)}`);

/** "Working hours" of the last punch in: until the punch out, or until now. */
function workingHours(inAt: number, outAt: number | null): string {
  const minutes = Math.max(0, Math.floor(((outAt ?? Date.now()) - inAt) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const nowText = () => formatDate(new Date(), 'dd MMM yyyy, hh:mm a');

/**
 * The selfie of one punch (PunchInFragment's PhotosField with one photo): capture, or retake (the old one is removed
 * like PhotosField's delete, then the new one is added).
 */
function useSelfie() {
  const app = useSa();
  const capturer = useSaPhotoCapture();
  const [selfie, setSelfie] = useState<PhotoData | null>(null);
  const take = async () => {
    const photo = await capturer.capture('camera');
    if (!photo) return;
    if (selfie) await removePhoto(app.photos, selfie);
    setSelfie(photo);
  };
  return { selfie, setSelfie, take };
}

/** PunchInFragment.onDone: punch in, or out after a punch in, with the selfie; then the screen's saveData. */
function usePunch(saveData: (a: Attendance) => Promise<void>) {
  const app = useSa();
  const ui = useUi();
  return async (selfie: PhotoData | null, onAdded?: () => void) => {
    if (!selfie) return ui.snackbar('Please capture selfie');
    const d = app.details!.attendanceData!;
    const a = newAttendance(selfie, isLatestEntryLogin(d) ? 'LOGOUT' : 'LOGIN');
    const error = addEntry(d, a);
    if (error) return ui.snackbar(error);
    onAdded?.();
    await saveData(a);
  };
}

/** AttendanceActivity ("Attendance"): punch in / out with a selfie, the record, pending entries. */
export function AttendanceScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ onResult?: Result }>();
  const data = app.details!.attendanceData!;
  const lastIn = lastLoginEntry(data);
  const lastOut = lastLogoutEntry(data);
  const punchedIn = isLatestEntryLogin(data);
  const rows = attendanceLog(data.attendanceList);
  const inSelfie = useSelfie();
  const outSelfie = useSelfie();
  const [punchOutOpen, setPunchOutOpen] = useState(false);

  // The punch-out popup closes on back like the punch-in form it replaces.
  useBackHandler(() => {
    if (!punchOutOpen) return false;
    setPunchOutOpen(false);
    return true;
  });

  /** finish() with the result for the screen that opened Attendance. */
  const finish = (ok: boolean) => {
    nav.popTo('Attendance');
    nav.pop();
    params.onResult?.(ok);
  };

  /** submitData + handleSubmissionResponse */
  const submit = async (a: Attendance, pendingFlow = false): Promise<boolean> => {
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
    if (pendingFlow) return true;
    ui.alert(
      'Alert',
      'Data submitted successfully',
      [
        {
          text: 'OK',
          onPress: async () => {
            // handleLogoutForTechUpgradation: after the closing meeting, punching out ends the assessment on the phone.
            if (isLogout && app.details?.isCloseMeetingSubmitted) {
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

  const syncPending = async () => {
    for (;;) {
      const item = app.details!.attendanceData!.attendanceList.find(x => !x.isSubmitted);
      if (!item) break;
      if (!(await submit(item, true))) return;
    }
    if (!anyPendingData(app.details!.attendanceData!)) ui.snackbar('Data submitted');
  };

  const punch = usePunch(saveData);
  // The punch in is taken here (selfie card + Punch-in); the punch out in its popup (07b). Same rules as the form.
  const punchIn = () => punch(inSelfie.selfie, () => inSelfie.setSelfie(null));
  const punchOut = () =>
    punch(outSelfie.selfie, () => {
      outSelfie.setSelfie(null);
      setPunchOutOpen(false);
    });

  // The selfie card: the current punch-in's selfie, else the one taken for the next punch in.
  const shown = punchedIn ? lastIn?.selfie ?? null : inSelfie.selfie;
  const shownUri = selfieUri(shown);
  const shownGeo = geoText(shown?.latitude, shown?.longitude);
  const shownAt = punchedIn && lastIn ? formatTime(timeOf(lastIn)) : shown?.timeStamp ?? '';
  const daysAttended = rows.filter(r => r.loginDate != null).length;

  const status = isAttendanceTakenToday(data)
    ? { tone: 'success' as const, icon: 'check' as const, title: 'Punched in today', text: 'The assessment steps are unlocked.' }
    : punchedIn
      ? { tone: 'warning' as const, icon: 'info' as const, title: 'Punch-in from an earlier day', text: 'Punch out, then punch in for today.' }
      : { tone: 'primary' as const, icon: 'info' as const, title: 'Punch in to start the day', text: 'Capture your selfie, then punch in to unlock the assessment steps.' };

  return (
    <Page testID="attendance">
      <HeroHeader title="Attendance" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Strip tone={status.tone} icon={status.icon} title={status.title} text={status.text} />

        <Card>
          <SectionLabel label="Assessor selfie" style={{ marginTop: 0 }} />
          <View style={styles.selfieWrap}>
            {shownUri ? (
              <Pressable onPress={punchedIn ? undefined : inSelfie.take} disabled={punchedIn} style={styles.selfieRing} testID="attendance-selfie">
                <Image source={{ uri: shownUri }} style={styles.selfieImage} resizeMode="cover" testID="attendance-selfie-image" />
              </Pressable>
            ) : (
              <Pressable onPress={punchedIn ? undefined : inSelfie.take} disabled={punchedIn} style={styles.selfieEmpty} testID="attendance-selfie">
                <ZIcon name="camera" size={32} color={C.primary} />
              </Pressable>
            )}
            {shownUri || punchedIn ? (
              <View style={styles.capturedChip}>
                <ZIcon name="check" size={16} color={C.success} />
                <Text style={styles.capturedText}>{shownAt ? `Selfie captured · ${shownAt}` : 'Selfie captured'}</Text>
              </View>
            ) : (
              <Text style={[z.muted, { marginTop: 12 }]}>Tap to capture selfie</Text>
            )}
          </View>
          <View style={styles.geoBox}>
            <ZIcon name="map-pin" size={13} color={shownGeo ? C.primaryDark : C.tMuted} />
            <Text style={styles.geoText} numberOfLines={1}>
              {shownGeo ?? 'Geo-tag will be attached automatically'}
            </Text>
          </View>
        </Card>

        <Card>
          <SectionLabel label={`Today - ${formatDate(new Date(), 'dd MMM yyyy')}`} style={{ marginTop: 0 }} />
          <View style={styles.punchRow}>
            {punchedIn ? (
              <View style={[styles.punchTile, styles.tileFilled]}>
                <GradientFill />
                <Text style={[styles.punchTitle, { color: C.tInverse }]}>Punch-in</Text>
                <Text style={[styles.punchSub, { color: C.heroSubText }]} testID="punch-in-value">
                  {lastIn ? when(timeOf(lastIn)) : '--:--'}
                </Text>
              </View>
            ) : (
              <Pressable style={({ pressed }) => [styles.punchTile, styles.tileFilled, pressed && { opacity: 0.85 }]} onPress={punchIn} testID="punch-in">
                <GradientFill />
                <Text style={[styles.punchTitle, { color: C.tInverse }]}>Punch-in</Text>
                <Text style={[styles.punchSub, { color: C.heroSubText }]} testID="punch-in-value">
                  {inSelfie.selfie ? 'Tap to punch in' : 'Capture selfie first'}
                </Text>
              </Pressable>
            )}
            {punchedIn ? (
              <Pressable style={({ pressed }) => [styles.punchTile, styles.tileOutline, pressed && { opacity: 0.85 }]} onPress={() => setPunchOutOpen(true)} testID="punch-out">
                <Text style={[styles.punchTitle, { color: C.primaryDark }]}>Punch-out</Text>
                <Text style={styles.punchSub} testID="punch-out-value">
                  Pending
                </Text>
              </Pressable>
            ) : (
              <View style={[styles.punchTile, styles.tileLocked]}>
                <Text style={[styles.punchTitle, { color: C.tMuted }]}>Punch-out</Text>
                <Text style={styles.punchSub} testID="punch-out-value">
                  {lastOut ? when(timeOf(lastOut)) : 'Locked'}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.divider} />
          <Text style={[z.sub, !lastIn && { color: C.tMuted }]} testID="working-hours">
            {`Working hours: ${lastIn ? workingHours(timeOf(lastIn), lastOut ? timeOf(lastOut) : null) : '—'}`}
          </Text>
        </Card>

        {rows.length > 0 ? (
          <Card>
            <SectionLabel
              label="Assessment attendance log"
              style={{ marginTop: 0 }}
              right={
                <Pressable onPress={() => nav.push('AttendanceLog')} hitSlop={8} testID="attendance-log">
                  <Text style={styles.link}>View record</Text>
                </Pressable>
              }
            />
            <AttendanceTable rows={rows} />
          </Card>
        ) : null}
        {rows.length > 0 ? <DaysAttended count={daysAttended} /> : null}

        {anyPendingData(data) ? (
          <View style={styles.pending}>
            <Strip tone="warning" icon="sync" title="Pending attendance" text="Some entries are not yet sent to the server." />
            <ZButton title="Sync Pending Data" variant="outline" icon="sync" onPress={syncPending} testID="attendance-sync" />
          </View>
        ) : null}
        <Text style={styles.footnote}>Attendance is geo-tagged and time-stamped.</Text>
      </ZScroll>

      {punchOutOpen ? (
        <Sheet testID="punch-out-sheet">
          <PunchHeader title="Punch out" sub="Capture your selfie & confirm to close the day." onClose={() => setPunchOutOpen(false)} />
          <TimePlaceCard
            time={nowText()}
            place={geoText(outSelfie.selfie?.latitude, outSelfie.selfie?.longitude) ?? 'Location is captured with the selfie'}
          />
          <SelfieCard
            uri={selfieUri(outSelfie.selfie)}
            geo={geoText(outSelfie.selfie?.latitude, outSelfie.selfie?.longitude)}
            onPress={outSelfie.take}
            testID="punch-out-selfie"
          />
          <View style={styles.sheetButtons}>
            <ZButton title="Cancel" variant="ghost" onPress={() => setPunchOutOpen(false)} style={styles.cancel} testID="punch-out-cancel" />
            <SubmitButton title="Punch out & submit" ready={!!outSelfie.selfie} onPress={punchOut} style={{ flex: 64, marginLeft: 12 }} testID="punch-out-done" />
          </View>
        </Sheet>
      ) : null}
    </Page>
  );
}

/** The popup's heading (07b): "ATTENDANCE", the title, the hint and a round close button. */
function PunchHeader({ title, sub, onClose }: { title: string; sub: string; onClose?: () => void }) {
  return (
    <View style={styles.punchHead}>
      <View style={z.rowBetween}>
        <Text style={styles.caps}>ATTENDANCE</Text>
        {onClose ? (
          <Pressable style={styles.close} onPress={onClose} hitSlop={8} accessibilityLabel="Close" testID="punch-out-close">
            <ZIcon name="close" size={14} color={C.tSecondary} />
          </Pressable>
        ) : null}
      </View>
      <Text style={z.h1}>{title}</Text>
      <Text style={[z.muted, { marginTop: 4 }]}>{sub}</Text>
    </View>
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
        <View key={index} style={[styles.tr, index < rows.length - 1 && styles.trDivider]} testID={`log-${index}`}>
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

const COLS = [1.5, 1.05, 1.05, 0.8, 1.1];

function DaysAttended({ count }: { count: number }) {
  return (
    <View style={styles.totals}>
      <Text style={styles.totalsLabel}>Total days attended</Text>
      <Text style={styles.totalsValue} testID="days-attended">
        {String(count)}
      </Text>
    </View>
  );
}

/** PunchInFragment: the selfie, then "Done" (punch in, or out after a punch in). */
export function PunchInScreen() {
  const app = useSa();
  const nav = useNavigation();
  const { params } = useRoute<{ saveData: (a: Attendance) => Promise<void> }>();
  const { selfie, take } = useSelfie();
  const punch = usePunch(params.saveData);
  const out = isLatestEntryLogin(app.details!.attendanceData!);
  const geo = geoText(selfie?.latitude, selfie?.longitude);

  return (
    <Page testID="punch-in-form">
      <HeroHeader title="Attendance" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Card>
          <PunchHeader title={out ? 'Punch out' : 'Punch in'} sub={out ? 'Capture your selfie & confirm to close the day.' : 'Capture your selfie & confirm to start the day.'} />
          <TimePlaceCard time={nowText()} place={geo ?? 'Location is captured with the selfie'} />
          <SelfieCard uri={selfieUri(selfie)} geo={geo} onPress={take} testID="attendance-selfie" />
        </Card>
        <SubmitButton title={out ? 'Punch out & submit' : 'Punch in & submit'} ready={!!selfie} onPress={() => punch(selfie)} style={{ marginTop: 8 }} testID="punch-done" />
      </ZScroll>
    </Page>
  );
}

/** AttendanceLogFragment: one row per day (In / Out / Total), "Close". */
export function AttendanceLogScreen() {
  const app = useSa();
  const nav = useNavigation();
  const rows = attendanceLog(app.details!.attendanceData!.attendanceList);
  return (
    <Page testID="attendance-log-screen">
      <HeroHeader title="Attendance" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Card>
          <SectionLabel label="Assessment attendance log" style={{ marginTop: 0 }} />
          {rows.length > 0 ? <AttendanceTable rows={rows} /> : <DashedBox label="No attendance recorded yet" icon="calendar" style={{ height: 84 }} />}
        </Card>
        <DaysAttended count={rows.filter(r => r.loginDate != null).length} />
        <Text style={styles.footnote}>Attendance is geo-tagged and time-stamped.</Text>
        <ZButton title="Close" variant="ghost" onPress={() => nav.pop()} style={{ marginTop: 16 }} testID="log-close" />
      </ZScroll>
    </Page>
  );
}

const styles = StyleSheet.create({
  selfieWrap: { alignItems: 'center', paddingVertical: 8 },
  selfieRing: { width: 104, height: 104, borderRadius: 52, backgroundColor: C.successBg, alignItems: 'center', justifyContent: 'center' },
  selfieImage: { width: 94, height: 94, borderRadius: 47 },
  selfieEmpty: { width: 100, height: 100, borderRadius: 50, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  capturedChip: { flexDirection: 'row', alignItems: 'center', height: 26, borderRadius: 13, backgroundColor: C.successBg, paddingHorizontal: 10, marginTop: 12 },
  capturedText: { fontSize: 11, fontWeight: '700', color: C.success, marginLeft: 6 },
  geoBox: { flexDirection: 'row', alignItems: 'center', borderColor: C.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginTop: 8 },
  geoText: { flex: 1, fontSize: 10, color: C.tMuted, textAlign: 'center' },
  punchRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
  punchTile: { flex: 1, height: 60, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileFilled: { backgroundColor: C.primary, overflow: 'hidden' },
  tileOutline: { backgroundColor: C.surface, borderColor: C.primary, borderWidth: 1 },
  tileLocked: { backgroundColor: C.muted },
  punchTitle: { fontSize: 14, fontWeight: '700' },
  punchSub: { fontSize: 11, color: C.tMuted, marginTop: 3 },
  divider: { height: 1, backgroundColor: C.divider, marginVertical: 14 },
  link: { fontSize: 12, fontWeight: '600', color: C.primary },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  thRow: { borderBottomColor: C.divider, borderBottomWidth: 1, paddingTop: 0 },
  trDivider: { borderBottomColor: C.divider, borderBottomWidth: 1 },
  th: { fontSize: 9, fontWeight: '700', color: C.tMuted, letterSpacing: 0.4 },
  td: { fontSize: 11, color: C.tSecondary },
  day: { fontSize: 12, fontWeight: '600', color: C.tPrimary },
  date: { fontSize: 9, color: C.tMuted, marginTop: 2 },
  totals: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.primaryBg, borderRadius: 12, paddingHorizontal: 12, height: 48, marginTop: 4 },
  totalsLabel: { fontSize: 13, fontWeight: '600', color: C.tPrimary },
  totalsValue: { fontSize: 15, fontWeight: '700', color: C.primaryDark },
  pending: { marginTop: 16 },
  footnote: { fontSize: 10, color: C.tMuted, marginTop: 10 },
  cancel: { flex: 36, minHeight: 52, borderRadius: 12 },
  punchHead: { paddingHorizontal: 8, paddingBottom: 14, marginBottom: 14, borderBottomColor: C.divider, borderBottomWidth: 1 },
  caps: { fontSize: 11, fontWeight: '600', color: C.tMuted, letterSpacing: 0.5 },
  close: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  sheetButtons: { flexDirection: 'row', marginTop: 24 },
});
