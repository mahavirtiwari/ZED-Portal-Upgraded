import { fieldOf } from '../src/screens/CorrectionsScreen';
import { FakeServer, makeApp } from './helpers/harness';
import { SA_ID, ZED_ID } from './helpers/fixtures';

const correction = {
  zedId: ZED_ID, certificationType: 'Silver', form: 'assessor.basicInfo', key: 'cf_machines', label: 'Machines on the floor', type: 'number',
  help: null, options: null, remarks: 'Count again', value: '12',
};

describe('answers the agency sent back (2026-11-16)', () => {
  it('lists every unit\'s corrections for the signed-in assessor and sends a corrected answer', async () => {
    const server = new FakeServer(r =>
      r.url.endsWith('/FormCorrections') ? { status: '1', corrections: [correction] } : r.url.endsWith('/SubmitFormCorrection') ? { status: '1' } : { status: '1' });
    const { app } = await makeApp(server);
    expect(await app.formCorrections()).toEqual([]);   // nobody signed in: nothing asked
    expect(server.last('/FormCorrections')).toBeUndefined();

    await app.signedInAs({ assessorId: SA_ID } as never, []);
    const list = await app.formCorrections();
    expect(list).toEqual([correction]);
    expect(server.last('/FormCorrections')!.json).toEqual(expect.objectContaining({ saId: SA_ID }));
    expect(server.last('/FormCorrections')!.json!.zedId).toBeUndefined();

    expect(await app.submitFormCorrection(list[0]!, '14')).toBeNull();
    expect(server.last('/SubmitFormCorrection')!.json).toEqual(expect.objectContaining({
      saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', form: 'assessor.basicInfo', key: 'cf_machines', value: '14',
    }));
  });

  it('shows the server\'s refusal', async () => {
    const server = new FakeServer(r =>
      r.url.endsWith('/SubmitFormCorrection') ? { status: '0', errorMessage: 'Machines on the floor: please enter a whole number.' } : { status: '1' });
    const { app } = await makeApp(server);
    await app.signedInAs({ assessorId: SA_ID } as never, []);
    expect(await app.submitFormCorrection(correction, 'many')).toBe('Machines on the floor: please enter a whole number.');
  });

  it('draws a correction as the Admin\'s field, required', () => {
    expect(fieldOf({ ...correction, type: 'dropdown', options: ['A', 'B'] })).toEqual(expect.objectContaining({
      key: 'cf_machines', type: 'dropdown', options: ['A', 'B'], required: true, custom: true,
    }));
  });
});
