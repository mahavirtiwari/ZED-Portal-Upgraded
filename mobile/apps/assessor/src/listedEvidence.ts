import type { CheckpointAnswer, ListedEvidence, Option, PhotoInformation, RequirementDetails } from './models';

/**
 * V4 (redesign; server SiteEvidenceChecks): the evidences the Admin lists for a requirement are each answered at the site,
 * Yes (available, with 1 to 3 photos, taken or picked from the site tour) or No. A No keeps the requirement from
 * conforming: the checkpoint the evidence belongs to cannot be Yes, and an evidence of no checkpoint (or of a requirement
 * without checkpoints) makes its conformance No. A requirement without listed evidences keeps the free evidence photos
 * ("Add evidence").
 */
export type EvidenceCheck = { id: number; available: 'Yes' | 'No' | null; photoIds: string[] };

export const MAX_EVIDENCE_PHOTOS = 3;

export const listedOf = (q: RequirementDetails): ListedEvidence[] => (q.listedEvidences ?? []).filter(Boolean);

/** The site's earlier answers (a photo is kept only when it is still among the requirement's photos). */
export function initialChecks(q: RequirementDetails, photos: readonly PhotoInformation[]): EvidenceCheck[] {
  const kept = new Set(photos.map(p => p.photoId));
  return listedOf(q).map(e => {
    const earlier = q.evidenceChecks?.find(c => c.id === e.id);
    const available = (earlier?.available ?? e.available ?? null) as EvidenceCheck['available'];
    const ids = earlier?.photoIds ?? e.photoIds ?? [];
    return { id: e.id, available: available === 'Yes' || available === 'No' ? available : null, photoIds: ids.filter(id => kept.has(id)) };
  });
}

/** The option codes of the checkpoints answered Yes. */
function yesCheckpoints(options: readonly (Option | null)[], answers: readonly CheckpointAnswer[]): string[] {
  return answers
    .filter(a => a.answer === 'Yes')
    .map(a => options.find(o => o?.id === a.id)?.code?.trim() ?? '')
    .filter(c => c !== '');
}

/** The first problem, as the server words it, or null. */
export function listedProblem(
  q: RequirementDetails,
  checks: readonly EvidenceCheck[],
  photos: readonly PhotoInformation[],
  answers: readonly CheckpointAnswer[],
  conformance: string | null,
): string | null {
  const photoIds = new Set(photos.map(p => p.photoId));
  const yes = yesCheckpoints(q.options ?? [], answers);
  for (const e of listedOf(q)) {
    const c = checks.find(x => x.id === e.id);
    if (!c?.available) return `Please answer whether "${e.name}" is available at the site.`;
    if (c.available === 'Yes') {
      if (c.photoIds.length === 0 || c.photoIds.some(id => !photoIds.has(id))) return `Please capture a photo of "${e.name}".`;
      if (c.photoIds.length > MAX_EVIDENCE_PHOTOS) return `"${e.name}" takes at most ${MAX_EVIDENCE_PHOTOS} photos.`;
      continue;
    }
    if (e.checkpoint && yes.includes(e.checkpoint.trim())) return `Checkpoint ${e.checkpoint} cannot be Yes: "${e.name}" is not available at the site.`;
    if (conformance === 'Yes') return `The conformance cannot be Yes: "${e.name}" is not available at the site.`;
  }
  return null;
}

/** The checks as SA/SubmitParameter takes them. */
export const checksForRequest = (checks: readonly EvidenceCheck[]) =>
  checks.map(c => ({ id: c.id, available: c.available, photoIds: c.available === 'Yes' ? c.photoIds : [] }));

// ------------------------------------------------------------------ comments as bullets

const BULLET = '• ';

/** The comment's points: one per line, without their bullet (a free-text comment of an older version is one point). */
export const bulletsOf = (comment: string | null | undefined): string[] =>
  (comment ?? '')
    .split('\n')
    .map(l => l.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(l => l !== '');

/** The comment kept and sent: "• point" lines. */
export const bulletText = (points: readonly string[]) => points.map(p => BULLET + p.trim()).join('\n');
