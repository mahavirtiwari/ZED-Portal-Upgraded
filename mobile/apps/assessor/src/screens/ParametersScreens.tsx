import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useBackHandler, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { isAttendanceTakenToday, isLoggedOutToday } from '../attendance';
import { bulletsOf, bulletText, checksForRequest, initialChecks, listedOf, listedProblem, MAX_EVIDENCE_PHOTOS, type EvidenceCheck } from '../listedEvidence';
import {
  areAllParametersCompletedOrSubmitted,
  COMPLETED,
  EVIDENCE_ADDED,
  IN_PROGRESS,
  MANDATORY,
  NO,
  SUBMITTED,
  YES,
  isCompletedOrSubmitted,
  type AllottedParameters,
  type CheckpointAnswer,
  type ListedEvidence,
  type PhotoInformation,
  type RequirementDetails,
} from '../models';
import { Badge, C, Card, CharCounter, ConformanceChoice, EmptyState, Field, HeroHeader, Page, ProgressBar, SectionLabel, Strip, z, ZButton, ZIcon, ZScroll, type Tone } from '../ui/zed';
import {
  ANSWERS,
  PARTIAL,
  checkpointOptions,
  checkpointProblem,
  conformanceOf,
  hasCheckpoints,
  initialAnswers,
  setAnswer,
  setRemarks,
  toggleAction,
} from '../checkpoints';

const NEXT_BUTTON = 1;
const PREVIOUS_BUTTON = 2;
const BACK_BUTTON = 3;
const REVIEW_BUTTON = 4;

/** The design's per-requirement outcome: Yes, No (an NC), flagged for review, or not assessed yet. */
type ReqStatus = 'yes' | 'no' | 'review' | 'pending';
const STATUS: Record<ReqStatus, { label: string; tone: Tone }> = {
  yes: { label: 'Yes', tone: 'success' },
  no: { label: 'No · NC', tone: 'danger' },
  review: { label: 'Review', tone: 'warning' },
  pending: { label: 'Pending', tone: 'neutral' },
};

const statusOf = (q: RequirementDetails): ReqStatus => (q.reviewNeeded ? 'review' : q.conformance === YES ? 'yes' : q.conformance === NO ? 'no' : 'pending');
const isAssessed = (q: RequirementDetails) => statusOf(q) === 'yes' || statusOf(q) === 'no';
const requirementsOf = (p: AllottedParameters | null | undefined) => (p?.requirements ?? []).filter(Boolean);

/** ParametersPagerActivity: two pages (both of type 1, as the legacy adapter built them) listing the parameters. */
export function ParametersPagerScreen() {
  const app = useSa();
  const nav = useNavigation();
  const width = Dimensions.get('window').width;
  return (
    <Page testID="parameters-pager">
      <HeroHeader title="Assessment checklist" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
        {[0, 1].map(page => (
          <View key={page} style={{ width }}>
            <ParametersPage app={app} page={page} />
          </View>
        ))}
      </ZScroll>
    </Page>
  );
}

function ParametersPage({ app, page }: { app: ReturnType<typeof useSa>; page: number }) {
  const ui = useUi();
  const nav = useNavigation();
  const d = app.details;
  const all = d?.allottedParameters ?? [];
  // After a parameter is edited the legacy fragment kept only the "Mandatory" parameters (TYPE was always 1).
  const [filtered, setFiltered] = useState(false);
  const params = (filtered ? all.filter(p => p?.parameterType === MANDATORY) : all).filter(Boolean);
  // Parameters with something assessed start open; with nothing assessed anywhere the first one does.
  const [open, setOpen] = useState<Set<number>>(() => {
    const touched = all.map((p, i) => (requirementsOf(p).some(q => statusOf(q) !== 'pending') ? i : -1)).filter(i => i >= 0);
    return new Set(touched.length > 0 ? touched : [all.findIndex(Boolean)]);
  });
  const requirements = all.flatMap(p => requirementsOf(p));
  const assessed = requirements.filter(isAssessed).length;
  const ncs = requirements.filter(q => statusOf(q) === 'no').length;
  const canSubmit = !!d && all.length > 0 && areAllParametersCompletedOrSubmitted(d);

  const showQuestions = (p: AllottedParameters) =>
    nav.push('QuestionsPager', {
      parameterId: p.parameterId,
      parameterName: p.parameterName,
      onResult: () => {
        app.update();
        setFiltered(true);
      },
    });

  const onTap = (p: AllottedParameters) => {
    if (p.status === SUBMITTED) {
      ui.alert(
        'Alert',
        'This parameter is already submitted, are you sure you want to make changes?',
        [
          { text: 'Yes', style: 'cancel', onPress: () => showQuestions(p) },
          { text: 'No' },
        ],
        true,
      );
    } else {
      showQuestions(p);
    }
  };

  /** Submit: on to the sync of the assessment, behind the same attendance check as the assessment's steps. */
  const submit = () => {
    if (!isAttendanceTakenToday(d?.attendanceData)) return ui.snackbar('Please log the attendance today to proceed');
    if (isLoggedOutToday(d?.attendanceData)) return ui.snackbar("You've already punched out for the day");
    nav.push('SubmitParameters');
  };

  const toggle = (i: number) =>
    setOpen(s => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  if (params.length === 0) {
    return <EmptyState icon="clipboard" headline="No parameters" lines={['No parameters are allotted to you for this assessment.']} testID={`no-params-${page}`} />;
  }
  return (
    <ZScroll contentContainerStyle={styles.pageContent}>
      <View style={styles.progressPanel}>
        <ProgressBar value={requirements.length ? assessed / requirements.length : 0} />
        <Text style={styles.progressText} testID={`progress-${page}`}>
          {`${assessed} of ${requirements.length} requirements assessed` + (ncs > 0 ? ` · ${ncs} NC raised` : '')}
        </Text>
      </View>
      <View style={styles.list}>
        {params.map((p, index) => {
          const at = all.indexOf(p);
          return <ParameterGroup key={`${p.parameterId}-${at}`} p={p} expanded={open.has(at)} onToggle={() => toggle(at)} onOpen={() => onTap(p)} testID={`param-${page}-${index}`} />;
        })}
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: C.success }]} />
          <Text style={styles.legendText}>Yes = conformant</Text>
          <View style={[styles.legendDot, styles.legendGap, { backgroundColor: C.danger }]} />
          <Text style={styles.legendText}>Partial / No = non-conformance (NC)</Text>
        </View>
        <ZButton title="Submit" disabled={!canSubmit} onPress={submit} style={styles.submit} testID={`submit-checklist-${page}`} />
        {!canSubmit ? <Text style={styles.hint}>Assess every requirement before submitting.</Text> : null}
      </View>
    </ZScroll>
  );
}

/** A parameter: "n/m assessed" header (green with a tick once completed) and, when open, its requirements. */
function ParameterGroup({ p, expanded, onToggle, onOpen, testID }: { p: AllottedParameters; expanded: boolean; onToggle: () => void; onOpen: () => void; testID: string }) {
  const reqs = requirementsOf(p);
  const complete = isCompletedOrSubmitted(p);
  return (
    <View>
      <View style={[styles.group, complete && styles.groupDone]}>
        <Pressable style={styles.flex} onPress={onOpen} testID={testID}>
          <Text style={[styles.groupCount, complete && { color: C.success }]} testID={`${testID}-status`}>
            {`${reqs.filter(isAssessed).length}/${reqs.length} assessed` + (p.status === SUBMITTED ? ' · Submitted' : '')}
          </Text>
          <Text style={styles.groupTitle} numberOfLines={1}>
            {p.parameterName}
          </Text>
        </Pressable>
        {complete ? <ZIcon name="check" size={20} color={C.success} /> : null}
        <Pressable onPress={onToggle} hitSlop={12} style={styles.chevron} testID={`${testID}-expand`} accessibilityLabel={expanded ? 'Collapse' : 'Expand'}>
          <ZIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={20} color={C.tMuted} />
        </Pressable>
      </View>
      {expanded
        ? reqs.map((q, j) => {
            const st = STATUS[statusOf(q)];
            const title = q.questionDescription?.trim() || (q.options ?? []).find(o => o?.label?.trim())?.label || `Requirement ${j + 1}`;
            return (
              <Pressable key={`${q.id}-${j}`} style={styles.reqRow} onPress={onOpen} testID={`${testID}-req-${j}`}>
                <View style={styles.flex}>
                  <Text style={styles.clause}>{`${p.parameterCode ? p.parameterCode + '.' : ''}${j + 1}`}</Text>
                  <Text style={styles.reqTitle} numberOfLines={1}>
                    {title}
                  </Text>
                </View>
                <Badge label={st.label} tone={st.tone} small testID={`${testID}-req-${j}-status`} />
                <ZIcon name="chevron-right" size={18} color={C.tMuted} />
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

type Draft = { conformance: string | null; comment: string; added: PhotoInformation[]; answers: CheckpointAnswer[]; checks: EvidenceCheck[] };

/** QuestionsPagerActivity (not swipeable): one page per requirement of the parameter. */
export function QuestionsPagerScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ parameterId?: string; parameterName?: string; onResult?: () => void }>();
  const parameter = useMemo(() => (app.details?.allottedParameters ?? []).find(p => p?.parameterId != null && p.parameterId === params.parameterId) ?? null, [app.details, params.parameterId]);
  const questions = parameter?.requirements ?? [];
  const [active, setActive] = useState(0);
  const drafts = useRef(new Map<string, Draft>()).current;

  useBackHandler(() => {
    if (active > 0) setActive(active - 1);
    return true; // on the first page the back button did nothing
  });

  if (!parameter || questions.length === 0) {
    return (
      <Page>
        <HeroHeader title={params.parameterName ?? ''} subtitle={app.zedId} onBack={() => nav.pop()} />
      </Page>
    );
  }

  const finishWithResult = () => {
    params.onResult?.();
    nav.pop();
  };

  /** onClick(buttonType, details, isCompleted) */
  const onClick = (type: number, details: RequirementDetails, completed: boolean) => {
    const i = questions.findIndex(q => q.id.toLowerCase() === details.id.toLowerCase());
    if (i >= 0) questions[i] = details;
    else ui.toast('Failed to save Question Details');
    if (completed) {
      const reviewNeeded = parameter.requirements!.some(q => q.reviewNeeded);
      if (type === REVIEW_BUTTON || reviewNeeded) parameter.status = IN_PROGRESS;
      else if (type === NEXT_BUTTON) parameter.status = COMPLETED;
      app.update();
      finishWithResult();
      return;
    }
    parameter.status = IN_PROGRESS;
    app.update();
    if (type === BACK_BUTTON) {
      finishWithResult();
      return;
    }
    if ((type === NEXT_BUTTON || type === REVIEW_BUTTON) && active < questions.length) setActive(Math.min(active + 1, questions.length - 1));
    else if (active > 0) setActive(active - 1);
  };

  const q = questions[active]!;
  return (
    <Page testID="questions-pager">
      <QuestionView
        key={q.id}
        question={q}
        parameterName={params.parameterName ?? ''}
        parameterCode={parameter.parameterCode ?? null}
        position={active}
        count={questions.length}
        draft={drafts.get(q.id)}
        saveDraft={d => drafts.set(q.id, d)}
        onClick={onClick}
        onHome={() => nav.pop()}
      />
    </Page>
  );
}

function QuestionView({
  question,
  parameterName,
  parameterCode,
  position,
  count,
  draft,
  saveDraft,
  onClick,
  onHome,
}: {
  question: RequirementDetails;
  parameterName: string;
  parameterCode: string | null;
  position: number;
  count: number;
  draft?: Draft;
  saveDraft: (d: Draft) => void;
  onClick: (type: number, details: RequirementDetails, completed: boolean) => void;
  onHome: () => void;
}) {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const [conformance, setConformance] = useState<string | null>(draft?.conformance ?? question.conformance ?? null);
  const [comment, setComment] = useState(draft?.comment ?? question.comments ?? '');
  const [added, setAdded] = useState<PhotoInformation[]>(draft?.added ?? []);
  const [loaded, setLoaded] = useState(draft != null);
  const [radioError, setRadioError] = useState(false);
  // V4: a requirement with checkpoints is answered checkpoint by checkpoint; its conformance follows (checkpoints.ts).
  const checkpointMode = hasCheckpoints(question);
  const [answers, setAnswers] = useState<CheckpointAnswer[]>(draft?.answers ?? initialAnswers(question));
  const computed = checkpointMode ? conformanceOf(answers) : null;
  const last = position === count - 1;
  // V4 (redesign): the evidences the Admin lists, each answered and photographed (listedEvidence.ts); else free photos.
  const listed = listedOf(question);
  const listedMode = listed.length > 0;
  const [checks, setChecks] = useState<EvidenceCheck[]>(draft?.checks ?? []);
  const [point, setPoint] = useState('');

  // The added evidences of the question, read from EvidenceData when their photo is not in the parameter.
  useEffect(() => {
    if (loaded) return;
    (async () => {
      const list: PhotoInformation[] = [];
      for (const p of question.addedEvidences ?? []) {
        if (!p) continue;
        const full = !p.photo ? await app.store.evidence(app.userId, p.evidenceId) : p;
        if (full) list.push(full);
      }
      setAdded(list);
      setChecks(initialChecks(question, list));
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveDraft({ conformance, comment, added, answers, checks });
  }, [conformance, comment, added, answers, checks, saveDraft]);

  const evidencesUnopened = () => {
    const unopened = (question.providedEvidences ?? []).some(e => e && (e.evidenceLocalUri ?? '').trim() !== '' && !e.isOpened);
    if (unopened) ui.showAlert('Please open all the Uploaded Evidences to select a option');
    return unopened;
  };

  const pickConformance = (value: string) => {
    if (evidencesUnopened()) {
      setConformance(null);
      return;
    }
    setRadioError(false);
    setConformance(value);
  };

  const pickAnswer = (id: number, value: string) => {
    if (evidencesUnopened()) return;
    setRadioError(false);
    setAnswers(a => setAnswer(a, id, value));
  };

  /** The evidence references kept in the parameter: the photo is left out (read from EvidenceData by id), as the legacy cleared it. */
  const references = () => {
    // With evidences listed by the Admin only their photos are sent (a free photo of an earlier version is left out).
    const kept = listedMode ? added.filter(p => checks.some(c => c.available === 'Yes' && c.photoIds.includes(p.photoId))) : added;
    return kept.map(p => ({ ...p, photo: null }));
  };

  const prepareData = (): RequirementDetails | null => {
    if (checkpointMode) {
      const problem = checkpointProblem(question, answers);
      if (problem) {
        setRadioError(true);
        ui.snackbar(problem);
        return null;
      }
      const decided = conformanceOf(answers)!;
      const listedIssue = listedMode ? listedProblem(question, checks, added, answers, decided) : null;
      if (listedIssue) {
        ui.snackbar(listedIssue);
        return null;
      }
      if (decided === YES && added.length === 0) {
        ui.snackbar('Please add at least one Evidence');
        return null;
      }
      // Comments are optional: when not conforming the server writes the checkpoints' answers as the remarks.
      return {
        ...question,
        conformance: decided,
        comments: comment.trim(),
        checkpointAnswers: answers,
        addedEvidences: references(),
        evidenceChecks: listedMode ? checksForRequest(checks) : question.evidenceChecks,
        reviewNeeded: false,
      };
    }
    if (conformance == null) {
      setRadioError(true);
      ui.snackbar('Please enter required details');
      return null;
    }
    const comments = comment.trim();
    const listedIssue = listedMode ? listedProblem(question, checks, added, [], conformance) : null;
    if (listedIssue) {
      ui.snackbar(listedIssue);
      return null;
    }
    if (conformance === YES && added.length === 0) {
      ui.snackbar('Please add at least one Evidence');
      return null;
    }
    if (conformance === NO && comments === '') {
      ui.snackbar("Comments are mandatory when conformance is 'No'");
      return null;
    }
    return { ...question, conformance, comments, addedEvidences: references(), evidenceChecks: listedMode ? checksForRequest(checks) : question.evidenceChecks, reviewNeeded: false };
  };

  const save = (back: boolean) => {
    const details = prepareData();
    if (!details) return;
    onClick(back ? BACK_BUTTON : NEXT_BUTTON, details, last);
  };

  const review = () => {
    const details: RequirementDetails = { ...question, comments: comment, addedEvidences: references(), reviewNeeded: true };
    if (listedMode) details.evidenceChecks = checksForRequest(checks);
    if (checkpointMode) {
      details.checkpointAnswers = answers;
      if (computed != null) details.conformance = computed;
    } else if (conformance != null) details.conformance = conformance;
    onClick(REVIEW_BUTTON, details, last);
  };

  /** NewEvidence: a new photo ("Capture new") or one picked from the site tour ("From Site Tour"). */
  const openEvidence = (pickEvidence: boolean) =>
    nav.push('NewEvidence', {
      pickEvidence,
      onResult: async (evidenceId: string | null) => {
        if (!evidenceId) return ui.showAlert('Failed to add Evidence');
        const info = await app.store.evidence(app.userId, evidenceId);
        if (!info) return ui.showAlert('Failed to add Evidence');
        setAdded(list => [...list, info]);
      },
    });

  /** Removes a photo of the requirement (and its copy in EvidenceData when it was taken here). */
  const dropPhoto = async (photoId: string | null) => {
    const p = added.find(x => x.photoId === photoId);
    if (!p) return;
    if (p.type === EVIDENCE_ADDED) await app.store.deleteEvidence(app.userId, p.evidenceId);
    setAdded(list => list.filter(x => x !== p));
  };

  /** A photo of a listed evidence (up to 3): taken with its name filled in, or picked from the site tour. */
  const addListedPhoto = async (e: ListedEvidence) => {
    if ((checks.find(c => c.id === e.id)?.photoIds.length ?? 0) >= MAX_EVIDENCE_PHOTOS) return ui.toast(`Up to ${MAX_EVIDENCE_PHOTOS} photos of each evidence`);
    const choice = await ui.pickItem(e.name, ['Capture new', 'Pick from site tour']);
    if (choice == null) return;
    nav.push('NewEvidence', {
      pickEvidence: choice === 1,
      name: e.name,
      onResult: async (evidenceId: string | null) => {
        if (!evidenceId) return ui.showAlert('Failed to add Evidence');
        const info = await app.store.evidence(app.userId, evidenceId);
        if (!info) return ui.showAlert('Failed to add Evidence');
        setAdded(list => [...list, info]);
        setChecks(cs => cs.map(c => (c.id === e.id ? { ...c, available: 'Yes', photoIds: [...c.photoIds, info.photoId].slice(0, MAX_EVIDENCE_PHOTOS) } : c)));
      },
    });
  };

  const removeListedPhoto = (e: ListedEvidence, photoId: string) =>
    ui.alert(null, 'Are you sure, You want to delete the evidence?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes',
        onPress: async () => {
          await dropPhoto(photoId);
          setChecks(cs => cs.map(c => (c.id === e.id ? { ...c, photoIds: c.photoIds.filter(id => id !== photoId) } : c)));
        },
      },
    ]);

  /** Yes / No for a listed evidence: Yes asks for a photo (when it has none), No removes its photos. */
  const answerListed = async (e: ListedEvidence, value: string) => {
    if (evidencesUnopened()) return;
    const c = checks.find(x => x.id === e.id);
    if (value === NO) {
      for (const id of c?.photoIds ?? []) await dropPhoto(id);
      setChecks(cs => cs.map(x => (x.id === e.id ? { ...x, available: 'No', photoIds: [] } : x)));
      return;
    }
    setChecks(cs => cs.map(x => (x.id === e.id ? { ...x, available: 'Yes' } : x)));
    if (!c?.photoIds.length) addListedPhoto(e);
  };

  /** Comments as bullets ("• point" lines, 500 characters in all as before). */
  const points = bulletsOf(comment);
  const addPoint = () => {
    const t = point.trim();
    if (!t) return;
    const next = bulletText([...points, t]);
    if (next.length > 500) return ui.toast('Comments can be up to 500 characters');
    setComment(next);
    setPoint('');
  };
  const removePoint = (i: number) => setComment(bulletText(points.filter((_, j) => j !== i)));

  /** The "+" tile: the legacy choice between the two. */
  const addEvidence = async () => {
    const choice = await ui.pickItem('Add Evidence Options', ['Add New', 'Pick from site tour']);
    if (choice == null) return;
    openEvidence(choice === 1);
  };

  const deleteEvidence = (index: number) => {
    ui.alert(
      null,
      'Are you sure, You want to delete the evidence?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes',
          onPress: async () => {
            const p = added[index]!;
            if (p.type === EVIDENCE_ADDED) {
              if (await app.store.deleteEvidence(app.userId, p.evidenceId)) ui.toast('Evidence deleted successfully');
            } else {
              ui.toast('Evidence deleted successfully');
            }
            setAdded(list => list.filter((_, i) => i !== index));
          },
        },
      ],
      true,
    );
  };

  const text = (label: string, value: string | null | undefined, id: string) =>
    value != null && value.trim() !== '' ? (
      <View key={id} style={styles.earlierRow}>
        <Text style={styles.earlierLabel}>{label}</Text>
        <Text style={styles.earlierValue} testID={`q-${id}`}>
          {value}
        </Text>
      </View>
    ) : null;
  const withId = (id: string | null | undefined, v: string | null | undefined) => (v != null && v.trim() !== '' ? `${id ? id + '. ' : ''}${v}` : null);
  const full = added.length >= 5;
  const options = (question.options ?? []).filter(o => o && (o.label ?? '').trim() !== '');

  return (
    <>
      <HeroHeader
        title={parameterName}
        subtitle={app.zedId}
        onBack={() => save(true)}
        right={
          <Pressable onPress={onHome} hitSlop={10} style={styles.home} testID="home-icon" accessibilityLabel="Home">
            <ZIcon name="home" size={22} color={C.tInverse} />
          </Pressable>
        }
      />
      <ZScroll contentContainerStyle={styles.qContent} keyboardShouldPersistTaps="handled" testID={`question-${position}`}>
        <Card>
          <View style={z.rowBetween}>
            {parameterCode ? <Badge label={`Parameter ${parameterCode}`} tone="primary" /> : <View />}
            <Text style={styles.qCount} testID="q-count">{`${position + 1} of ${count} requirement(s)`}</Text>
          </View>
          {question.questionDescription?.trim() ? <Text style={styles.qText}>{question.questionDescription.trim()}</Text> : null}
          {!checkpointMode
            ? options.map((o, i) => (
                <View key={i} style={styles.optionRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.optionText}>{o.label}</Text>
                </View>
              ))
            : null}
          {question.reviewNeeded || question.moreInfo?.trim() ? (
            <View style={[z.rowBetween, styles.cardFoot]}>
              {question.reviewNeeded ? <Badge label="(Review Needed)" tone="warning" small /> : <View />}
              {question.moreInfo?.trim() ? (
                <Pressable onPress={() => ui.showAlert(question.moreInfo!)} style={styles.moreInfo} testID="q-more-info">
                  <Text style={styles.moreInfoText}>More info</Text>
                  <ZIcon name="info" size={16} color={C.primaryDark} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Card>

        <Card style={styles.earlier}>
          <View style={styles.earlierRow}>
            <Text style={styles.earlierLabel}>Selected Option</Text>
            <Text style={styles.earlierValue}>{question.previousSelectedOption ?? 'No option selected'}</Text>
          </View>
          {text('MSME Option', withId(question.msmeOptionId, question.msmeOption), 'msme-option')}
          {text('MSME Comment', question.msmeComment, 'msme-comment')}
          {text('DA Option', withId(question.daOptionId, question.daOption), 'da-option')}
          {text('DA Status', question.daStatus, 'da-status')}
          {text('DA Comment', question.daComment, 'da-comment')}
        </Card>

        {checkpointMode ? (
          <>
            <CheckpointList
              question={question}
              answers={answers}
              error={radioError}
              onAnswer={pickAnswer}
              onAction={(id, action) => setAnswers(a => toggleAction(a, id, action))}
              onRemarks={(id, value) => setAnswers(a => setRemarks(a, id, value))}
            />
            <SectionLabel label="Conformance" brand right={<Text style={z.muted}>computed from the checkpoints</Text>} />
            <View style={styles.computed} testID="q-computed">
              {computed === YES ? <Badge label="Yes" tone="success" /> : computed === NO ? <Badge label="No · raises an NC" tone="danger" /> : <Badge label="Pending" />}
              <Text style={[z.muted, styles.computedNote]}>Yes only when every checkpoint is Yes.</Text>
            </View>
          </>
        ) : (
          <>
            <SectionLabel label="Conformance" brand right={conformance == null ? <Badge label="Required" tone="danger" small /> : undefined} />
            <View style={radioError && conformance == null ? styles.choiceError : null}>
              <ConformanceChoice value={conformance} onChange={pickConformance} options={[YES, NO]} testIDPrefix="q" />
            </View>
          </>
        )}
        <View style={styles.ncStrip}>
          {/* A Partial checkpoint makes the requirement's conformance No as well (CheckpointAnswers: Yes only when every checkpoint is Yes). */}
          <Strip text={checkpointMode ? 'A “Partial” or “No” checkpoint raises a non-conformance (NC).' : 'Marking “No” raises a non-conformance (NC).'} />
        </View>

        <SectionLabel label="Comments" right={<CharCounter used={comment.length} limit={500} />} />
        <Card style={styles.bullets} testID="q-comments">
          {points.map((t, i) => (
            <View key={`${i}-${t}`} style={styles.bulletRow} testID={`q-point-${i}`}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{t}</Text>
              <Pressable onPress={() => removePoint(i)} hitSlop={8} testID={`q-point-${i}-remove`} accessibilityLabel="Remove">
                <ZIcon name="close" size={14} color={C.tMuted} />
              </Pressable>
            </View>
          ))}
          <View style={styles.bulletAdd}>
            <TextInput
              value={point}
              onChangeText={setPoint}
              placeholder={points.length ? 'Add another observation' : 'Add an observation'}
              placeholderTextColor={C.tMuted}
              style={styles.bulletInput}
              autoCapitalize="sentences"
              onSubmitEditing={addPoint}
              blurOnSubmit={false}
              returnKeyType="done"
              testID="q-comment"
            />
            <ZButton title="Add" small variant="outline" onPress={addPoint} testID="q-comment-add" />
          </View>
        </Card>

        {listedMode ? (
          <ListedEvidenceList
            listed={listed}
            checks={checks}
            photos={added}
            onAnswer={answerListed}
            onAdd={addListedPhoto}
            onRemove={removeListedPhoto}
          />
        ) : (
          <>
          <SectionLabel
            label={`Add evidence · ${added.length} of 5`}
            brand
            right={
              <View style={styles.geo}>
                <ZIcon name="map-pin" size={12} color={C.primaryDark} />
                <Text style={styles.geoText}>Geo-tagged</Text>
              </View>
            }
          />
          <View style={styles.evidenceActions}>
            <ZButton title="Capture new" icon="camera" small disabled={full} onPress={() => openEvidence(false)} style={styles.flex} testID="q-capture-new" />
            <ZButton title="From Site Tour" icon="image" variant="outline" small disabled={full} onPress={() => openEvidence(true)} style={styles.flex} testID="q-from-site-tour" />
          </View>
          <View style={styles.grid}>
            {[0, 1, 2, 3, 4].map(slot => {
              const p = added[slot];
              if (p) {
                return (
                  <View key={`${p.evidenceId}-${slot}`} style={styles.flex} testID={`q-evidence-${slot}`}>
                    <View style={styles.tile}>
                      {p.photo ? (
                        <Image source={{ uri: `data:image/jpeg;base64,${p.photo.replace(/\s/g, '')}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      ) : (
                        <ZIcon name="image" size={20} color={C.primary} />
                      )}
                      <View style={styles.pin}>
                        <ZIcon name="map-pin" size={10} color={C.tInverse} strokeWidth={2.4} />
                      </View>
                      <Pressable style={styles.delete} onPress={() => deleteEvidence(slot)} hitSlop={6} testID={`q-evidence-${slot}-delete`} accessibilityLabel="Delete">
                        <ZIcon name="close" size={10} color={C.tInverse} strokeWidth={2.6} />
                      </Pressable>
                    </View>
                    <Text style={styles.caption} numberOfLines={1}>
                      {p.name ?? ''}
                    </Text>
                  </View>
                );
              }
              if (slot === added.length) {
                return (
                  <View key={`add-${slot}`} style={styles.flex}>
                    <Pressable style={[styles.tile, styles.tileAdd]} onPress={addEvidence} testID="q-add-evidence" accessibilityLabel={added.length === 0 ? 'Take Photo' : 'Add More'}>
                      <ZIcon name="plus" size={18} color={C.primary} />
                    </Pressable>
                  </View>
                );
              }
              return (
                <View key={`empty-${slot}`} style={styles.flex}>
                  <View style={[styles.tile, styles.tileEmpty]}>
                    <ZIcon name="plus" size={14} color={C.tMuted} />
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={styles.note}>A “Yes” needs at least one photograph as evidence.</Text>
          </>
        )}

        <View style={styles.buttons}>
          <ZButton title="Previous" variant="ghost" disabled={position === 0} onPress={() => onClick(PREVIOUS_BUTTON, question, false)} testID="q-previous" style={styles.navButton} />
          <ZButton title="Review" variant="outline" onPress={review} testID="q-review" style={styles.navButton} />
          <ZButton title={last ? 'Save' : 'Save ›'} onPress={() => save(false)} testID="q-save" style={styles.navButton} />
        </View>
        <Text style={[styles.note, styles.centered]}>“Review” flags the requirement for a second look before submit.</Text>
      </ZScroll>
    </>
  );
}

/** V4 (redesign): the evidences the Admin lists for the requirement: Yes (with its photo) or No for each. */
function ListedEvidenceList({
  listed,
  checks,
  photos,
  onAnswer,
  onAdd,
  onRemove,
}: {
  listed: ListedEvidence[];
  checks: EvidenceCheck[];
  photos: PhotoInformation[];
  onAnswer: (e: ListedEvidence, value: string) => void;
  onAdd: (e: ListedEvidence) => void;
  onRemove: (e: ListedEvidence, photoId: string) => void;
}) {
  const done = listed.filter(e => {
    const c = checks.find(x => x.id === e.id);
    return c?.available === 'No' || (c?.available === 'Yes' && c.photoIds.length > 0);
  }).length;
  return (
    <>
      <SectionLabel label={`Required evidence · ${done} of ${listed.length} done`} brand right={<Text style={z.muted}>listed by Admin</Text>} />
      {listed.map(e => {
        const c = checks.find(x => x.id === e.id);
        const mine = (c?.photoIds ?? []).map(id => photos.find(p => p.photoId === id)).filter((p): p is PhotoInformation => !!p);
        const desk = e.verified ? `Desktop: verified ${e.verified}` : e.uploaded ? 'Desktop: uploaded' : 'Desktop: not uploaded';
        return (
          <Card key={e.id} style={styles.listed} testID={`ev-${e.id}`}>
            <View style={z.rowBetween}>
              <Text style={[z.title, styles.flex]}>{e.name}</Text>
              {e.mandatory ? <Badge label="Mandatory" tone="danger" small /> : null}
            </View>
            <Text style={[z.muted, { marginTop: 2 }]}>{`${e.checkpoint ? `Checkpoint ${e.checkpoint} · ` : ''}${desk}`}</Text>
            <Text style={styles.listedAsk}>Available at the site?</Text>
            <ConformanceChoice value={c?.available ?? null} onChange={v => onAnswer(e, v)} options={[YES, NO]} testIDPrefix={`ev-${e.id}`} />
            {c?.available === 'Yes' ? (
              <View style={styles.listedPhotos}>
                {mine.map((p, i) => (
                  <Pressable key={p.photoId} style={styles.listedPhoto} onLongPress={() => onRemove(e, p.photoId)} testID={`ev-${e.id}-photo-${i}`}>
                    {p.photo ? (
                      <Image source={{ uri: `data:image/jpeg;base64,${p.photo.replace(/\s/g, '')}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                      <ZIcon name="image" size={18} color={C.primary} />
                    )}
                    <Pressable style={styles.delete} onPress={() => onRemove(e, p.photoId)} hitSlop={6} testID={`ev-${e.id}-photo-${i}-delete`} accessibilityLabel="Delete">
                      <ZIcon name="close" size={10} color={C.tInverse} strokeWidth={2.6} />
                    </Pressable>
                  </Pressable>
                ))}
                {mine.length < MAX_EVIDENCE_PHOTOS ? (
                  <Pressable style={[styles.listedPhoto, styles.tileAdd]} onPress={() => onAdd(e)} testID={`ev-${e.id}-add`} accessibilityLabel="Add photo">
                    <ZIcon name="camera" size={18} color={C.primary} />
                  </Pressable>
                ) : null}
                <Text style={[z.muted, styles.flex]}>{`${mine.length} of ${MAX_EVIDENCE_PHOTOS} · capture or pick from the site tour`}</Text>
              </View>
            ) : null}
            {c?.available === 'Yes' && mine.length === 0 ? <Text style={styles.listedWarn}>Capture a photo of it, or pick one from the site tour.</Text> : null}
            {c?.available === 'No' ? (
              <Text style={styles.listedNo}>{e.checkpoint ? `Not available: checkpoint ${e.checkpoint} can't be Yes.` : "Not available: the conformance can't be Yes."}</Text>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}

/** V4: the checkpoints of a requirement, each a card answered Yes / Partial / No; Partial / No take the actions needed (or a remark). */
function CheckpointList({
  question,
  answers,
  error,
  onAnswer,
  onAction,
  onRemarks,
}: {
  question: RequirementDetails;
  answers: CheckpointAnswer[];
  error: boolean;
  onAnswer: (id: number, value: string) => void;
  onAction: (id: number, action: string) => void;
  onRemarks: (id: number, value: string) => void;
}) {
  return (
    <View testID="q-checkpoints">
      <SectionLabel label="Checkpoints" brand />
      {checkpointOptions(question).map(o => {
        const c = o.checkpoint!;
        const a = answers.find(x => x.id === o.id);
        const mandatory = c.evidences.filter(e => e.mandatory);
        const evidence =
          mandatory.length === 0
            ? 'Evidence: none mandatory'
            : 'Evidence: ' +
              mandatory.map(e => (e.name ?? '') + (e.uploaded ? (e.verified === NO ? ' (refused)' : ' ✓') : ' (not uploaded)')).join(', ') +
              ' (mandatory)';
        const missing = error && !a?.answer;
        return (
          <Card key={o.id} style={[styles.checkpoint, missing && styles.checkpointError]} testID={'cp-' + o.id}>
            <View style={styles.cpHead}>
              <Text style={styles.cpTitle}>{(o.code ? o.code + '. ' : '') + (o.label ?? '')}</Text>
              {missing ? <Badge label="Required" tone="danger" small /> : null}
            </View>
            <Text style={styles.cpMeta}>{(c.desktopAnswer ? 'DA: ' + c.desktopAnswer + ' · ' : '') + evidence}</Text>
            <AnswerChoice value={a?.answer ?? null} onChange={v => onAnswer(o.id, v)} testIDPrefix={'cp-' + o.id} />
            {a?.answer && a.answer !== YES ? (
              c.actions.length > 0 ? (
                <View style={styles.cpMore}>
                  <Text style={styles.cpLabel}>ACTIONS NEEDED</Text>
                  {c.actions.map((action, i) => (
                    <TickBox key={i} label={action} checked={a.actions.includes(action)} onChange={() => onAction(o.id, action)} testID={'cp-' + o.id + '-action-' + i} />
                  ))}
                </View>
              ) : (
                <View style={styles.cpMore}>
                  <Text style={styles.cpLabel}>WHAT IS NEEDED</Text>
                  <Field value={a.remarks ?? ''} onChangeText={t => onRemarks(o.id, t)} multiline maxLength={1000} style={styles.cpRemarks} testID={'cp-' + o.id + '-remarks'} />
                </View>
              )
            ) : null}
          </Card>
        );
      })}
      <Text style={styles.cpNote}>Yes on a checkpoint needs its mandatory evidence uploaded and not refused by the desktop assessor.</Text>
    </View>
  );
}

const ANSWER_TONES: Record<string, { fg: string; bg: string }> = {
  [YES]: { fg: C.success, bg: C.successBg },
  [PARTIAL]: { fg: C.warning, bg: C.warningBg },
  [NO]: { fg: C.danger, bg: C.dangerBg },
};

/** One checkpoint's Yes / Partial / No: the design's conformance radio cards, three narrower ones in a row. */
function AnswerChoice({ value, onChange, testIDPrefix }: { value: string | null; onChange: (v: string) => void; testIDPrefix: string }) {
  return (
    <View style={styles.answers}>
      {ANSWERS.map(v => {
        const on = value === v;
        const tone = ANSWER_TONES[v]!;
        return (
          <Pressable
            key={v}
            style={[styles.answer, on && { borderColor: tone.fg, backgroundColor: tone.bg }, on && styles.answerOn]}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
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

/** A tick box with an optional label (rounded square, green when ticked); also used by the sync screen. */
export function TickBox({ label, checked, onChange, testID }: { label?: string; checked: boolean; onChange: (checked: boolean) => void; testID?: string }) {
  return (
    <Pressable style={styles.tickRow} onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} hitSlop={6} testID={testID}>
      <View style={[styles.tick, checked && styles.tickOn]}>{checked ? <ZIcon name="check" size={14} color={C.tInverse} strokeWidth={2.6} /> : null}</View>
      {label ? <Text style={styles.tickLabel}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { textAlign: 'center', marginTop: 12 },
  // checklist (09)
  pageContent: { paddingBottom: 32 },
  progressPanel: { backgroundColor: C.surface, borderBottomColor: C.border, borderBottomWidth: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 },
  progressText: { fontSize: 12, color: C.tMuted, marginTop: 10 },
  list: { paddingHorizontal: 20, paddingTop: 16 },
  group: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.muted, borderRadius: 10, borderWidth: 1, borderColor: C.muted, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  groupDone: { backgroundColor: C.successBg, borderColor: C.success },
  groupCount: { fontSize: 11, fontWeight: '600', color: C.tMuted },
  groupTitle: { fontSize: 14, fontWeight: '700', color: C.tPrimary, marginTop: 2 },
  chevron: { marginLeft: 8 },
  reqRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingLeft: 12, paddingRight: 8, paddingVertical: 10, marginBottom: 6 },
  clause: { fontSize: 11, fontWeight: '600', color: C.tMuted, letterSpacing: 0.5 },
  reqTitle: { fontSize: 13, color: C.tPrimary, marginTop: 3, marginRight: 8 },
  legend: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10, marginBottom: 12 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendGap: { marginLeft: 16 },
  legendText: { fontSize: 10, color: C.tSecondary },
  submit: { minHeight: 52, borderRadius: 12 },
  hint: { fontSize: 10, color: C.tMuted, textAlign: 'center', marginTop: 8 },
  // checklist item (10)
  home: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.heroOverlay, alignItems: 'center', justifyContent: 'center' },
  qContent: { padding: 16, paddingBottom: 32 },
  qCount: { fontSize: 12, fontWeight: '600', color: C.tMuted },
  qText: { fontSize: 14, color: C.tPrimary, marginTop: 12, lineHeight: 20 },
  optionRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary, marginTop: 7, marginRight: 10 },
  optionText: { flex: 1, fontSize: 14, color: C.tPrimary, lineHeight: 20 },
  cardFoot: { marginTop: 10 },
  moreInfo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  moreInfoText: { fontSize: 12, fontWeight: '700', color: C.primaryDark },
  earlier: { paddingVertical: 6 },
  earlierRow: { paddingVertical: 6, borderBottomColor: C.divider, borderBottomWidth: 1 },
  earlierLabel: { fontSize: 11, fontWeight: '600', color: C.tSecondary, letterSpacing: 0.3 },
  earlierValue: { fontSize: 14, color: C.tPrimary, marginTop: 2 },
  computed: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12 },
  computedNote: { marginLeft: 10, flex: 1 },
  choiceError: { borderRadius: 12, borderWidth: 1, borderColor: C.danger, padding: 2 },
  ncStrip: { marginTop: 12 },
  geo: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primaryBg, borderRadius: 9, height: 18, paddingHorizontal: 8, gap: 4 },
  geoText: { fontSize: 10, fontWeight: '700', color: C.primaryDark },
  evidenceActions: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  grid: { flexDirection: 'row', gap: 6 },
  tile: { aspectRatio: 1, borderRadius: 8, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileAdd: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.primary },
  bullets: { paddingVertical: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, gap: 8 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 14, color: C.tPrimary },
  bulletAdd: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  bulletInput: { flex: 1, minHeight: 40, borderColor: C.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, fontSize: 14, color: C.tPrimary },
  listed: { marginBottom: 10 },
  listedAsk: { fontSize: 12, fontWeight: '600', color: C.tSecondary, marginTop: 10, marginBottom: 6 },
  listedPhotos: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  listedPhoto: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: C.muted },
  listedWarn: { fontSize: 12, color: C.warning, marginTop: 6 },
  listedNo: { fontSize: 12, color: C.danger, marginTop: 6 },
  tileEmpty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  pin: { position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  delete: { position: 'absolute', bottom: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: C.danger, borderWidth: 2, borderColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  caption: { fontSize: 9, color: C.tSecondary, textAlign: 'center', marginTop: 4 },
  note: { fontSize: 10, color: C.tMuted, marginTop: 12 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 14 },
  navButton: { flex: 1, paddingHorizontal: 6 },
  // checkpoints
  checkpoint: { borderWidth: 1, borderColor: C.border },
  checkpointError: { borderColor: C.danger },
  cpHead: { flexDirection: 'row', alignItems: 'flex-start' },
  cpTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: C.tPrimary, marginRight: 8 },
  cpMeta: { fontSize: 12, color: C.tSecondary, marginTop: 4 },
  cpMore: { marginTop: 10 },
  cpLabel: { fontSize: 11, fontWeight: '600', color: C.tSecondary, letterSpacing: 0.5, marginBottom: 4 },
  cpRemarks: { marginBottom: 0 },
  cpNote: { fontSize: 11, color: C.tMuted, marginBottom: 8 },
  answers: { flexDirection: 'row', gap: 8, marginTop: 10 },
  answer: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  answerOn: { borderWidth: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  answerText: { fontSize: 14, color: C.tPrimary },
  answerTextOn: { fontWeight: '700' },
  tickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  tick: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: C.success, borderColor: C.success },
  tickLabel: { flex: 1, fontSize: 14, color: C.tPrimary, marginLeft: 10 },
});
