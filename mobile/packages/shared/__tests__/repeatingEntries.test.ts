import { customFieldsPayload, customRowPhotos, photosInAnswers, rowsForRequest, validateForm, type FormDefinition, type FormField } from '../src/forms/appForms';

/** 2026-11-16: the Admin's repeating entries ("Add more") with a photo column. */
const machines: FormField = {
  key: 'cf_machines', label: 'Machines', type: 'rows', required: true, custom: true, section: 'basic', order: 100, maxItems: 2,
  columns: [
    { key: 'c_name', label: 'Machine name', type: 'text', required: true, custom: true, section: 'basic', order: 10 },
    { key: 'c_year', label: 'Year', type: 'number', required: false, custom: true, section: 'basic', order: 20 },
    { key: 'c_photo', label: 'Photo', type: 'photo', required: false, custom: true, section: 'basic', order: 30, maxItems: 2 },
  ],
};
const def: FormDefinition = { form: 'msme.basicInfo', name: 'Basic Information', numbered: false, sections: [{ key: 'basic', label: 'Basic' }], fields: [machines], version: 'v1' };
const photo = (id: string) => ({ photoId: id, photoPath: `/p/${id}.jpg`, name: id });

describe('repeating entries of the Admin', () => {
  const entries = [{ c_name: ' Press ', c_year: '2019', c_photo: [photo('p1'), photo('p2')] }, { c_name: 'Lathe' }, {}];

  it('sends each entry with its photo ids and numbers', () => {
    expect(rowsForRequest(machines, entries)).toEqual([{ c_name: 'Press', c_year: 2019, c_photo: ['p1', 'p2'] }, { c_name: 'Lathe' }]);
    expect(customFieldsPayload(def, { cf_machines: entries }, () => undefined)).toEqual({ cf_machines: [{ c_name: 'Press', c_year: 2019, c_photo: ['p1', 'p2'] }, { c_name: 'Lathe' }] });
    expect(customFieldsPayload(def, { cf_machines: [] }, () => undefined)).toEqual({ cf_machines: null });
  });

  it('finds the photos to upload, with or without the form', () => {
    expect(customRowPhotos(def, { cf_machines: entries }, () => undefined).map(p => p.photoId)).toEqual(['p1', 'p2']);
    expect(photosInAnswers({ cf_machines: entries, cf_notes: 'text' }).map(p => p.photoId)).toEqual(['p1', 'p2']);
    expect(photosInAnswers(null)).toEqual([]);
  });

  it('asks for the required columns of every entry and at least one entry', () => {
    expect(validateForm(def, () => [{ c_year: '2019' }]).get('cf_machines')).toBe('Please fill in Machine name for every entry of Machines.');
    expect(validateForm(def, () => []).size).toBe(1);
    expect(validateForm(def, () => [{ c_name: 'Press' }]).size).toBe(0);
  });
});
