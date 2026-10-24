import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, isNetworkError, isSuccess, PhotosField, TextField, useNavigation, useRoute, useUi, type PhotoData } from '@zed/shared';
import { useSa } from '../app/context';
import {
  addEntry,
  attendanceLog,
  formatDay,
  formatTime,
  isLoggedInToday,
  isLoggedOutToday,
  loginEntryToday,
  logoutEntryToday,
  newAttendance,
  timeOf,
  totalHours,
} from '../attendance';
import { queueAttendance, submitAttendance } from '../flows/submissions';
import { useSaPhotoCapture } from '../photo/capture';
import { isFourthMilestone, UNKNOWN_ERROR, type Attendance } from '../models';
import { SaButton, SaFrame, SaInverseButton, sa } from '../ui/kit';

type Result = (ok: boolean) => void;

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

  return (
    <SaFrame title="Attendance" testID="attendance">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.times}>
          <View style={styles.timeBox}>
            <Text style={styles.timeLabel}>Punch In</Text>
            <Text style={styles.timeValue} testID="punch-in-value">
              {todayIn ? formatTime(timeOf(todayIn)) : '--:--'}
            </Text>
          </View>
          <View style={styles.timeBox}>
            <Text style={styles.timeLabel}>Punch Out</Text>
            <Text style={styles.timeValue} testID="punch-out-value">
              {todayOut ? formatTime(timeOf(todayOut)) : '--:--'}
            </Text>
          </View>
        </View>
        {!isLoggedInToday(data) ? <SaInverseButton title="Punch In" onPress={() => nav.push('PunchIn', { saveData })} testID="punch-in" /> : null}
        {isLoggedInToday(data) && !isLoggedOutToday(data) ? (
          <SaInverseButton title="Punch Out" onPress={() => nav.push('PunchIn', { saveData })} testID="punch-out" />
        ) : null}
        {data.attendanceList.length > 0 ? <SaInverseButton title="View Attendance Record" onPress={() => nav.push('AttendanceLog')} testID="attendance-log" /> : null}
      </ScrollView>
    </SaFrame>
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
  const [comments, setComments] = useState('');

  const done = async () => {
    if (!selfie) return ui.snackbar('Please capture selfie');
    const d = app.details!.attendanceData!;
    const a = newAttendance(selfie, comments.trim() === '' ? null : comments, isLoggedInToday(d) ? 'LOGOUT' : 'LOGIN');
    const error = addEntry(d, a);
    if (error) return ui.snackbar(error);
    nav.pop();
    await params.saveData(a);
  };

  return (
    <SaFrame title="Attendance" testID="punch-in-form">
      <ScrollView contentContainerStyle={styles.content}>
        <PhotosField label="Selfie" photos={selfie ? [selfie] : []} onChange={list => setSelfie(list[0] ?? null)} capturer={capturer} store={app.photos} testID="attendance-selfie" />
        <TextField label="Day Agenda" value={comments} onChange={setComments} multiline testID="attendance-comments" />
        <SaButton title="Done" large onPress={done} testID="punch-done" />
      </ScrollView>
    </SaFrame>
  );
}

/** AttendanceLogFragment: one row per day (tap to show In/Out/Total/Stage), "Close". */
export function AttendanceLogScreen() {
  const app = useSa();
  const nav = useNavigation();
  const rows = attendanceLog(app.details!.attendanceData!.attendanceList);
  // getMilestoneStage
  const stage = isFourthMilestone(app.details!) ? 'Technology Upgradation' : `Milestone - ${app.details!.milestone}`;
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <SaFrame title="Attendance" testID="attendance-log-screen">
      <FlatList
        data={rows}
        keyExtractor={(_, i) => String(i)}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item, index }) => (
          <View style={styles.logRow}>
            <Pressable onPress={() => setOpen(s => (s.has(index) ? new Set([...s].filter(x => x !== index)) : new Set([...s, index])))} testID={`log-${index}`}>
              <Text style={styles.logHeader}>{`+ ${formatDay(item.date)}`}</Text>
            </Pressable>
            {open.has(index) ? (
              <View>
                {[
                  ['Date', formatDay(item.date)],
                  ['In Time', item.loginDate != null ? formatTime(item.loginDate) : ''],
                  ['Out Time', item.logoutDate != null ? formatTime(item.logoutDate) : ''],
                  ['Total Hours', totalHours(item)],
                  ['Stage', stage],
                ].map(([l, v]) => (
                  <View key={l} style={styles.logLine}>
                    <Text style={styles.logLabel}>{l}</Text>
                    <Text style={styles.logValue}>{v}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
      />
      <SaButton title="Close" large onPress={() => nav.pop()} testID="log-close" />
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  times: { flexDirection: 'row', marginBottom: 16 },
  timeBox: { flex: 1, alignItems: 'center' },
  timeLabel: { color: sa.coolGrey, fontSize: 15 },
  timeValue: { color: sa.darkGrey, fontSize: 24, fontWeight: 'bold' },
  separator: { height: 1, backgroundColor: sa.divider },
  logRow: { padding: 12 },
  logHeader: { color: sa.darkGrey, fontSize: 16, fontWeight: 'bold' },
  logLine: { flexDirection: 'row', paddingVertical: 3 },
  logLabel: { width: 120, color: sa.coolGrey, fontSize: 15 },
  logValue: { color: sa.darkGrey, fontSize: 15 },
});
