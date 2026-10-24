import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { PhotosField, TextField, useBackHandler, useFocusEffect, useNavigation, useRoute, useUi, type PhotoData } from '@zed/shared';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { icons } from '../assets/icons';
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
import { DropdownInput, MultiplePointsInput, REQUIRED, usePresentPhotos } from '../ui/inputs';
import { BulletText, MenuRow, NavigationFooter, PageTitle, ReviewItem, SaButton, SaFrame, sa } from '../ui/kit';
import { Icon } from '@zed/shared';

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

const CONFORMANCE_OPTIONS = [YES, NO, PARTIAL];

/** ParametersListAdapter: "n Question(s) | status" in its colour, " (Review Needed)" in red while in progress. */
function ParameterRow({ p, onPress, testID }: { p: AllottedParameters; onPress: () => void; testID: string }) {
  const n = p.requirements?.length;
  let status = '0 Question(s)';
  let color: string = sa.bodyTextGrey;
  let review = false;
  if (p.requirements != null) {
    if (p.status === TO_START) {
      status = `${n} Question(s) | To Start`;
      color = sa.coolGrey;
    } else if (p.status === IN_PROGRESS) {
      status = `${n} Question(s) | In Progress`;
      color = sa.squash;
      review = p.requirements.some(r => r.reviewNeeded);
    } else if (p.status === COMPLETED || p.status === SUBMITTED) {
      status = `${n} Question(s) | ${p.status === COMPLETED ? 'Completed' : 'Submitted'}`;
      color = sa.teal;
    }
  }
  return <MenuRow label={`${p.parameterName ?? ''}${review ? ' (Review Needed)' : ''}`} status={status} statusColor={color} onPress={onPress} bordered testID={testID} />;
}

/**
 * BaselineDiagnosticStudyActivity / HandholdingActionPlanActivity / SuggestionForTechnologyInterventionActivity /
 * ProgressReviewActivity with their ParametersFragment: the parameters (the screen's own copy), BACK, and PROCEED to
 * send the completed ones one after the other (their evidences first). All sent: the section is submitted.
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

  return (
    <SaFrame title={MODULE_TITLES[module]} testID="module">
      <PageTitle>PARAMETERS</PageTitle>
      <ScrollView contentContainerStyle={{ padding: 5 }}>
        {data.parameters.map((p, i) => (
          <ParameterRow key={`${p.parameterId}-${i}`} p={p} onPress={() => nav.push('Requirements', { module, parameterIndex: i })} testID={`module-param-${i}`} />
        ))}
      </ScrollView>
      <NavigationFooter onBack={() => nav.pop()} onProceed={sync} testID="module-footer" />
    </SaFrame>
  );
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
    <SaFrame title={MODULE_TITLES.progressReview} testID="pr-selfie">
      <ScrollView contentContainerStyle={{ padding: 8 }}>
        <PhotosField label="Consultant Selfie on Site" photos={selfie ? [selfie] : []} onChange={l => setSelfie(l[0] ?? null)} capturer={capturer} store={app.photos} testID="pr-selfie-photo" />
      </ScrollView>
      <NavigationFooter onBack={back} onProceed={proceed} testID="pr-selfie-footer" />
    </SaFrame>
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
    <SaFrame title={MODULE_TITLES[params.module]} testID="requirements">
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
              onBack={onBackClicked}
              onUpdated={() => updated(i)}
              onReview={(m: ParametersModule) => nav.push('RequirementReview', { module: params.module, parameterIndex: params.parameterIndex, requirementIndex: i, review: m })}
            />
          </View>
        )}
      />
    </SaFrame>
  );
}

/** The read-only page of a requirement for the progress review's VIEW buttons (footer hidden). */
export function RequirementReviewScreen() {
  const app = useSa();
  const nav = useNavigation();
  const { params } = useRoute<{ module: ParametersModule; parameterIndex: number; requirementIndex: number; review: ParametersModule }>();
  const requirement = moduleData(app, params.module)?.parameters[params.parameterIndex]?.requirements?.[params.requirementIndex];
  if (!requirement) return null;
  return (
    <SaFrame title={MODULE_TITLES[params.module]} testID="requirement-review">
      <RequirementPage module={params.review} requirement={requirement} index={params.requirementIndex} readOnly onBack={() => nav.pop()} onUpdated={() => undefined} onReview={() => undefined} />
    </SaFrame>
  );
}

/** RequirementFragment: the requirement's options, the section's fields, and BACK / REVIEW / PROCEED. */
function RequirementPage({
  module,
  requirement: r,
  index,
  readOnly = false,
  onBack,
  onUpdated,
  onReview,
}: {
  module: ParametersModule;
  requirement: RequirementDetails;
  index: number;
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

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 8 }} keyboardShouldPersistTaps="handled">
        <View style={styles.requirementBox}>
          <Text style={styles.requirementLabel}>REQUIREMENT</Text>
          {(r.options ?? []).map((o, i) =>
            o && o.label?.trim() ? (
              <View key={`${o.code}-${i}`}>
                <BulletText text={o.label} />
                {(o.subOptions ?? []).map((s, j) => (s?.label?.trim() ? <BulletText key={`${s.code}-${j}`} text={s.label} indent /> : null))}
              </View>
            ) : null,
          )}
        </View>
        {reviewRows.map(m => (
          <ReviewItem key={m} label={MODULE_TITLES[m]} onView={() => onReview(m)} testID={`review-${m}`} />
        ))}
        {module === 'baselineDiagnostic' ? (
          <>
            <DropdownInput label="Conformance" options={CONFORMANCE_OPTIONS} value={conformance} onChange={setConformance} error={err('conformance')} disabled={readOnly} testID="req-conformance" />
            {showEvidence && photos ? <PhotosField label="Add Evidence" photos={photos} onChange={setEvidence} capturer={capturer} store={app.photos} maxPhotos={5} testID="req-evidence" /> : null}
            <MultiplePointsInput label="Gaps Identified" value={gaps} onChange={setGaps} readOnly={readOnly} testID="req-gaps" />
            <TextField label="Remarks, if any" value={remarks} onChange={setRemarks} multiline disabled={readOnly} testID="req-remarks" />
          </>
        ) : null}
        {module === 'handholdingActionPlan' ? (
          <>
            <MultiplePointsInput label="Planned Activity(ies)" value={planned} onChange={setPlanned} readOnly={readOnly} error={err('planned')} testID="req-planned" />
            <TextField label="Estimated Time (in days)" value={estimated} onChange={setEstimated} numeric error={err('estimated')} disabled={readOnly} testID="req-estimated" />
            <TextField label="Remarks, if any" value={remarks} onChange={setRemarks} multiline disabled={readOnly} testID="req-remarks" />
          </>
        ) : null}
        {module === 'technologyIntervention' ? (
          <>
            <MultiplePointsInput label="Suggested Technology Intervention" value={suggested} onChange={setSuggested} readOnly={readOnly} error={err('suggested')} testID="req-suggested" />
            <TextField label="Rationale for Technology Intervention" value={rationale} onChange={setRationale} error={err('rationale')} disabled={readOnly} testID="req-rationale" />
            <TextField label="Remarks, if any" value={remarks} onChange={setRemarks} multiline disabled={readOnly} testID="req-remarks" />
          </>
        ) : null}
        {module === 'progressReview' ? (
          <>
            <DropdownInput label="Is proposed activity completed?" options={CONFORMANCE_OPTIONS} value={proposed} onChange={setProposed} error={err('proposed')} disabled={m4} testID="req-proposed" />
            {!m4 ? (
              <>
                {showEvidence && photos ? <PhotosField label="Add Evidence" photos={photos} onChange={setEvidence} capturer={capturer} store={app.photos} maxPhotos={5} testID="req-evidence" /> : null}
                <TextField label="Remarks, if any" value={remarks} onChange={setRemarks} multiline testID="req-remarks" />
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {!readOnly ? (
        <View style={styles.footer}>
          <SaButton title="Back" onPress={onBack} disabled={index === 0} left={<Icon icon={icons.ic_back_arrow} size={16} />} style={{ margin: 0 }} testID="req-back" />
          {!(module === 'progressReview' && m4) ? <SaButton title="Review" onPress={review} style={{ margin: 0 }} testID="req-review" /> : <View style={{ width: 80 }} />}
          <SaButton title="Proceed" onPress={proceed} style={{ margin: 0 }} testID="req-proceed" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  requirementBox: { backgroundColor: sa.paleBlue, borderRadius: 5, padding: 5 },
  requirementLabel: { color: sa.blue, fontWeight: 'bold', fontSize: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: sa.lightGrey, padding: 8 },
});
