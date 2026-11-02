/**
 * V4: Yes / Partial / No for each checkpoint of a requirement, as on the web (server Zed.Core CheckpointAnswers, which
 * checks the same rules again). A requirement whose options carry a checkpoint is answered checkpoint by checkpoint; its
 * conformance follows: Yes only when every checkpoint is Yes (a Partial is not conforming).
 */
import { NO, YES, type CheckpointAnswer, type Option, type RequirementDetails } from './models';

export const PARTIAL = 'Partial';
export const ANSWERS = [YES, PARTIAL, NO] as const;

/** The options of the requirement that are checkpoints. */
export function checkpointOptions(q: RequirementDetails): Option[] {
  return (q.options ?? []).filter((o): o is Option => !!o?.checkpoint);
}

export const hasCheckpoints = (q: RequirementDetails) => checkpointOptions(q).length > 0;

/** The answers to start from: those saved in the requirement, else the site answers the server sent. */
export function initialAnswers(q: RequirementDetails): CheckpointAnswer[] {
  return checkpointOptions(q).map(o => {
    const saved = q.checkpointAnswers?.find(a => a.id === o.id);
    if (saved) return { ...saved, actions: [...saved.actions] };
    const c = o.checkpoint!;
    return { id: o.id, answer: c.siteAnswer ?? null, actions: [...(c.siteActions ?? [])], remarks: c.siteRemarks ?? null };
  });
}

/** Yes when every checkpoint is Yes, else No; null until every checkpoint is answered. */
export function conformanceOf(answers: CheckpointAnswer[]): string | null {
  if (answers.length === 0 || answers.some(a => !a.answer)) return null;
  return answers.every(a => a.answer === YES) ? YES : NO;
}

/** The first problem with the answers (the server's wording), or null. */
export function checkpointProblem(q: RequirementDetails, answers: CheckpointAnswer[]): string | null {
  for (const o of checkpointOptions(q)) {
    const name = `Checkpoint ${o.code ?? ''}`.trim();
    const a = answers.find(x => x.id === o.id);
    const c = o.checkpoint!;
    if (!a?.answer) return `${name}: please choose Yes, Partial or No.`;
    if (a.answer === YES) {
      const mandatory = c.evidences.filter(e => e.mandatory);
      const missing = mandatory.find(e => !e.uploaded);
      if (missing) return `${name}: Yes needs every mandatory evidence; "${missing.name ?? ''}" is not uploaded.`;
      const refused = mandatory.find(e => e.verified === NO);
      if (refused) return `${name}: Yes needs every mandatory evidence; "${refused.name ?? ''}" was not verified.`;
    } else if (c.actions.length > 0 && a.actions.length === 0) {
      return `${name}: please tick the actions needed.`;
    } else if (c.actions.length === 0 && !(a.remarks ?? '').trim()) {
      return `${name}: please write what is needed.`;
    }
  }
  return null;
}

/** A Yes keeps no actions (as the server stores it). */
export function setAnswer(answers: CheckpointAnswer[], id: number, answer: string): CheckpointAnswer[] {
  return answers.map(a => (a.id === id ? { ...a, answer, actions: answer === YES ? [] : a.actions } : a));
}

export function toggleAction(answers: CheckpointAnswer[], id: number, action: string): CheckpointAnswer[] {
  return answers.map(a =>
    a.id === id ? { ...a, actions: a.actions.includes(action) ? a.actions.filter(x => x !== action) : [...a.actions, action] } : a,
  );
}

export function setRemarks(answers: CheckpointAnswer[], id: number, remarks: string): CheckpointAnswer[] {
  return answers.map(a => (a.id === id ? { ...a, remarks } : a));
}
