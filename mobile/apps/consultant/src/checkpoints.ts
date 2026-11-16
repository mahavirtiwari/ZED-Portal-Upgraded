/**
 * 2026-11-16 (approved): Yes / Partial / No for each checkpoint of a requirement, as on the milestone page (server: Zed.Core
 * HandholdingCheckpoints / CheckpointAnswers, which checks the same rules again). The baseline (milestone 1) takes the actions
 * needed for Partial / No (or what is needed, when the Admin listed none), and those actions join the requirement's
 * Handholding Action Plan, where the consultant can add more or delete them. The progress reviews (milestones 2 and 3) take
 * the answer only. A Yes on a checkpoint with mandatory evidence needs a photo on the requirement (handholding keeps its
 * photos per requirement).
 */
import { NO, PARTIAL, SUBMITTED, YES, type BaselineDiagnosticStudyData, type CheckpointAnswer, type Option, type RequirementDetails } from './models';

export const ANSWERS = [YES, PARTIAL, NO] as const;

/** Which answer the consultant gives: the baseline in milestone 1, progress review 1 / 2 in milestones 2 / 3. */
export type CheckpointStage = 'baseline' | 'review1' | 'review2';

export const stageOf = (milestone: number | null | undefined): CheckpointStage | null =>
  milestone === 1 ? 'baseline' : milestone === 2 ? 'review1' : milestone === 3 ? 'review2' : null;

/** The options of the requirement that are checkpoints. */
export function checkpointOptions(q: RequirementDetails): Option[] {
  return (q.options ?? []).filter((o): o is Option => !!o?.checkpoint);
}

export const hasCheckpoints = (q: RequirementDetails) => checkpointOptions(q).length > 0;

/** The answers to start from: those saved in the requirement, else the server's answers of this stage. */
export function initialAnswers(q: RequirementDetails, stage: CheckpointStage): CheckpointAnswer[] {
  return checkpointOptions(q).map(o => {
    const c = o.checkpoint!;
    const saved = q.checkpointAnswers?.find(a => a.id === c.id);
    if (saved) return { ...saved, actions: [...saved.actions] };
    if (stage === 'baseline') return { id: c.id, answer: c.baselineAnswer ?? null, actions: [...(c.baselineActions ?? [])], remarks: c.baselineRemarks ?? null };
    return { id: c.id, answer: (stage === 'review1' ? c.review1Answer : c.review2Answer) ?? null, actions: [], remarks: null };
  });
}

/** The requirement's conformance from its checkpoints: Yes when all are Yes, No when all are No, else Partial; null until all answered. */
export function conformanceOf(answers: CheckpointAnswer[]): string | null {
  if (answers.length === 0 || answers.some(a => !a.answer)) return null;
  if (answers.every(a => a.answer === YES)) return YES;
  return answers.every(a => a.answer === NO) ? NO : PARTIAL;
}

/** The first problem with the answers (the server's wording), or null. */
export function checkpointProblem(q: RequirementDetails, answers: CheckpointAnswer[], stage: CheckpointStage, hasPhoto: boolean): string | null {
  for (const o of checkpointOptions(q)) {
    const c = o.checkpoint!;
    const name = `Checkpoint ${o.code ?? ''}`.trim();
    const a = answers.find(x => x.id === c.id);
    if (!a?.answer) return `${name}: please choose Yes, Partial or No.`;
    if (a.answer === YES) {
      if (c.evidences.some(e => e.mandatory) && !hasPhoto) return `${name}: Yes needs the mandatory evidence; please add a photo of it to this parameter first.`;
    } else if (stage === 'baseline') {
      if (c.actions.length > 0 && a.actions.length === 0) return `${name}: please tick the actions needed.`;
      if (c.actions.length === 0 && !(a.remarks ?? '').trim()) return `${name}: please write what is needed.`;
    }
  }
  return null;
}

/** A Yes keeps no actions (as the server stores it). */
export function setAnswer(answers: CheckpointAnswer[], id: number, answer: string): CheckpointAnswer[] {
  return answers.map(a => (a.id === id ? { ...a, answer, actions: answer === YES ? [] : a.actions } : a));
}

export function toggleAction(answers: CheckpointAnswer[], id: number, action: string): CheckpointAnswer[] {
  return answers.map(a => (a.id === id ? { ...a, actions: a.actions.includes(action) ? a.actions.filter(x => x !== action) : [...a.actions, action] } : a));
}

export function setRemarks(answers: CheckpointAnswer[], id: number, remarks: string): CheckpointAnswer[] {
  return answers.map(a => (a.id === id ? { ...a, remarks } : a));
}

/** The ticked actions of the Partial / No answers, once each (as the server adds them to the plan). */
export function plannedFrom(answers: CheckpointAnswer[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of answers)
    if (a.answer && a.answer !== YES)
      for (const action of a.actions) {
        const key = action.trim().toLowerCase();
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push(action.trim());
        }
      }
  return out;
}

/**
 * The baseline's ticked actions added to the same requirement's Handholding Action Plan (the plan screen's copy), where they
 * can be deleted or more added. They are added to the plan's base too: the server adds them when the baseline is sent, so a
 * later delete in the app is sent as a delete. A plan already submitted is left alone. Returns how many were added.
 */
export function addActionsToPlan(plan: BaselineDiagnosticStudyData | null, requirement: RequirementDetails, actions: string[]): number {
  if (!plan || actions.length === 0) return 0;
  const target = plan.parameters?.flatMap(p => (p?.status === SUBMITTED ? [] : (p?.requirements ?? []))).find(r => r && String(r.id) === String(requirement.id));
  if (!target) return 0;
  const have = new Set((target.plannedActivities ?? []).map(x => x.trim().toLowerCase()));
  const added = actions.filter(a => !have.has(a.trim().toLowerCase()));
  if (added.length === 0) return 0;
  target.plannedActivities = [...(target.plannedActivities ?? []), ...added];
  const base = new Set((target.plannedActivitiesBase ?? []).map(x => x.trim().toLowerCase()));
  target.plannedActivitiesBase = [...(target.plannedActivitiesBase ?? []), ...added.filter(a => !base.has(a.trim().toLowerCase()))];
  return added.length;
}
