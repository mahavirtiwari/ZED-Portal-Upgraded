/**
 * ESGCheckListActivity's form logic, kept apart from the screen so it can be tested: how the submission JSON is
 * built from the answers (loadDynamicForm + the proceed button), what Gson then sends, and areAllFieldsFilled.
 */
import type { EsgChecklistItem, EsgChecklistSubmitDataRequest, EsgResponse, EsgSection } from './api';

export const ESG_KEYS = ['esgChecklist', 'socialOhsChecklist'] as const;

/**
 * The section's key in the request. The legacy app used `section_key` as is; V4's built-in checklist has no
 * `section_key` (the legacy app then crashed on Proceed), so the sections fall back to their position:
 * first = esgChecklist, second = socialOhsChecklist (the only two keys the request has).
 */
export function sectionKey(section: EsgSection, index: number): string {
  return section.section_key ?? ESG_KEYS[index] ?? `section${index}`;
}

type JsonItem = Record<string, string>;

/**
 * Builds the submittingJsonObject: one item per single_choice field (top-level "text" fields are not submitted),
 * with dependent_code_<i> and dependent_visibility_if_<id>; then fills answer / ifYes* / ifNo* from the answers.
 * A missing answer removes the key, as JSONObject.put(name, null) did.
 */
export function buildEsgJson(esg: EsgResponse, answers: Record<string, string | undefined>, userName: string, certificationType: string, version: string) {
  const json: Record<string, unknown> = { version, userName, certificationType };
  esg.sections.forEach((section, sIndex) => {
    const items: JsonItem[] = [];
    for (const field of section.fields) {
      if (field.type !== 'single_choice') continue;
      const item: JsonItem = { code: field.id, question: field.question, answer: '', ifYesQuestion: '', ifYesAnswer: '', ifNoQuestion: '', ifNoAnswer: '' };
      (field.dependent_fields ?? []).forEach((dep, index) => {
        item[`dependent_code_${index}`] = dep.id;
        item[`dependent_visibility_if_${dep.id}`] = dep.selected_option ?? '';
      });
      items.push(item);
    }
    json[sectionKey(section, sIndex)] = items;
  });

  const put = (o: JsonItem, k: string, v: string | undefined) => {
    if (v == null) delete o[k];
    else o[k] = v;
  };

  esg.sections.forEach((section, sIndex) => {
    const items = json[sectionKey(section, sIndex)] as JsonItem[];
    for (const item of items) {
      const code = item.code!;
      const answer = answers[code];
      put(item, 'answer', answer);
      const field = section.fields.find(f => f.id === code);
      (field?.dependent_fields ?? []).forEach((dep, dpIndex) => {
        const depCode = item[`dependent_code_${dpIndex}`];
        if (depCode == null) return;
        const depAnswer = answers[depCode];
        const visibleIf = item[`dependent_visibility_if_${depCode}`];
        if (visibleIf === 'Yes') {
          if (answer === 'Yes') {
            put(item, 'ifYesAnswer', depAnswer);
            item.ifYesQuestion = dep.question;
          } else {
            item.ifYesAnswer = '';
            item.ifYesQuestion = '';
          }
        } else if (visibleIf === 'No') {
          if (answer === 'No') {
            put(item, 'ifNoAnswer', depAnswer);
            item.ifNoQuestion = dep.question;
          } else {
            item.ifNoAnswer = '';
            item.ifNoQuestion = '';
          }
        }
      });
    }
  });
  return json;
}

const blank = (v: unknown) => v == null || String(v).trim() === '';

/** areAllFieldsFilled */
export function areAllFieldsFilled(json: Record<string, unknown>): boolean {
  for (const key of ESG_KEYS) {
    const items = json[key] as JsonItem[] | undefined;
    if (!items) return false; // the legacy getJSONArray threw here
    for (const item of items) {
      if (!('answer' in item)) return false;
      const answer = item.answer;
      if (blank(answer)) return false;
      for (const i of [0, 1]) {
        const dep = item[`dependent_code_${i}`];
        if (dep == null) continue;
        const visibleIf = item[`dependent_visibility_if_${dep}`];
        if (answer === 'Yes' && visibleIf === 'Yes' && blank(item.ifYesAnswer)) return false;
        if (answer === 'No' && visibleIf === 'No' && blank(item.ifNoAnswer)) return false;
      }
    }
  }
  return true;
}

/** gson.fromJson(json, EsgChecklistSubmitDataRequest): only the model's fields survive (dependent_* keys are dropped). */
export function toSubmitRequest(json: Record<string, unknown>): EsgChecklistSubmitDataRequest {
  const items = (key: string) =>
    ((json[key] as JsonItem[] | undefined) ?? []).map(
      i =>
        ({
          code: i.code,
          question: i.question,
          answer: i.answer,
          ifYesQuestion: i.ifYesQuestion,
          ifYesAnswer: i.ifYesAnswer,
          ifNoQuestion: i.ifNoQuestion,
          ifNoAnswer: i.ifNoAnswer,
        }) as EsgChecklistItem,
    );
  return {
    version: String(json.version),
    userName: String(json.userName),
    certificationType: String(json.certificationType),
    esgChecklist: items('esgChecklist'),
    socialOhsChecklist: items('socialOhsChecklist'),
  };
}
