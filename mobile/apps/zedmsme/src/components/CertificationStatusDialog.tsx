import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, dimens, Icon, ZedButton, ZedDialog } from '@zed/shared';
import { icons } from '../assets/icons';
import type { CertificationType } from '../models';
import { Note } from '../ui/legacy';

/**
 * New in V4: VIEW DETAILS of a certification card. The legacy app showed Msme/ViewStatus in a WebView
 * (CertificationDetailsDialogFragment); this is the same page drawn natively from Msme/AppCertificationStatus:
 * the steps and their YOU / ZED lines, the NC rounds in red. Steps not reached yet stay in grey ("Not yet") where the
 * page hid them.
 */

export type StatusLine = { who: 'YOU' | 'ZED'; text: string };

export type StatusStep = {
  title: string;
  reached: boolean;
  lines: StatusLine[];
  /** Non Conformance(s) (NC): the final closure date and the rounds (raised by ZED, answered by you). */
  nc: { closure: string; lines: StatusLine[] } | null;
  /** After the NC block (NC closed, completed on). */
  after: StatusLine[];
  /** Avail Incentives: the incentives page. */
  link: string | null;
  /** Shown instead of the lines while the step is not reached. */
  pending: string;
};

export type CertificationStatus = { applicationReceived: string | null; steps: StatusStep[] };

const text = (v: string | null | undefined) => (v != null && String(v).trim() !== '' ? String(v).trim() : null);

/** Views/Msme/ViewStatus.cshtml: Bronze has no assessment step, Silver and Gold have Remote/Onsite Assessment. */
export function certificationStatus(level: CertificationType, f: Record<string, string | null | undefined>): CertificationStatus {
  const line = (who: StatusLine['who'], key: string): StatusLine[] => {
    const t = text(f[key]);
    return t ? [{ who, text: t }] : [];
  };
  const nc = (): StatusStep['nc'] => {
    const closure = text(f.NcFinalClosureDate);
    if (!closure) return null;
    const lines = [1, 2, 3, 4, 5].flatMap(n => [...line('ZED', `Nc${n}Raised`), ...line('YOU', `Nc${n}Submitted`)]);
    return { closure, lines };
  };
  // A step is reached when its first field is set (the page's ng-show) or when any of its lines has data: a unit
  // whose history lacks the first entry still sees its NC rounds.
  const step = (title: string, reached: boolean, rest: Partial<StatusStep> = {}): StatusStep => ({
    title,
    reached: reached || !!rest.lines?.length || !!rest.nc || !!rest.after?.length,
    lines: [],
    nc: null,
    after: [],
    link: null,
    pending: 'Not yet',
    ...rest,
  });
  const applicationReceived = text(f.ApplicationReceived);
  const certified = text(f.GetCertified);
  const steps: StatusStep[] = [
    step('Basic Information and Document Upload', !!applicationReceived, { lines: line('YOU', 'BasicInfoStatus') }),
  ];
  if (level === 'Bronze') {
    steps.push(
      step('Desktop Verification', !!text(f.BronzeDesktopVerification), {
        lines: line('ZED', 'BronzeDesktopVerification'),
        nc: nc(),
        after: [...line('ZED', 'NcClosed'), ...line('ZED', 'CompletedOn')],
      }),
    );
  } else {
    steps.push(
      step('Desktop Verification', !!text(f.DesktopVerification), { lines: line('ZED', 'DesktopVerification') }),
      step('Remote/Onsite Assessment', !!text(f.ScheduledOn), {
        lines: line('ZED', 'ScheduledOn'),
        nc: nc(),
        after: [...line('ZED', 'NcClosed'), ...line('ZED', 'CompletedOn')],
      }),
    );
  }
  steps.push(
    step('Get Certified!', !!certified, { lines: line('ZED', 'GetCertified') }),
    step('Avail Incentives', !!certified, { link: text(f.AvailIncentive), pending: 'After certification' }),
  );
  return { applicationReceived, steps };
}

const STEP_ICONS = [icons.ic_step_1, icons.ic_step_2, icons.ic_step_3, icons.ic_step_4, icons.ic_step_5];

function Line({ line }: { line: StatusLine }) {
  return (
    <Text style={styles.line}>
      <Text style={[styles.who, line.who === 'ZED' && { color: colors.appColor }]}>{line.who}: </Text>
      {line.text}
    </Text>
  );
}

export function CertificationStatusDialog({
  level,
  status,
  onClose,
}: {
  level: CertificationType;
  status: CertificationStatus;
  onClose: () => void;
}) {
  return (
    <ZedDialog visible title={`${level} Certification`} onClose={onClose} testID="status-dialog">
      {status.applicationReceived ? (
        <Note tone="green" testID="status-received">
          <Text style={styles.line}>
            <Text style={styles.stepTitle}>Application Received</Text>
            {'\n'}
            {status.applicationReceived}
          </Text>
        </Note>
      ) : null}
      {status.steps.map((s, i) => (
        <View key={s.title} style={[styles.step, !s.reached && styles.stepPending]} testID={`status-step-${i + 1}`}>
          {s.reached ? (
            <Icon icon={STEP_ICONS[i] ?? icons.ic_step_5} width={30} height={34} />
          ) : (
            <View style={styles.greyNumber}>
              <Text style={styles.greyNumberText}>{i + 1}</Text>
            </View>
          )}
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>{s.title}</Text>
            {!s.reached ? <Text style={styles.line}>{s.pending}</Text> : null}
            {s.reached ? s.lines.map((l, j) => <Line key={j} line={l} />) : null}
            {s.reached && s.nc ? (
              <View style={styles.nc} testID="status-nc">
                <Text style={styles.line}>
                  <Text style={styles.ncTitle}>Non-Conformance(s) (NC)</Text> ({s.nc.closure})
                </Text>
                {s.nc.lines.map((l, j) => (
                  <Line key={j} line={l} />
                ))}
              </View>
            ) : null}
            {s.reached ? s.after.map((l, j) => <Line key={`a${j}`} line={l} />) : null}
            {s.reached && s.link ? (
              <Pressable onPress={() => Linking.openURL(s.link!).catch(() => undefined)} testID="status-incentives">
                <Text style={styles.link}>View your Incentives</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      <ZedButton title="OK" onPress={onClose} small style={styles.ok} testID="status-ok" />
    </ZedDialog>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', marginVertical: dimens.padding2 },
  stepPending: { opacity: 0.5 },
  stepBody: { flex: 1, marginLeft: dimens.padding3 },
  stepTitle: { fontWeight: 'bold', fontSize: dimens.textSize, color: colors.black },
  line: { fontSize: dimens.textSize14, color: colors.black, lineHeight: 21 },
  who: { fontWeight: 'bold', color: colors.black },
  greyNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.progressBarColor, alignItems: 'center', justifyContent: 'center' },
  greyNumberText: { color: colors.white, fontWeight: 'bold' },
  nc: { backgroundColor: colors.ncBackground, borderRadius: 5, padding: dimens.padding2, marginTop: dimens.padding1 },
  ncTitle: { fontWeight: 'bold', color: colors.ncRed },
  link: { color: colors.appColor, fontWeight: 'bold', fontSize: dimens.textSize14, marginTop: dimens.padding1 },
  ok: { alignSelf: 'center', marginTop: dimens.padding2 },
});
