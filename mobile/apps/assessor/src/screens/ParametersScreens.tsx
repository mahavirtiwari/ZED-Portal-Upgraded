import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, OutlinedInput, RadioButton, useBackHandler, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import {
  COMPLETED,
  EVIDENCE_ADDED,
  IN_PROGRESS,
  MANDATORY,
  NO,
  SUBMITTED,
  TO_START,
  YES,
  isCompletedOrSubmitted,
  type AllottedParameters,
  type PhotoInformation,
  type RequirementDetails,
} from '../models';
import { Divider, SaButton, SaFrame, sa } from '../ui/kit';

const NEXT_BUTTON = 1;
const PREVIOUS_BUTTON = 2;
const BACK_BUTTON = 3;
const REVIEW_BUTTON = 4;

/** ParametersPagerActivity: two pages (both of type 1, as the legacy adapter built them) listing the parameters. */
export function ParametersPagerScreen() {
  const app = useSa();
  const width = Dimensions.get('window').width;
  return (
    <SaFrame testID="parameters-pager">
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
        {[0, 1].map(page => (
          <View key={page} style={{ width }}>
            <ParametersPage app={app} page={page} />
          </View>
        ))}
      </ScrollView>
    </SaFrame>
  );
}

function ParametersPage({ app, page }: { app: ReturnType<typeof useSa>; page: number }) {
  const ui = useUi();
  const nav = useNavigation();
  const all = app.details?.allottedParameters ?? [];
  // After a parameter is edited the legacy fragment kept only the "Mandatory" parameters (TYPE was always 1).
  const [filtered, setFiltered] = useState(false);
  const params = filtered ? all.filter(p => p?.parameterType === MANDATORY) : all;
  const progress = all.filter(p => p && isCompletedOrSubmitted(p)).length;

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

  if (params.length === 0) {
    return <Text style={styles.progressText}>NO PARAMETERS</Text>;
  }
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.progressText} testID={`progress-${page}`}>{`OVERALL PROGRESS (${progress}/${all.length})`}</Text>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { flex: progress }]} />
        <View style={{ flex: Math.max(0, all.length - progress) }} />
      </View>
      <FlatList
        data={params.filter(Boolean)}
        keyExtractor={(p, i) => `${p.parameterId}-${i}`}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item, index }) => <ParameterRow p={item} onPress={() => onTap(item)} testID={`param-${page}-${index}`} />}
      />
    </View>
  );
}

function ParameterRow({ p, onPress, testID }: { p: AllottedParameters; onPress: () => void; testID?: string }) {
  const n = p.requirements?.length;
  let icon = images.ic_tick_coolgrey;
  let status = `${n ?? 0} Question(s)`;
  let color = sa.coolGrey;
  let review = false;
  if (p.requirements) {
    if (p.status === TO_START) {
      status = `${n} Question(s) | To Start`;
    } else if (p.status === IN_PROGRESS) {
      icon = images.ic_tick_squash;
      status = `${n} Question(s) | In Progress`;
      color = sa.squash;
      review = p.requirements.some(q => q.reviewNeeded);
    } else if (p.status === COMPLETED || p.status === SUBMITTED) {
      icon = images.ic_tick_teal;
      status = `${n} Question(s) | Completed`;
      color = sa.teal;
    }
  }
  return (
    <Pressable style={styles.paramRow} onPress={onPress} testID={testID}>
      <Image source={icon} style={styles.statusIcon} />
      <View style={{ flex: 1 }}>
        <Text style={styles.paramName}>
          {p.parameterName}
          {review ? <Text style={{ color: sa.red }}> (Review Needed)</Text> : null}
        </Text>
        <Text style={[styles.paramStatus, { color }]} testID={testID ? `${testID}-status` : undefined}>
          {status}
        </Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

type Draft = { conformance: string | null; comment: string; added: PhotoInformation[] };

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

  if (!parameter || questions.length === 0) return <SaFrame onHome={() => nav.pop()}>{null}</SaFrame>;

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
    <SaFrame onHome={() => nav.pop()} testID="questions-pager">
      <QuestionView
        key={q.id}
        question={q}
        parameterName={params.parameterName ?? ''}
        position={active}
        count={questions.length}
        draft={drafts.get(q.id)}
        saveDraft={d => drafts.set(q.id, d)}
        onClick={onClick}
      />
    </SaFrame>
  );
}

function QuestionView({
  question,
  parameterName,
  position,
  count,
  draft,
  saveDraft,
  onClick,
}: {
  question: RequirementDetails;
  parameterName: string;
  position: number;
  count: number;
  draft?: Draft;
  saveDraft: (d: Draft) => void;
  onClick: (type: number, details: RequirementDetails, completed: boolean) => void;
}) {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const [conformance, setConformance] = useState<string | null>(draft?.conformance ?? question.conformance ?? null);
  const [comment, setComment] = useState(draft?.comment ?? question.comments ?? '');
  const [added, setAdded] = useState<PhotoInformation[]>(draft?.added ?? []);
  const [loaded, setLoaded] = useState(draft != null);
  const [radioError, setRadioError] = useState(false);
  const last = position === count - 1;

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
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveDraft({ conformance, comment, added });
  }, [conformance, comment, added, saveDraft]);

  const pickConformance = (value: string) => {
    const unopened = (question.providedEvidences ?? []).some(e => e && (e.evidenceLocalUri ?? '').trim() !== '' && !e.isOpened);
    if (unopened) {
      ui.showAlert('Please open all the Uploaded Evidences to select a option');
      setConformance(null);
      return;
    }
    setRadioError(false);
    setConformance(value);
  };

  /** The evidence references kept in the parameter: the photo is left out (read from EvidenceData by id), as the legacy cleared it. */
  const references = () => added.map(p => ({ ...p, photo: null }));

  const prepareData = (): RequirementDetails | null => {
    if (conformance == null) {
      setRadioError(true);
      ui.snackbar('Please enter required details');
      return null;
    }
    const comments = comment.trim();
    if (conformance === YES && added.length === 0) {
      ui.snackbar('Please add at least one Evidence');
      return null;
    }
    if (conformance === NO && comments === '') {
      ui.snackbar("Comments are mandatory when conformance is 'No'");
      return null;
    }
    return { ...question, conformance, comments, addedEvidences: references(), reviewNeeded: false };
  };

  const save = (back: boolean) => {
    const details = prepareData();
    if (!details) return;
    onClick(back ? BACK_BUTTON : NEXT_BUTTON, details, last);
  };

  const review = () => {
    const details: RequirementDetails = { ...question, comments: comment, addedEvidences: references(), reviewNeeded: true };
    if (conformance != null) details.conformance = conformance;
    onClick(REVIEW_BUTTON, details, last);
  };

  const addEvidence = async () => {
    const choice = await ui.pickItem('Add Evidence Options', ['Add New', 'Pick from site tour']);
    if (choice == null) return;
    nav.push('NewEvidence', {
      pickEvidence: choice === 1,
      onResult: async (evidenceId: string | null) => {
        if (!evidenceId) return ui.showAlert('Failed to add Evidence');
        const info = await app.store.evidence(app.userId, evidenceId);
        if (!info) return ui.showAlert('Failed to add Evidence');
        setAdded(list => [...list, info]);
      },
    });
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
      <View key={id}>
        <Text style={styles.qLabel}>{label}</Text>
        <Text style={styles.qValue} testID={`q-${id}`}>
          {value}
        </Text>
      </View>
    ) : null;
  const withId = (id: string | null | undefined, v: string | null | undefined) => (v != null && v.trim() !== '' ? `${id ? id + '. ' : ''}${v}` : null);

  return (
    <ScrollView contentContainerStyle={styles.qContent} keyboardShouldPersistTaps="handled" testID={`question-${position}`}>
      <View style={styles.qHeader}>
        <Pressable onPress={() => save(true)} testID="q-back">
          <Icon icon={icons.ic_baseline_arrow_back_36} tint={sa.black} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.qParam}>{parameterName}</Text>
          <Text style={styles.qCount} testID="q-count">{`${position + 1} of ${count} Question(s)`}</Text>
        </View>
      </View>
      <Divider />
      {(question.options ?? [])
        .filter(o => o && (o.label ?? '').trim() !== '')
        .map((o, i) => (
          <View key={i} style={styles.optionRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.optionText}>{o.label}</Text>
          </View>
        ))}
      {question.reviewNeeded ? <Text style={styles.reviewLabel}>(Review Needed)</Text> : null}
      {question.moreInfo?.trim() ? (
        <Pressable onPress={() => ui.showAlert(question.moreInfo!)} style={styles.moreInfo} testID="q-more-info">
          <Text style={styles.moreInfoText}>More info</Text>
          <Image source={images.ic_info_black_24dp} style={styles.infoIcon} />
        </Pressable>
      ) : null}
      <Divider />
      <Text style={styles.qLabel}>Selected Option</Text>
      <Text style={styles.qValue}>{question.previousSelectedOption ?? 'No option selected'}</Text>
      {text('MSME Option', withId(question.msmeOptionId, question.msmeOption), 'msme-option')}
      {text('MSME Comment', question.msmeComment, 'msme-comment')}
      {text('DA Option', withId(question.daOptionId, question.daOption), 'da-option')}
      {text('DA Status', question.daStatus, 'da-status')}
      {text('DA Comment', question.daComment, 'da-comment')}
      <Text style={[styles.qLabel, radioError && { color: '#B00020' }]}>Conformance{radioError ? ' (!)' : ''}</Text>
      <View style={styles.radios}>
        <RadioButton label="Yes" selected={conformance === YES} onPress={() => pickConformance(YES)} testID="q-yes" />
        <RadioButton label="No" selected={conformance === NO} onPress={() => pickConformance(NO)} testID="q-no" />
      </View>
      <Text style={styles.qLabel}>Comments</Text>
      <OutlinedInput value={comment} onChangeText={setComment} multiline showCounter maxLength={500} autoCapitalize="sentences" testID="q-comment" />
      <Text style={styles.qLabel}>Add Evidence</Text>
      {added.map((p, i) => (
        <View key={`${p.evidenceId}-${i}`} style={styles.evidence} testID={`q-evidence-${i}`}>
          <View style={styles.evidenceImage}>
            {p.photo ? <Image source={{ uri: `data:image/jpeg;base64,${p.photo.replace(/\s/g, '')}` }} style={StyleSheet.absoluteFill} resizeMode="stretch" /> : null}
          </View>
          <Text style={styles.evidenceName}>{p.name ?? ''}</Text>
          <Text style={styles.delete} onPress={() => deleteEvidence(i)} testID={`q-evidence-${i}-delete`}>
            Delete
          </Text>
        </View>
      ))}
      {added.length < 5 ? (
        <Pressable style={styles.addTile} onPress={addEvidence} testID="q-add-evidence">
          <Text style={styles.addTileText}>{added.length === 0 ? 'Take Photo' : 'Add More'}</Text>
        </Pressable>
      ) : null}
      <View style={styles.buttons}>
        <SaButton title="Previous" disabled={position === 0} onPress={() => onClick(PREVIOUS_BUTTON, question, false)} testID="q-previous" style={styles.flexButton} />
        <SaButton title="Review" onPress={review} testID="q-review" style={styles.flexButton} />
        <SaButton title={last ? 'Save' : 'Save >'} onPress={() => save(false)} testID="q-save" style={styles.flexButton} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  progressText: { color: sa.darkGrey, fontSize: 14, fontWeight: 'bold', padding: 12 },
  progressBar: { height: 6, flexDirection: 'row', backgroundColor: sa.silver, marginHorizontal: 12, marginBottom: 8, borderRadius: 3, overflow: 'hidden' },
  progressFill: { backgroundColor: sa.primary },
  separator: { height: 1, backgroundColor: sa.divider },
  paramRow: { flexDirection: 'row', alignItems: 'center', padding: 6 },
  statusIcon: { width: 32, height: 32 },
  paramName: { color: sa.darkGrey, fontSize: 16, padding: 8 },
  paramStatus: { fontSize: 14, fontWeight: 'bold', paddingHorizontal: 8, paddingBottom: 8 },
  arrow: { fontSize: 28, color: sa.coolGrey, paddingHorizontal: 8 },
  qContent: { padding: 8, paddingBottom: 24 },
  qHeader: { flexDirection: 'row', alignItems: 'center' },
  qParam: { color: sa.darkGrey, fontSize: 16, fontWeight: 'bold', marginVertical: 2 },
  qCount: { color: sa.coolGrey, fontSize: 14, fontWeight: 'bold' },
  optionRow: { flexDirection: 'row', paddingVertical: 2 },
  bullet: { width: 16, color: sa.darkGrey, fontSize: 15 },
  optionText: { flex: 1, color: sa.darkGrey, fontSize: 15 },
  reviewLabel: { color: sa.red, fontSize: 16, textAlign: 'center' },
  moreInfo: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  moreInfoText: { color: '#9B9B9B', fontSize: 14, fontWeight: 'bold', marginRight: 4 },
  infoIcon: { width: 20, height: 20, opacity: 0.6 },
  qLabel: { color: sa.labelColor, fontSize: 14, fontWeight: 'bold', marginTop: 10 },
  qValue: { color: sa.darkGrey, fontSize: 15, marginTop: 2 },
  radios: { flexDirection: 'row', gap: 24, paddingVertical: 4 },
  evidence: { backgroundColor: sa.paleGrey, borderColor: sa.silver, borderWidth: 0.5, borderRadius: 3, padding: 5, marginBottom: 10, alignSelf: 'flex-start' },
  evidenceImage: { width: 120, height: 120, backgroundColor: sa.silver },
  evidenceName: { color: sa.darkGrey, fontSize: 14, maxWidth: 120, marginTop: 4 },
  delete: { color: '#EE4056', fontWeight: 'bold', fontSize: 14, marginTop: 4 },
  addTile: { width: 120, height: 120, backgroundColor: sa.paleGrey, borderColor: sa.silver, borderWidth: 0.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  addTileText: { color: sa.darkGrey, fontSize: 15 },
  buttons: { flexDirection: 'row', marginTop: 12 },
  flexButton: { flex: 1, margin: 4, alignSelf: 'stretch' },
});
