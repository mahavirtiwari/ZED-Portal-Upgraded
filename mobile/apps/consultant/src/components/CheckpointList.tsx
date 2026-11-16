import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ANSWERS, checkpointOptions, type CheckpointStage } from '../checkpoints';
import { NO, PARTIAL, YES, type CheckpointAnswer, type RequirementDetails } from '../models';
import { Badge, C, Card, Field, SectionLabel, ZIcon } from '../ui/zed';

const TONES: Record<string, { fg: string; bg: string }> = {
  [YES]: { fg: C.success, bg: C.successBg },
  [PARTIAL]: { fg: C.warning, bg: C.warningBg },
  [NO]: { fg: C.danger, bg: C.dangerBg },
};

/**
 * 2026-11-16 (approved): the checkpoints of a requirement, each a card with its evidence (what to see for Yes; a mandatory one
 * needs a photo on the requirement), Yes / Partial / No and, in the baseline, the actions needed to tick for Partial / No (or
 * what is needed, when the Admin listed none). The ticked actions join the Handholding Action Plan. Progress reviews take the
 * answer only, beside the baseline's.
 */
export function CheckpointList({
  requirement,
  answers,
  stage,
  error,
  readOnly,
  onAnswer,
  onAction,
  onRemarks,
}: {
  requirement: RequirementDetails;
  answers: CheckpointAnswer[];
  stage: CheckpointStage;
  error: boolean;
  readOnly?: boolean;
  onAnswer: (id: number, value: string) => void;
  onAction: (id: number, action: string) => void;
  onRemarks: (id: number, value: string) => void;
}) {
  const review = stage !== 'baseline';
  return (
    <View testID="req-checkpoints">
      <SectionLabel label="Checkpoints" style={styles.label} />
      {checkpointOptions(requirement).map(o => {
        const c = o.checkpoint!;
        const a = answers.find(x => x.id === c.id);
        const missing = error && !a?.answer;
        const earlier = [
          review && c.baselineAnswer ? `Baseline: ${c.baselineAnswer}` : null,
          stage === 'review2' && c.review1Answer ? `Progress Review 1: ${c.review1Answer}` : null,
        ].filter(Boolean);
        return (
          <Card key={c.id} style={[styles.card, missing && styles.cardError]} testID={`cp-${c.id}`}>
            <View style={styles.head}>
              <Text style={styles.title}>{(o.code ? o.code + '. ' : '') + (o.label ?? '')}</Text>
              {missing ? <Badge label="Required" tone="danger" small /> : null}
            </View>
            {c.evidences.length > 0 ? (
              <View style={styles.evidence} testID={`cp-${c.id}-evidence`}>
                <ZIcon name="paperclip" size={14} color={C.tMuted} />
                <Text style={styles.evidenceText}>
                  {'Evidence: ' + c.evidences.map(e => (e.name ?? '') + (e.mandatory ? ' (required for Yes)' : '')).join(', ')}
                </Text>
              </View>
            ) : null}
            {earlier.length > 0 ? <Text style={styles.meta}>{earlier.join(' · ')}</Text> : null}
            <View style={styles.answers}>
              {ANSWERS.map(v => {
                const on = a?.answer === v;
                const tone = TONES[v]!;
                return (
                  <Pressable
                    key={v}
                    disabled={readOnly}
                    style={[styles.answer, on && { borderColor: tone.fg, backgroundColor: tone.bg }]}
                    onPress={() => onAnswer(c.id, v)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, disabled: !!readOnly }}
                    testID={`cp-${c.id}-${v.toLowerCase()}`}
                  >
                    <Text style={[styles.answerText, on && { color: tone.fg, fontWeight: '700' }]}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>
            {!review && a?.answer && a.answer !== YES ? (
              c.actions.length > 0 ? (
                <View style={styles.more}>
                  <Text style={styles.moreLabel}>ACTIONS NEEDED · TICKED ONES JOIN THE ACTION PLAN</Text>
                  {c.actions.map((action, i) => {
                    const ticked = a.actions.includes(action);
                    return (
                      <Pressable
                        key={i}
                        disabled={readOnly}
                        style={styles.tickRow}
                        onPress={() => onAction(c.id, action)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: ticked }}
                        testID={`cp-${c.id}-action-${i}`}
                      >
                        <View style={[styles.tick, ticked && styles.tickOn]}>{ticked ? <ZIcon name="check" size={14} color={C.tInverse} strokeWidth={2.6} /> : null}</View>
                        <Text style={styles.tickLabel}>{action}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.more}>
                  <Text style={styles.moreLabel}>WHAT IS NEEDED</Text>
                  <Field value={a.remarks ?? ''} onChangeText={t => onRemarks(c.id, t)} multiline maxLength={1000} editable={!readOnly} testID={`cp-${c.id}-remarks`} />
                </View>
              )
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 16 },
  card: { marginTop: 8, padding: 12 },
  cardError: { borderColor: C.danger, borderWidth: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: C.tPrimary },
  evidence: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  evidenceText: { flex: 1, fontSize: 12, color: C.tMuted },
  meta: { fontSize: 12, color: C.tMuted, marginTop: 4 },
  answers: { flexDirection: 'row', gap: 8, marginTop: 10 },
  answer: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: C.surface },
  answerText: { fontSize: 14, color: C.tPrimary },
  more: { marginTop: 10 },
  moreLabel: { fontSize: 11, fontWeight: '700', color: C.tMuted, letterSpacing: 0.4, marginBottom: 4 },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  tick: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: C.success, borderColor: C.success },
  tickLabel: { flex: 1, fontSize: 14, color: C.tPrimary },
});
