import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { COMMENT_LENGTH, NUMERIC_MAX_LENGTH, numericFilter, PhotosField, useBackHandler, useFocusEffect, useNavigation, useRoute, useUi, type PhotoData } from '@zed/shared';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { submitModuleParameter, submitProgressReviewSelfie } from '../flows/submissions';
import { useSaPhotoCapture } from '../photo/capture';
import {
  COMPLETED,
  DATA_ERROR,
  IN_PROGRESS,
  isBaselineDiagnosticInfoValid,
  isFourthMilestone,
  isHandholdingActionPlanValid,
  isProgressReviewValid,
  isSuggestionForTechnologyInterventionValid,
  NO,
  onRequirementUpdated,
  PARTIAL,
  Status,
  SUBMITTED,
  TO_START,
  YES,
  type AllottedParameters,
  type BaselineDiagnosticStudyData,
  type ConsultantPhoto,
  type ParametersModule,
  type RequirementDetails,
} from '../models';
import { RequirementVideoButton } from '../components/RequirementVideoButton';
import { promptComment, REQUIRED, usePresentPhotos } from '../ui/inputs';
import { Badge, C, Card, CharCounter, Field, HeroHeader, Page, SectionLabel, Strip, z, ZButton, ZIcon, ZScroll, type IconName, type Tone } from '../ui/zed';

/** The screens' titles (headers). */
export const MODULE_TITLES: Record<ParametersModule, string> = {
  baselineDiagnostic: 'Baseline Diagnostic Study',
  handholdingActionPlan: 'Handholding Action Plan',
  technologyIntervention: 'Suggestion for Technology Intervention',
  progressReview: 'Progress Review',
};

const DATA_KEYS = {
  baselineDiagnostic: 'baselineDiagnosticStudyData',
  handholdingActionPlan: 'handholdingActionPlanData',
  technologyIntervention: 'suggestionForTechnologyIntervention',
  progressReview: 'progressReview',
} as const;

/** The screen's data: created from a deep copy of the allotted parameters the first time (onCreate). */
export function moduleData(app: SaApp, module: ParametersModule, create = false): BaselineDiagnosticStudyData | null {
  const d = app.details!;
  const key = DATA_KEYS[module];
  if (d[key] == null && create) {
    if (!d.allottedParameters) return null;
    d[key] = { status: Status.TO_START, parameters: JSON.parse(JSON.stringify(d.allottedParameters)) as AllottedParameters[] };
  }
  return (d[key] as BaselineDiagnosticStudyData | null | undefined) ?? null;
}

/** The answers in the design's order (the legacy dropdown listed Yes, No, Partial). */
const CONFORMANCE_OPTIONS = [YES, PARTIAL, NO];

const STATUS_BADGES: Record<number, { label: string; tone: Tone }> = {
  [TO_START]: { label: 'To Start', tone: 'neutral' },
  [IN_PROGRESS]: { label: 'In Progress', tone: 'warning' },
  [COMPLETED]: { label: 'Completed', tone: 'success' },
  [SUBMITTED]: { label: 'Submitted', tone: 'primary' },
};

/** ParametersListAdapter in the design's parameter card: icon well, name, status chip, "n Question(s)", "Review Needed" while in progress. */
function ParameterRow({ p, onPress, testID }: { p: AllottedParameters; onPress: () => void; testID: string }) {
  const n = p.requirements?.length;
  const badge = p.requirements != null ? STATUS_BADGES[p.status] : undefined;
  const review = p.requirements != null && p.status === IN_PROGRESS && p.requirements.some(r => r.reviewNeeded);
  const idle = !badge || p.status === TO_START;
  return (
    <Card onPress={onPress} style={styles.paramCard} testID={testID}>
      <View style={[styles.well, idle && { backgroundColor: C.muted }]}>
        <ZIcon name="clipboard" size={20} color={idle ? C.tMuted : C.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.paramName}>{p.parameterName ?? ''}</Text>
        <View style={styles.paramMeta}>
          {badge ? <Badge label={badge.label} tone={badge.tone} small testID={`${testID}-status`} /> : null}
          {review ? <Badge label="Review Needed" tone="danger" small testID={`${testID}-review`} /> : null}
          <Text style={styles.paramCount}>{`${p.requirements != null ? n : 0} Question(s)`}</Text>
        </View>
      </View>
      <ZIcon name="chevron-right" size={18} color={C.tMuted} />
    </Card>
  );
}

/**
 * BaselineDiagnosticStudyActivity / HandholdingActionPlanActivity / SuggestionForTechnologyInterventionActivity /
 * ProgressReviewActivity with their ParametersFragment: the parameters (the screen's own copy), BACK, and SUBMIT
 * (the legacy PROCEED) to send the completed ones one after the other (their evidences first). All sent: the section is
 * submitted.
 */
export function ModuleScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ module: ParametersModule }>();
  const module = params.module;
  const data = useMemo(() => moduleData(app, module, true), [app, module]);
  const [, rerender] = useState(0);
  const selfieShown = useRef(false);

  useEffect(() => {
    if (!data) {
      nav.pop();
      return;
    }
    app.update();
    // ProgressReviewActivity: the consultant's selfie first.
    if (module === 'progressReview' && !data.selfie && !selfieShown.current) {
      selfieShown.current = true;
      nav.push('ProgressReviewSelfie');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(useCallback(() => rerender(x => x + 1), []));

  if (!data) return null;

  /** syncCompletedParameters */
  const sync = async () => {
    const d = app.details!;
    for (;;) {
      if (module === 'progressReview') {
        if (isFourthMilestone(d)) return;
        const selfie = data.selfie;
        if (!selfie) return;
        if (selfie.filePath == null) {
          ui.showLoading();
          const failed = await submitProgressReviewSelfie(app, data);
          ui.hideLoading();
          if (failed) return ui.showAlert(failed);
          continue;
        }
      }
      if (data.parameters.every(p => p.status === SUBMITTED)) {
        data.status = Status.SUBMITTED;
        await app.update();
        nav.pop();
        return;
      }
      data.status = Status.IN_PROGRESS;
      await app.update();
      const completed = data.parameters.find(p => p.status === COMPLETED);
      if (!completed) return;
      ui.showLoading();
      const failed = await submitModuleParameter(app, module, completed);
      ui.hideLoading();
      rerender(x => x + 1);
      if (failed) return ui.showAlert(failed);
    }
  };

  // Grey while nothing is ready to send; still tappable, as the legacy PROCEED was.
  const ready = data.parameters.some(p => p.status === COMPLETED) || data.parameters.every(p => p.status === SUBMITTED);
  const done = data.parameters.filter(p => p.status === COMPLETED || p.status === SUBMITTED).length;

  return (
    <Page testID="module">
      <HeroHeader title={MODULE_TITLES[module]} subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <SectionLabel label="Parameters" right={<Text style={z.muted} testID="module-progress">{`${done} of ${data.parameters.length} completed`}</Text>} />
        {data.parameters.map((p, i) => (
          <ParameterRow key={`${p.parameterId}-${i}`} p={p} onPress={() => nav.push('Requirements', { module, parameterIndex: i })} testID={`module-param-${i}`} />
        ))}
      </ZScroll>
      <Footer>
        <ZButton title="Back" variant="outline" onPress={() => nav.pop()} style={styles.footerButton} testID="module-footer-back" />
        <ZButton title="Submit" onPress={sync} variant={ready ? 'primary' : 'ghost'} style={[styles.footerButton, !ready && styles.grey]} testID="module-footer-proceed" />
      </Footer>
    </Page>
  );
}

/** The white bar under a screen with its buttons. */
function Footer({ children }: { children: React.ReactNode }) {
  return <View style={styles.footer}>{children}</View>;
}

/** SelfieFragment of the progress review: "Consultant Selfie on Site"; BACK without one leaves the progress review. */
export function ProgressReviewSelfieScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const capturer = useSaPhotoCapture();
  const data = moduleData(app, 'progressReview');
  const [selfie, setSelfie] = useState<PhotoData | null>(data?.selfie ?? null);

  const back = () => {
    // onBackPressed of the activity: no selfie yet -> finish().
    if (!app.details?.progressReview?.selfie) nav.popTo('AssessmentOptions');
    else nav.pop();
  };
  useBackHandler(() => {
    back();
    return true;
  });

  const proceed = async () => {
    if (!selfie) return ui.snackbar('Please capture selfie to proceed');
    if (data) data.selfie = selfie as ConsultantPhoto;
    await app.update();
    nav.pop();
  };

  return (
    <Page testID="pr-selfie">
      <HeroHeader title={MODULE_TITLES.progressReview} subtitle={app.zedId} onBack={back} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <Strip text="Take a selfie at the unit before the progress review." icon="camera" />
        <Card>
          <PhotosField label="Consultant Selfie on Site" photos={selfie ? [selfie] : []} onChange={l => setSelfie(l[0] ?? null)} capturer={capturer} store={app.photos} testID="pr-selfie-photo" />
        </Card>
      </ZScroll>
      <Footer>
        <ZButton title="Back" variant="outline" onPress={back} style={styles.footerButton} testID="pr-selfie-footer-back" />
        <ZButton title="Proceed" onPress={proceed} variant={selfie ? 'primary' : 'ghost'} style={[styles.footerButton, !selfie && styles.grey]} testID="pr-selfie-footer-proceed" />
      </Footer>
    </Page>
  );
}

/**
 * RequirementsPagerFragment: the parameter's requirements as swipeable pages (ViewPager2); a page's BACK goes to the
 * previous one (or leaves on the first), PROCEED / REVIEW to the next one (or back to the list on the last).
 */
export function RequirementsScreen() {
  const app = useSa();
  const nav = useNavigation();
  const { params } = useRoute<{ module: ParametersModule; parameterIndex: number }>();
  const { width } = useWindowDimensions();
  const data = moduleData(app, params.module);
  const parameter = data?.parameters[params.parameterIndex] ?? null;
  const list = useRef<FlatList<RequirementDetails>>(null);
  const [index, setIndex] = useState(0);
  const size = parameter?.requirements?.length ?? 0;

  const goTo = (i: number) => {
    list.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  };

  const onBackClicked = () => (index > 0 ? goTo(index - 1) : nav.pop());
  useBackHandler(() => {
    nav.pop();
    return true;
  });

  const onViewable = useRef(({ viewableItems }: { viewableItems: Array<{ index?: number | null }> }) => {
    const first = viewableItems[0];
    if (first?.index != null) setIndex(first.index);
  }).current;

  if (!data || !parameter) return null;

  /** onRequirementUpdated of the activity */
  const updated = async (i: number) => {
    onRequirementUpdated(parameter, params.module);
    await app.update();
    if (i === size - 1) nav.pop();
    else goTo(i + 1);
  };

  return (
    <Page testID="requirements">
      <HeroHeader title={parameter.parameterName || MODULE_TITLES[params.module]} subtitle={`${MODULE_TITLES[params.module]} · ${app.zedId}`} onBack={() => nav.pop()} />
      <FlatList
        ref={list}
        data={parameter.requirements ?? []}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(r, i) => `${r.id}-${i}`}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item, index: i }) => (
          <View style={{ width, flex: 1 }}>
            <RequirementPage
              module={params.module}
              requirement={item}
              index={i}
              count={size}
              onBack={onBackClicked}
              onUpdated={() => updated(i)}
              onReview={(m: ParametersModule) => nav.push('RequirementReview', { module: params.module, parameterIndex: params.parameterIndex, requirementIndex: i, review: m })}
            />
          </View>
        )}
      />
    </Page>
  );
}

/** The read-only page of a requirement for the progress review's VIEW buttons (footer hidden). */
export function RequirementReviewScreen() {
  const app = useSa();
  const nav = useNavigation();
  const { params } = useRoute<{ module: ParametersModule; parameterIndex: number; requirementIndex: number; review: ParametersModule }>();
  const parameter = moduleData(app, params.module)?.parameters[params.parameterIndex];
  const requirement = parameter?.requirements?.[params.requirementIndex];
  if (!requirement) return null;
  return (
    <Page testID="requirement-review">
      <HeroHeader title={MODULE_TITLES[params.review]} subtitle={app.zedId} onBack={() => nav.pop()} />
      <RequirementPage
        module={params.review}
        requirement={requirement}
        index={params.requirementIndex}
        count={parameter?.requirements?.length ?? 0}
        readOnly
        onBack={() => nav.pop()}
        onUpdated={() => undefined}
        onReview={() => undefined}
      />
    </Page>
  );
}

const ANSWER_TONES: Record<string, { fg: string; bg: string }> = {
  [YES]: { fg: C.success, bg: C.successBg },
  [PARTIAL]: { fg: C.warning, bg: C.warningBg },
  [NO]: { fg: C.danger, bg: C.dangerBg },
};

/** Yes / Partial / No: the design's radio cards, three in a row (green / amber / red when chosen). */
function AnswerChoice({ value, onChange, disabled, error, testIDPrefix }: { value: string | null; onChange: (v: string) => void; disabled?: boolean; error?: boolean; testIDPrefix: string }) {
  return (
    <View style={[styles.answers, error && styles.answersError]} testID={`${testIDPrefix}-box`}>
      {CONFORMANCE_OPTIONS.map(v => {
        const on = value === v;
        const tone = ANSWER_TONES[v]!;
        return (
          <Pressable
            key={v}
            style={[styles.answer, on && { borderColor: tone.fg, backgroundColor: tone.bg }, on && styles.answerOn, disabled && !on && styles.answerOff]}
            onPress={disabled ? undefined : () => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!disabled }}
            testID={`${testIDPrefix}-${v.toLowerCase()}`}
          >
            <View style={[styles.radio, { borderColor: on ? tone.fg : C.border }]}>{on ? <View style={[styles.radioDot, { backgroundColor: tone.fg }]} /> : null}</View>
            <Text style={[styles.answerText, on && { color: tone.fg }, on && styles.answerTextOn]}>{v}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * MultiplePointsInputHelper in the design's look: each point a card with a bullet (edit and delete when editable) and
 * "+ Add another …", which opens the same comment dialog. `error` marks the list when a required one is empty.
 */
function PointsList({
  label,
  addLabel,
  value,
  onChange,
  readOnly,
  error,
  testID,
}: {
  label: string;
  addLabel: string;
  value: string[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
  error?: string | null;
  testID: string;
}) {
  const ui = useUi();
  return (
    <View testID={testID}>
      <SectionLabel label={label} style={styles.label} right={error ? <Badge label={error} tone="danger" small /> : undefined} />
      {value.map((point, i) => (
        <View key={`${i}-${point}`} style={styles.point}>
          <View style={styles.bulletDot} />
          <Text style={styles.pointText} testID={`${testID}-${i}`}>
            {point}
          </Text>
          {!readOnly ? (
            <>
              <Pressable
                style={styles.pointIcon}
                hitSlop={6}
                onPress={async () => {
                  const t = await promptComment(ui, point);
                  if (t != null) onChange(value.map((p, j) => (j === i ? t : p)));
                }}
                accessibilityLabel="Edit"
                testID={`${testID}-${i}-edit`}>
                <ZIcon name="edit" size={18} color={C.primaryDark} />
              </Pressable>
              <Pressable style={styles.pointIcon} hitSlop={6} onPress={() => onChange(value.filter((_, j) => j !== i))} accessibilityLabel="Delete" testID={`${testID}-${i}-delete`}>
                <ZIcon name="close" size={18} color={C.danger} />
              </Pressable>
            </>
          ) : null}
        </View>
      ))}
      {readOnly && value.length === 0 ? <Text style={styles.none}>None</Text> : null}
      {!readOnly ? (
        <Pressable
          style={({ pressed }) => [styles.addPoint, error ? styles.addPointError : null, pressed && { opacity: 0.85 }]}
          onPress={async () => {
            const t = await promptComment(ui, null);
            if (t != null) onChange([...value, t]);
          }}
          accessibilityRole="button"
          testID={`${testID}-add`}>
          <ZIcon name="plus" size={16} color={C.primaryDark} />
          <Text style={styles.addPointText}>{value.length ? `Add another ${addLabel}` : `Add ${addLabel}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const BULLET = '• ';
/** The remark's points: one "• point" line each. */
const bulletsOf = (text: string) =>
  text
    .split('\n')
    .map(l => l.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(l => l !== '');
const bulletText = (points: readonly string[]) => points.map(p => BULLET + p.trim()).join('\n');

/** "Remarks, if any" as bullet points ("• point" lines; 500 characters in all, as the comment box allowed). */
function RemarksBullets({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  const ui = useUi();
  const [point, setPoint] = useState('');
  const points = bulletsOf(value);
  const add = () => {
    const t = point.trim();
    if (!t) return;
    const next = bulletText([...points, t]);
    if (next.length > COMMENT_LENGTH) return ui.toast(`Remarks can be up to ${COMMENT_LENGTH} characters`);
    onChange(next);
    setPoint('');
  };
  return (
    <View testID="req-remarks-box">
      <SectionLabel label="Remarks, if any" style={styles.label} right={!readOnly ? <CharCounter used={value.length} limit={COMMENT_LENGTH} /> : undefined} />
      {points.map((t, i) => (
        <View key={`${i}-${t}`} style={styles.point} testID={`req-remarks-${i}`}>
          <View style={styles.bulletDot} />
          <Text style={styles.pointText}>{t}</Text>
          {!readOnly ? (
            <Pressable style={styles.pointIcon} hitSlop={6} onPress={() => onChange(bulletText(points.filter((_, j) => j !== i)))} accessibilityLabel="Remove" testID={`req-remarks-${i}-remove`}>
              <ZIcon name="close" size={18} color={C.danger} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {readOnly && points.length === 0 ? <Text style={styles.none}>None</Text> : null}
      {!readOnly ? (
        <View style={styles.remarkAdd}>
          <TextInput
            value={point}
            onChangeText={setPoint}
            placeholder={points.length ? 'Add another remark' : 'Add a remark'}
            placeholderTextColor={C.tMuted}
            style={styles.remarkInput}
            maxLength={COMMENT_LENGTH}
            autoCapitalize="sentences"
            onSubmitEditing={add}
            blurOnSubmit={false}
            returnKeyType="done"
            testID="req-remarks"
          />
          <ZButton title="Add" small variant="outline" onPress={add} testID="req-remarks-add" />
        </View>
      ) : null}
    </View>
  );
}

/** RequirementFragment: the requirement's options, the section's fields, and BACK / REVIEW / PROCEED. */
function RequirementPage({
  module,
  requirement: r,
  index,
  count,
  readOnly = false,
  onBack,
  onUpdated,
  onReview,
}: {
  module: ParametersModule;
  requirement: RequirementDetails;
  index: number;
  count: number;
  readOnly?: boolean;
  onBack: () => void;
  onUpdated: () => void;
  onReview: (m: ParametersModule) => void;
}) {
  const app = useSa();
  const ui = useUi();
  const capturer = useSaPhotoCapture();
  const m4 = isFourthMilestone(app.details!);
  const [conformance, setConformance] = useState<string | null>(r.conformance ?? null);
  const [proposed, setProposed] = useState<string | null>(r.isProposedActivityCompleted ?? null);
  const [gaps, setGaps] = useState<string[]>(r.gapsIdentified ?? []);
  const [planned, setPlanned] = useState<string[]>(r.plannedActivities ?? []);
  const [estimated, setEstimated] = useState(r.estimatedTimeInDays ?? '');
  const [suggested, setSuggested] = useState<string[]>(r.suggestedTechnologyIntervention ?? []);
  const [rationale, setRationale] = useState(r.technologyInterventionRationale ?? '');
  const [remarks, setRemarks] = useState(r.comments ?? '');
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const evidences = usePresentPhotos(r.capturedEvidences, app.photos, kept => {
    r.capturedEvidences = kept;
    app.update();
  });
  const [photos, setPhotos] = useState<ConsultantPhoto[] | null>(null);
  useEffect(() => {
    if (evidences) setPhotos(evidences as ConsultantPhoto[]);
  }, [evidences]);
  const setEvidence = (list: PhotoData[]) => {
    setPhotos(list as ConsultantPhoto[]);
    r.capturedEvidences = list as ConsultantPhoto[];
  };

  const blank = (s: string | null | undefined) => s == null || s.trim() === '';
  const orNull = (s: string) => (blank(s) ? null : s);
  const listOrNull = (l: string[]) => (l.length === 0 ? null : l);

  /** collectEnteredData; the helpers marked the required fields left empty. */
  const collect = () => {
    const e = new Set<string>();
    if (module === 'baselineDiagnostic') {
      r.conformance = conformance;
      r.gapsIdentified = listOrNull(gaps);
      r.comments = orNull(remarks);
      if (blank(conformance)) e.add('conformance');
    } else if (module === 'handholdingActionPlan') {
      r.plannedActivities = listOrNull(planned);
      r.estimatedTimeInDays = orNull(estimated);
      r.comments = orNull(remarks);
      if (planned.length === 0) e.add('planned');
      if (blank(estimated)) e.add('estimated');
    } else if (module === 'technologyIntervention') {
      r.suggestedTechnologyIntervention = listOrNull(suggested);
      r.technologyInterventionRationale = orNull(rationale);
      r.comments = orNull(remarks);
      if (suggested.length === 0) e.add('suggested');
      if (blank(rationale)) e.add('rationale');
    } else {
      r.isProposedActivityCompleted = proposed;
      r.comments = orNull(remarks);
      if (blank(proposed)) e.add('proposed');
    }
    setErrors(e);
  };

  const proceed = () => {
    if (module === 'progressReview' && m4) return onUpdated();
    collect();
    if (module === 'baselineDiagnostic') {
      if (!isBaselineDiagnosticInfoValid(r)) return ui.snackbar(DATA_ERROR);
      r.reviewNeeded = false;
      return onUpdated();
    }
    const valid = module === 'handholdingActionPlan' ? isHandholdingActionPlanValid(r) : module === 'technologyIntervention' ? isSuggestionForTechnologyInterventionValid(r) : isProgressReviewValid(r);
    if (!valid) return;
    onUpdated();
  };

  const review = () => {
    collect();
    r.reviewNeeded = true;
    onUpdated();
  };

  const err = (k: string) => (errors.has(k) ? REQUIRED : null);
  const showEvidence = !readOnly && (module === 'baselineDiagnostic' || (module === 'progressReview' && !m4));
  const reviewRows: ParametersModule[] = module === 'progressReview' ? (m4 ? ['technologyIntervention'] : ['baselineDiagnostic', 'handholdingActionPlan', 'technologyIntervention']) : [];
  const viewOnly = module === 'progressReview' && m4;
  const last = index === count - 1;
  const evidence = showEvidence && photos ? (
    <>
      <SectionLabel label={`Evidence (${photos.length} of 5)`} style={styles.label} />
      <Card style={styles.evidence}>
        <PhotosField label="Add Evidence" photos={photos} onChange={setEvidence} capturer={capturer} store={app.photos} maxPhotos={5} testID="req-evidence" />
      </Card>
      <Text style={styles.note}>{'At least 1 photograph is needed for “Yes” and “Partial”; maximum 5 allowed.'}</Text>
    </>
  ) : null;

  return (
    <View style={styles.flex}>
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        <Card testID="req-card">
          <View style={z.rowBetween}>
            <View style={styles.reqHead}>
              <Text style={[styles.reqLabel, styles.reqLabelText]}>{`Requirement ${index + 1}`}</Text>
              {/* 2026-11-08: the Admin's video for the requirement. */}
              <RequirementVideoButton url={r.videoUrl} code={r.code ?? String(index + 1)} />
            </View>
            {count > 0 ? <Text style={z.muted} testID="req-count">{`${index + 1} of ${count}`}</Text> : null}
          </View>
          {(r.options ?? []).map((o, i) =>
            o && o.label?.trim() ? (
              <View key={`${o.code}-${i}`}>
                <View style={styles.optionRow}>
                  <View style={styles.optionDot} />
                  <Text style={styles.optionText}>{o.label}</Text>
                </View>
                {(o.subOptions ?? []).map((s, j) =>
                  s?.label?.trim() ? (
                    <View key={`${s.code}-${j}`} style={[styles.optionRow, styles.subOption]}>
                      <View style={[styles.optionDot, styles.subDot]} />
                      <Text style={styles.subText}>{s.label}</Text>
                    </View>
                  ) : null,
                )}
              </View>
            ) : null,
          )}
          {r.reviewNeeded ? (
            <View style={styles.reviewFlag}>
              <Badge label="Review Needed" tone="warning" small />
            </View>
          ) : null}
        </Card>
        {reviewRows.length > 0 ? <SectionLabel label="Earlier sections" style={styles.label} /> : null}
        {reviewRows.map(m => (
          <ReviewRow key={m} label={MODULE_TITLES[m]} icon={m === 'baselineDiagnostic' ? 'search' : m === 'handholdingActionPlan' ? 'clipboard' : 'settings'} onView={() => onReview(m)} testID={`review-${m}`} />
        ))}
        {module === 'baselineDiagnostic' ? (
          <>
            <SectionLabel label="Conformance" style={styles.label} right={err('conformance') ? <Badge label={REQUIRED} tone="danger" small /> : undefined} />
            <AnswerChoice value={conformance} onChange={setConformance} error={!!err('conformance')} disabled={readOnly} testIDPrefix="req-conformance" />
            {evidence}
            <PointsList label="Gaps Identified" addLabel="gap" value={gaps} onChange={setGaps} readOnly={readOnly} testID="req-gaps" />
            <RemarksBullets value={remarks} onChange={setRemarks} readOnly={readOnly} />
          </>
        ) : null}
        {module === 'handholdingActionPlan' ? (
          <>
            <PointsList label="Planned Activity(ies)" addLabel="activity" value={planned} onChange={setPlanned} readOnly={readOnly} error={err('planned')} testID="req-planned" />
            <SectionLabel label="Estimated Time (in days)" style={styles.label} />
            <Field
              value={estimated}
              onChangeText={t => setEstimated(numericFilter(t))}
              keyboardType="number-pad"
              maxLength={NUMERIC_MAX_LENGTH}
              icon="calendar"
              right={<Text style={styles.days}>Days</Text>}
              error={err('estimated')}
              editable={!readOnly}
              testID="req-estimated"
            />
            <RemarksBullets value={remarks} onChange={setRemarks} readOnly={readOnly} />
          </>
        ) : null}
        {module === 'technologyIntervention' ? (
          <>
            <PointsList label="Suggested Technology Intervention" addLabel="intervention" value={suggested} onChange={setSuggested} readOnly={readOnly} error={err('suggested')} testID="req-suggested" />
            <SectionLabel label="Rationale for Technology Intervention" style={styles.label} />
            <Field value={rationale} onChangeText={setRationale} error={err('rationale')} editable={!readOnly} testID="req-rationale" />
            <RemarksBullets value={remarks} onChange={setRemarks} readOnly={readOnly} />
          </>
        ) : null}
        {module === 'progressReview' ? (
          <>
            <SectionLabel label="Is proposed activity completed?" style={styles.label} right={err('proposed') ? <Badge label={REQUIRED} tone="danger" small /> : undefined} />
            <AnswerChoice value={proposed} onChange={setProposed} error={!!err('proposed')} disabled={m4} testIDPrefix="req-proposed" />
            {!m4 ? (
              <>
                <RemarksBullets value={remarks} onChange={setRemarks} />
                {evidence}
              </>
            ) : null}
          </>
        ) : null}
      </ZScroll>
      {!readOnly ? (
        <Footer>
          <ZButton title="Previous" variant="outline" onPress={onBack} disabled={index === 0} style={styles.navButton} testID="req-back" />
          {!viewOnly ? <ZButton title="Review" variant="ghost" onPress={review} style={styles.navButton} testID="req-review" /> : null}
          <ZButton title={viewOnly ? 'Next' : last ? 'Save' : 'Save & Next'} onPress={proceed} style={[styles.navButton, styles.saveButton]} testID="req-proceed" />
        </Footer>
      ) : null}
    </View>
  );
}

/** layout_review_item of the progress review: the earlier section and VIEW. */
function ReviewRow({ label, icon, onView, testID }: { label: string; icon: IconName; onView: () => void; testID: string }) {
  return (
    <Card style={styles.reviewRow} testID={testID}>
      <View style={styles.well}>
        <ZIcon name={icon} size={20} color={C.primary} />
      </View>
      <Text style={[styles.flex, styles.reviewLabel]} numberOfLines={2}>
        {label}
      </Text>
      <ZButton title="View" small variant="outline" onPress={onView} testID={`${testID}-view`} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { marginTop: 12 },
  // parameter list (09 / 11 / 12 / 08)
  paramCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  well: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  paramName: { fontSize: 15, fontWeight: '700', color: C.tPrimary },
  paramMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  paramCount: { fontSize: 12, color: C.tSecondary },
  footer: { flexDirection: 'row', gap: 10, backgroundColor: C.surface, borderTopColor: C.border, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  footerButton: { flex: 1, borderRadius: 12 },
  grey: { backgroundColor: C.muted, borderColor: C.muted },
  // requirement (10 / 11e / 12 / 08e)
  reqLabel: { fontSize: 13, fontWeight: '700', color: C.primaryDark },
  reqHead: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: 8 },
  reqLabelText: { flexShrink: 1 },
  optionRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  optionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary, marginTop: 8, marginRight: 10 },
  optionText: { flex: 1, fontSize: 15, color: C.tPrimary, lineHeight: 22 },
  subOption: { marginLeft: 16, marginTop: 6 },
  subDot: { backgroundColor: C.tMuted, width: 5, height: 5 },
  subText: { flex: 1, fontSize: 14, color: C.tSecondary, lineHeight: 20 },
  reviewFlag: { flexDirection: 'row', marginTop: 10 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  reviewLabel: { fontSize: 14, fontWeight: '700', color: C.tPrimary, marginRight: 8 },
  answers: { flexDirection: 'row', gap: 8 },
  answersError: { borderRadius: 12, borderWidth: 1, borderColor: C.danger, padding: 2 },
  answer: { flex: 1, minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  answerOn: { borderWidth: 2 },
  answerOff: { opacity: 0.6 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  answerText: { fontSize: 14, color: C.tPrimary },
  answerTextOn: { fontWeight: '700' },
  point: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingLeft: 14, paddingRight: 8, paddingVertical: 10, marginBottom: 8 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primaryDark, marginRight: 12 },
  pointText: { flex: 1, fontSize: 14, fontWeight: '600', color: C.tPrimary },
  pointIcon: { padding: 6 },
  none: { fontSize: 13, color: C.tMuted, marginBottom: 8 },
  addPoint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: C.primaryBg, backgroundColor: C.primaryBg },
  addPointError: { borderColor: C.danger },
  addPointText: { fontSize: 14, fontWeight: '700', color: C.primaryDark },
  remarkAdd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  remarkInput: { flex: 1, minHeight: 44, borderColor: C.border, borderWidth: 1, borderRadius: 10, backgroundColor: C.surface, paddingHorizontal: 12, fontSize: 14, color: C.tPrimary },
  days: { fontSize: 12, fontWeight: '600', color: C.tSecondary, backgroundColor: C.muted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  evidence: { paddingVertical: 8 },
  note: { fontSize: 11, color: C.tMuted, marginTop: -4, marginBottom: 4 },
  navButton: { flex: 1, paddingHorizontal: 6, borderRadius: 12 },
  saveButton: { flex: 1.3 },
});
