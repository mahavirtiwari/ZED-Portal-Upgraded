import type { EsgResponse } from '../src/api';
import { areAllFieldsFilled, buildEsgJson, sectionKey, toSubmitRequest } from '../src/esg';

/** The shape V4 returns (EsgChecklistJson): no section_key, dependent fields with selected_option. */
const esg: EsgResponse = {
  status: undefined,
  sections: [
    {
      section_title: 'ESG check list',
      fields: [
        { id: '1', type: 'single_choice', question: 'Are you registered under the Factories Act, 1948?', options: ['Yes', 'No', 'Not Applicable'] },
        {
          id: '2',
          type: 'single_choice',
          question: 'Is COE and COO applicable to you?',
          options: ['Yes', 'No', 'Not Applicable'],
          dependent_fields: [{ id: '3', type: 'single_choice', selected_option: 'Yes', question: 'If yes, have you obtained both?', options: ['Yes', 'No'] }],
        },
        { id: '9', type: 'text', question: 'Top-level text (never submitted by the legacy app)' },
      ],
    },
    {
      section_title: 'Social / OHS check list',
      fields: [
        {
          id: '20',
          type: 'single_choice',
          question: 'Do you have a safety policy?',
          options: ['Yes', 'No'],
          dependent_fields: [{ id: '21', type: 'text_box', selected_option: 'No', question: 'If no, why?' }],
        },
      ],
    },
  ],
};

describe('ESG checklist (ESGCheckListActivity)', () => {
  it('falls back to the request keys by position when the server sends no section_key', () => {
    expect(sectionKey(esg.sections[0]!, 0)).toBe('esgChecklist');
    expect(sectionKey(esg.sections[1]!, 1)).toBe('socialOhsChecklist');
    expect(sectionKey({ section_title: 'x', section_key: 'esgChecklist', fields: [] }, 1)).toBe('esgChecklist');
  });

  it('requires every question and the dependent answer that the choice shows', () => {
    const partial = buildEsgJson(esg, { '1': 'Yes', '2': 'Yes', '20': 'Yes' }, 'ZED1', 'Bronze', '1.9');
    expect(areAllFieldsFilled(partial)).toBe(false); // 3 is shown for "Yes" and not answered
    const noDependent = buildEsgJson(esg, { '1': 'Yes', '2': 'No', '20': 'No' }, 'ZED1', 'Bronze', '1.9');
    expect(areAllFieldsFilled(noDependent)).toBe(false); // 21 shown for "No"
    const complete = buildEsgJson(esg, { '1': 'Yes', '2': 'Yes', '3': 'No', '20': 'No', '21': 'Small unit' }, 'ZED1', 'Bronze', '1.9');
    expect(areAllFieldsFilled(complete)).toBe(true);
    expect(areAllFieldsFilled(buildEsgJson(esg, {}, 'ZED1', 'Bronze', '1.9'))).toBe(false);
  });

  it('sends what Gson made of the JSON: the model fields only, dependent answers in ifYes/ifNo', () => {
    const json = buildEsgJson(esg, { '1': 'Not Applicable', '2': 'Yes', '3': 'No', '20': 'No', '21': 'Small unit', '9': 'ignored' }, 'ZED1', 'Bronze', '1.9');
    const req = toSubmitRequest(json);
    expect(req).toEqual({
      version: '1.9',
      userName: 'ZED1',
      certificationType: 'Bronze',
      esgChecklist: [
        { code: '1', question: 'Are you registered under the Factories Act, 1948?', answer: 'Not Applicable', ifYesQuestion: '', ifYesAnswer: '', ifNoQuestion: '', ifNoAnswer: '' },
        {
          code: '2',
          question: 'Is COE and COO applicable to you?',
          answer: 'Yes',
          ifYesQuestion: 'If yes, have you obtained both?',
          ifYesAnswer: 'No',
          ifNoQuestion: '',
          ifNoAnswer: '',
        },
      ],
      socialOhsChecklist: [
        { code: '20', question: 'Do you have a safety policy?', answer: 'No', ifYesQuestion: '', ifYesAnswer: '', ifNoQuestion: 'If no, why?', ifNoAnswer: 'Small unit' },
      ],
    });
  });

  it('clears the dependent answer when the choice that shows it is not taken', () => {
    const json = buildEsgJson(esg, { '1': 'Yes', '2': 'No', '3': 'Yes', '20': 'Yes', '21': 'x' }, 'Z', 'Bronze', '1.9');
    const req = toSubmitRequest(json);
    expect(req.esgChecklist[1]).toMatchObject({ answer: 'No', ifYesQuestion: '', ifYesAnswer: '' });
    expect(req.socialOhsChecklist[0]).toMatchObject({ answer: 'Yes', ifNoQuestion: '', ifNoAnswer: '' });
  });
});
