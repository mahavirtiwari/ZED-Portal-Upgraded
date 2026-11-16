import {
  addActionsToPlan,
  checkpointProblem,
  conformanceOf,
  hasCheckpoints,
  initialAnswers,
  plannedFrom,
  setAnswer,
  stageOf,
  toggleAction,
} from '../src/checkpoints';
import { SUBMITTED, type BaselineDiagnosticStudyData, type RequirementDetails } from '../src/models';

/** 2026-11-16 (approved): checkpoints in the consultant app, and their actions in the Handholding Action Plan. */
function requirement(): RequirementDetails {
  return {
    id: '210',
    code: 'R1',
    reviewNeeded: false,
    planRequirementId: 11,
    options: [
      {
        id: 1, code: '1', label: 'Written policy',
        checkpoint: { id: 801, actions: ['Write the policy', 'Display it'], evidences: [{ name: 'Policy', mandatory: true }], baselineAnswer: 'No', baselineActions: ['Display it'] },
      },
      { id: 2, code: '2', label: 'Staff know it', checkpoint: { id: 802, actions: [], evidences: [], review1Answer: 'Partial' } },
      { id: 3, code: '3', label: 'Plain option' },
    ],
  };
}

describe('consultant checkpoints', () => {
  it('starts from the answers the server has for the stage', () => {
    const r = requirement();
    expect(hasCheckpoints(r)).toBe(true);
    expect(stageOf(1)).toBe('baseline');
    expect(stageOf(3)).toBe('review2');
    expect(stageOf(4)).toBeNull();
    expect(initialAnswers(r, 'baseline')).toEqual([
      { id: 801, answer: 'No', actions: ['Display it'], remarks: null },
      { id: 802, answer: null, actions: [], remarks: null },
    ]);
    expect(initialAnswers(r, 'review1').map(a => a.answer)).toEqual([null, 'Partial']);
  });

  it('checks the answers as the server does', () => {
    const r = requirement();
    let answers = initialAnswers(r, 'baseline');
    expect(checkpointProblem(r, answers, 'baseline', false)).toBe('Checkpoint 2: please choose Yes, Partial or No.');
    answers = setAnswer(answers, 802, 'Partial');
    // No actions listed by the Admin: what is needed must be written.
    expect(checkpointProblem(r, answers, 'baseline', false)).toBe('Checkpoint 2: please write what is needed.');
    // A progress review takes the answer only.
    expect(checkpointProblem(r, answers, 'review1', false)).toBeNull();
    answers = setAnswer(answers, 801, 'Yes');
    expect(answers[0]!.actions).toEqual([]);
    expect(checkpointProblem(r, answers, 'review1', false)).toBe('Checkpoint 1: Yes needs the mandatory evidence; please add a photo of it to this parameter first.');
    expect(checkpointProblem(r, answers, 'review1', true)).toBeNull();
    expect(conformanceOf(answers)).toBe('Partial');
    expect(conformanceOf(setAnswer(answers, 802, 'Yes'))).toBe('Yes');
    expect(conformanceOf(setAnswer(setAnswer(answers, 801, 'No'), 802, 'No'))).toBe('No');
  });

  it('adds the ticked actions of a Partial / No to the action plan once, and to its base', () => {
    const r = requirement();
    let answers = toggleAction(initialAnswers(r, 'baseline'), 801, 'Write the policy');
    answers = setAnswer(answers, 802, 'Yes');
    expect(plannedFrom(answers)).toEqual(['Display it', 'Write the policy']);

    const planRequirement: RequirementDetails = { id: '210', reviewNeeded: false, plannedActivities: ['display it', 'Train'], plannedActivitiesBase: ['display it', 'Train'] };
    const plan = { status: 'TO_START', parameters: [{ status: 0, isSelectedToSubmit: false, requirements: [planRequirement] }] } as unknown as BaselineDiagnosticStudyData;
    expect(addActionsToPlan(plan, r, plannedFrom(answers))).toBe(1);
    expect(planRequirement.plannedActivities).toEqual(['display it', 'Train', 'Write the policy']);
    expect(planRequirement.plannedActivitiesBase).toEqual(['display it', 'Train', 'Write the policy']);
    // Again: nothing new.
    expect(addActionsToPlan(plan, r, plannedFrom(answers))).toBe(0);

    // A plan already submitted is left alone.
    plan.parameters![0]!.status = SUBMITTED;
    expect(addActionsToPlan(plan, r, ['Something else'])).toBe(0);
    expect(addActionsToPlan(null, r, ['x'])).toBe(0);
  });
});
