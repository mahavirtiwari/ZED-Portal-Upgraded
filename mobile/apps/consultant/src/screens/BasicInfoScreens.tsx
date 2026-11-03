import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  basicInfoValue,
  CustomFormField,
  isAnswered,
  isBasicInfoFieldShown,
  isFormChangedRefusal,
  isNetworkAvailable,
  isSuccess,
  stampFormAnswers,
  useFocusEffect,
  useNavigation,
  useRoute,
  useUi,
  validateBasicInformation,
  type FormDefinition,
  type FormField,
} from '@zed/shared';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { basicInfoSubmitted, submitBasicInformation } from '../flows/submissions';
import { CONSULTANT_BASIC_INFO, STANDARD_KEYS } from '../forms';
import {
  DATA_ERROR,
  DATA_SUBMITTED,
  NETWORK_SAVED_LOCALLY,
  newBasicInformation,
  normalizeBasicInformation,
  Status,
  stringStatus,
  updatedBasicInfoStatus,
  type BasicInfoParameter,
  type BasicInformation,
} from '../models';
import { Badge, C, Card, HeroHeader, Page, ProgressBar, SectionLabel, Strip, useKeyboardHeight, z, ZButton, ZIcon, ZScroll, type IconName, type Tone } from '../ui/zed';

function useForm(app: SaApp): FormDefinition {
  useSyncExternalStore(
    l => app.forms.subscribe(l),
    () => app.forms.getRevision(),
  );
  return app.forms.get(CONSULTANT_BASIC_INFO);
}

/** The draft (created the first time, as BasicInformationActivity.onCreate). */
function useBasicInformation(app: SaApp): BasicInformation {
  const d = app.details!;
  return useMemo(() => {
    if (d.saBasicInformation == null) d.saBasicInformation = newBasicInformation();
    return normalizeBasicInformation(d.saBasicInformation);
  }, [d]);
}

/** The sections that have fields to show (a section whose fields the Admin all disabled is left out). */
const shownSections = (def: FormDefinition) => def.sections.filter(s => def.fields.some(f => f.section === s.key));

/** A section's status (each group of the request keeps its own); an Admin section without a group keeps none. */
const groupOf = (info: BasicInformation, section: string) => (info as unknown as Record<string, BasicInfoParameter | undefined>)[section];

/** A section's requirements (the fields shown for the answers so far) and how many of them are answered. */
function sectionProgress(def: FormDefinition, info: BasicInformation, section: string): { total: number; filled: number } {
  const fields = def.fields.filter(f => f.section === section && isBasicInfoFieldShown(def, info, f));
  return { total: fields.length, filled: fields.filter(f => isAnswered(basicInfoValue(info, f))).length };
}

const STATUS_TONES: Record<Status, Tone> = {
  [Status.TO_START]: 'neutral',
  [Status.IN_PROGRESS]: 'warning',
  [Status.COMPLETED]: 'success',
  [Status.SUBMITTED]: 'success',
};

/** The icon wells of the legacy groups (an Admin section of its own gets the clipboard). */
const SECTION_ICONS: Record<string, IconName> = {
  occupationalSafety: 'shield',
  measurementOfTimelyDelivery: 'calendar',
  plannedMaintenanceCalibration: 'settings',
  energyManagement: 'sync',
  environmentManagement: 'flag',
  humanResourceManagement: 'users',
  measurementAnalysis: 'clipboard',
  naturalResourcesManagement: 'map-pin',
  financialPerformance: 'document',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The summary band at the top of both pages: icon, title, line, progress. */
function Summary({ icon, title, line, value, testID }: { icon: IconName; title: string; line: string; value: number; testID?: string }) {
  return (
    <View style={styles.summary} testID={testID}>
      <View style={z.rowCenter}>
        <ZIcon name={icon} size={22} color={C.primaryDark} />
        <View style={styles.summaryText}>
          <Text style={styles.summaryTitle}>{title}</Text>
          <Text style={styles.summarySub}>{line}</Text>
        </View>
      </View>
      <View style={styles.summaryBar}>
        <ProgressBar value={value} />
      </View>
    </View>
  );
}

/** BACK + the primary action at the foot of the pages (the legacy NavigationFooter's test ids). */
function Footer({ title, onBack, onProceed, disabled, testID }: { title: string; onBack: () => void; onProceed: () => void; disabled?: boolean; testID: string }) {
  const insets = useSafeAreaInsets();
  // Above the keyboard there is no navigation bar to clear.
  const keyboard = useKeyboardHeight();
  return (
    <View style={[styles.footer, { paddingBottom: 12 + (keyboard ? 0 : insets.bottom) }]} testID={testID}>
      <ZButton title="Back" variant="ghost" onPress={onBack} style={styles.footerBack} testID={`${testID}-back`} />
      <ZButton title={title} onPress={onProceed} disabled={disabled} style={styles.footerProceed} testID={`${testID}-proceed`} />
    </View>
  );
}

/**
 * BasicInformationActivity: the groups (the sections of the Admin's form, docs/mobile/APP-FORMS.md
 * `consultant.basicInfo`) with their status and requirements captured; Submit once all are completed submits them
 * (SubmitBasicInformation).
 */
export function BasicInformationScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const def = useForm(app);
  const info = useBasicInformation(app);
  const [, rerender] = useState(0);

  useEffect(() => {
    isNetworkAvailable()
      .then(online => (online ? app.forms.refresh(CONSULTANT_BASIC_INFO, () => app.api.getFormDefinition(CONSULTANT_BASIC_INFO)) : false))
      .catch(() => undefined);
    // onPause: the overall status is refreshed and saved.
    return () => {
      updatedBasicInfoStatus(info);
      app.update();
    };
  }, [app, info]);

  useFocusEffect(useCallback(() => rerender(x => x + 1), []));

  const sections = shownSections(def);
  const allCompleted = sections.every(s => groupOf(info, s.key)?.status.status === Status.COMPLETED);
  const completed = sections.filter(s => groupOf(info, s.key)?.status.status === Status.COMPLETED).length;
  const progress = sections.map(s => sectionProgress(def, info, s.key));
  const requirements = progress.reduce((n, p) => n + p.total, 0);

  const onProceed = async () => {
    if (validateBasicInformation(def, info).size > 0) return ui.toast(DATA_ERROR);
    stampFormAnswers(def, info, STANDARD_KEYS);
    await app.update();
    info.status = Status.COMPLETED;
    if (await isNetworkAvailable()) {
      ui.showLoading();
      const r = await submitBasicInformation(app, info);
      ui.hideLoading();
      if (isSuccess(r)) {
        await basicInfoSubmitted(app);
        ui.toast(DATA_SUBMITTED);
        nav.pop();
      } else if (r.errorMessage) {
        ui.toast(r.errorMessage);
        if (isFormChangedRefusal(r.errorMessage)) await app.forms.refresh(CONSULTANT_BASIC_INFO, () => app.api.getFormDefinition(CONSULTANT_BASIC_INFO));
      }
    } else {
      ui.alert(
        'Alert',
        NETWORK_SAVED_LOCALLY,
        [
          {
            text: 'OK',
            onPress: async () => {
              info.status = Status.COMPLETED;
              await app.update();
              nav.pop();
            },
          },
        ],
        false,
      );
    }
  };

  return (
    <Page testID="basic-information">
      <HeroHeader title="Basic Information" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Summary
          icon="clipboard"
          title={`${completed} of ${sections.length} sections captured`}
          line={`${plural(requirements, 'requirement')} in all — every section is mandatory.`}
          value={sections.length ? completed / sections.length : 0}
          testID="basic-summary"
        />
        {sections.length > 0 && allCompleted ? <Strip text={`All ${sections.length} sections captured with their requirements.`} tone="success" icon="check" /> : null}
        <SectionLabel label="Sections" />
        {sections.map((s, i) => {
          const group = groupOf(info, s.key);
          const status = group?.status.status ?? Status.TO_START;
          const { total, filled } = progress[i]!;
          const done = status === Status.COMPLETED || status === Status.SUBMITTED;
          return (
            <Card
              key={s.key}
              style={styles.row}
              onPress={() => {
                if (group) group.status.status = Status.IN_PROGRESS;
                nav.push('BasicInfoSection', { section: s.key });
              }}
              testID={`basic-section-${s.key}`}
            >
              <View style={styles.well}>
                <ZIcon name={SECTION_ICONS[s.key] ?? 'clipboard'} size={20} color={C.primaryDark} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {s.label}
                </Text>
                <View style={styles.rowMeta}>
                  <Text style={styles.rowSub}>{plural(total, 'requirement')}</Text>
                  <Badge label={stringStatus(group?.status ?? { status }) ?? ''} tone={STATUS_TONES[status]} small testID={`basic-status-${s.key}`} />
                </View>
              </View>
              <View style={[styles.pill, done && styles.pillDone]} testID={`basic-count-${s.key}`}>
                <Text style={[styles.pillText, done && styles.pillTextDone]}>{`${filled}/${total}`}</Text>
                <ZIcon name="chevron-right" size={14} color={done ? C.tInverse : C.primaryDark} />
              </View>
            </Card>
          );
        })}
      </ZScroll>
      <Footer title="Submit" onBack={() => nav.pop()} onProceed={onProceed} disabled={!allCompleted} testID="basic-footer" />
    </Page>
  );
}

/** Sets the answer at a property path (`energyManagement.solar.unit`), creating the objects on the way. */
function setAtPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] == null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/**
 * The group's fragment (OccupationalSafetyFragment, EnergyManagementFragment, ...): its title, the fields of the
 * Admin's form with their headings, BACK and PROCEED (the fields left empty are marked "Required"; valid -> completed).
 */
export function BasicInfoSectionScreen() {
  const app = useSa();
  const nav = useNavigation();
  const { params } = useRoute<{ section: string }>();
  const def = useForm(app);
  const info = useBasicInformation(app);
  const section = def.sections.find(s => s.key === params.section);
  const fields = def.fields.filter(f => f.section === params.section);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [, rerender] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const setValue = (f: FormField, v: unknown) => {
    if (f.custom) info.customAnswers = { ...(info.customAnswers ?? {}), [f.key]: v };
    else setAtPath(info as unknown as Record<string, unknown>, f.key, v === '' ? null : v);
    if (errors.has(f.key)) {
      const e = new Map(errors);
      e.delete(f.key);
      setErrors(e);
    }
    rerender(x => x + 1);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => app.update(), 500);
  };

  const proceed = async () => {
    const sectionDef: FormDefinition = { ...def, fields };
    const e = validateBasicInformation(sectionDef, info);
    setErrors(e);
    if (e.size > 0) return;
    const group = groupOf(info, params.section);
    if (group) group.status.status = Status.COMPLETED;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await app.update();
    nav.pop();
  };

  const { total, filled } = sectionProgress(def, info, params.section);

  return (
    <Page testID="basic-info-section">
      <HeroHeader title="Basic Information" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        <Summary
          icon={SECTION_ICONS[params.section] ?? 'clipboard'}
          title={section?.label ?? ''}
          line={`${filled} of ${plural(total, 'requirement')} captured`}
          value={total ? filled / total : 0}
          testID="section-summary"
        />
        {total > 0 && filled === 0 ? (
          <Strip title="Nothing captured yet" text="Capture every requirement listed below. Values are validated before this section is completed." tone="warning" icon="info" />
        ) : total > 0 && filled === total ? (
          <Strip text="All requirements captured for this section." tone="success" icon="check" />
        ) : null}
        <SectionLabel label="Requirements" />
        {fields.map(f => {
          if (!isBasicInfoFieldShown(def, info, f)) return null;
          return (
            <React.Fragment key={f.key}>
              {f.heading ? <SectionLabel label={f.heading} brand style={styles.heading} /> : null}
              <CustomFormField field={{ ...f, heading: null }} value={basicInfoValue(info, f) ?? ''} onChange={v => setValue(f, v)} error={errors.get(f.key) ?? null} testID={`field-${f.key}`} />
            </React.Fragment>
          );
        })}
      </ZScroll>
      <Footer title="Proceed" onBack={() => nav.pop()} onProceed={proceed} testID="section-footer" />
    </Page>
  );
}

const styles = StyleSheet.create({
  summary: { backgroundColor: C.primaryBg, borderRadius: 12, padding: 16, marginBottom: 12 },
  summaryText: { flex: 1, marginLeft: 14 },
  summaryTitle: { fontSize: 13, fontWeight: '700', color: C.tPrimary },
  summarySub: { fontSize: 11, color: C.tSecondary, marginTop: 3 },
  summaryBar: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  well: { width: 36, height: 36, borderRadius: 9, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowText: { flex: 1, marginRight: 8 },
  rowTitle: { fontSize: 13.5, fontWeight: '700', color: C.tPrimary },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  rowSub: { fontSize: 11, color: C.tSecondary },
  pill: { flexDirection: 'row', alignItems: 'center', height: 26, borderRadius: 8, paddingLeft: 10, paddingRight: 6, backgroundColor: C.primaryBg, gap: 4 },
  pillDone: { backgroundColor: C.primary },
  pillText: { fontSize: 11, fontWeight: '700', color: C.primaryDark },
  pillTextDone: { color: C.tInverse },
  heading: { marginTop: 14 },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  footerBack: { flex: 36 },
  footerProceed: { flex: 64 },
});
