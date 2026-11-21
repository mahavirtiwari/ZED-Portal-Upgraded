import React, { useState } from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { ConsultantOrganisationsResponse } from '../src/api';
import { MsmeApi } from '../src/api';
import {
  CO_ANSWER_REQUIRED,
  CO_CHOICE_REQUIRED,
  CoAssistQuestion,
  NO_CO_ANSWER,
  coAnswerFields,
  coAnswerProblem,
  filterOrganisations,
  type CoAnswer,
} from '../src/components/CoAssistQuestion';

const ORGS = [
  { userId: 'CO_A', userName: 'Alpha Consultants' },
  { userId: 'CO_C', userName: 'Gamma Partners' },
];

/** The question with its answer kept as a payment screen keeps it. */
function render(load: () => Promise<ConsultantOrganisationsResponse>) {
  const answers: CoAnswer[] = [];
  function Host() {
    const [value, setValue] = useState<CoAnswer>(NO_CO_ANSWER);
    return (
      <CoAssistQuestion
        value={value}
        onChange={a => {
          answers.push(a);
          setValue(a);
        }}
        load={load}
      />
    );
  }
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(<Host />);
  });
  return { r, answers };
}

const byId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findByProps({ testID: id });
const has = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAllByProps({ testID: id }).length > 0;
const texts = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map(t => [t.props.children].flat().join(''));
const flush = () => act(async () => { await Promise.resolve(); });

describe('handholding milestone 1: "Did any Consultant Organisation assist you?"', () => {
  it('is required, and Yes needs an organisation; the request carries the answer', () => {
    expect(coAnswerProblem(NO_CO_ANSWER)).toBe(CO_ANSWER_REQUIRED);
    expect(coAnswerProblem({ assisted: 'yes', coId: null })).toBe(CO_CHOICE_REQUIRED);
    expect(coAnswerProblem({ assisted: 'yes', coId: 'CO_A' })).toBeNull();
    expect(coAnswerProblem({ assisted: 'no', coId: null })).toBeNull();
    expect(coAnswerFields({ assisted: 'yes', coId: 'CO_A' })).toEqual({ AssistedByCo: 'Yes', AssistedCoId: 'CO_A' });
    expect(coAnswerFields({ assisted: 'no', coId: null })).toEqual({ AssistedByCo: 'No', AssistedCoId: null });
  });

  it('filters the organisations by name or ID', () => {
    expect(filterOrganisations(ORGS, '')).toEqual(ORGS);
    expect(filterOrganisations(ORGS, 'gamma').map(o => o.userId)).toEqual(['CO_C']);
    expect(filterOrganisations(ORGS, ' co_a ').map(o => o.userId)).toEqual(['CO_A']);
    expect(filterOrganisations(ORGS, 'zeta')).toEqual([]);
  });

  it('asks the question, loads the list once on Yes, searches it and keeps the choice', async () => {
    const load = jest.fn(async () => ({ status: '1', organisations: ORGS }) as ConsultantOrganisationsResponse);
    const { r, answers } = render(load);
    expect(texts(r)).toContain('Did any Consultant Organisation assist you?');
    expect(has(r, 'co-picker')).toBe(false);

    act(() => byId(r, 'co-yes').props.onPress());
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(has(r, 'co-CO_A') && has(r, 'co-CO_C')).toBe(true);

    act(() => byId(r, 'co-search').props.onChangeText('GAM'));
    expect(has(r, 'co-CO_A')).toBe(false);
    act(() => byId(r, 'co-CO_C').props.onPress());
    expect(answers.at(-1)).toEqual({ assisted: 'yes', coId: 'CO_C' });
    expect(byId(r, 'co-chosen').props.children).toBe('Chosen: Gamma Partners (CO_C)');

    act(() => byId(r, 'co-search').props.onChangeText('zeta'));
    expect(texts(r)).toContain('No Consultant Organisation matches the search.');

    act(() => byId(r, 'co-no').props.onPress());
    expect(answers.at(-1)).toEqual({ assisted: 'no', coId: null });
    expect(has(r, 'co-picker')).toBe(false);
    act(() => byId(r, 'co-yes').props.onPress());
    await flush();
    expect(load).toHaveBeenCalledTimes(1);   // not asked again
  });

  it('shows the server refusal and tries again', async () => {
    const load = jest
      .fn<Promise<ConsultantOrganisationsResponse>, []>()
      .mockResolvedValueOnce({ status: '0', errorMessage: 'The Consultant Organisation is asked only at the payment of milestone 1.' })
      .mockResolvedValueOnce({ status: '1', organisations: [] });
    const { r } = render(load);
    act(() => byId(r, 'co-yes').props.onPress());
    await flush();
    expect(texts(r).some(t => t.startsWith('The Consultant Organisation is asked only at the payment of milestone 1.'))).toBe(true);

    act(() => byId(r, 'co-retry').props.onPress());
    await flush();
    expect(texts(r)).toContain('No Consultant Organisation can be chosen now.');
  });

  it('asks the portal for the list of the unit and level', async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    const http = { postJson: async (url: string, body: unknown) => { posted.push({ url, body }); return { status: '1', organisations: [] }; } };
    const api = new MsmeApi({ baseUrl: 'https://zedv3.qci.org.in' } as never, () => ({}) as never, http as never);
    await api.getConsultantOrganisations('Silver', 'ZEDMSME000001');
    expect(posted).toEqual([{ url: expect.stringMatching(/ConsultancyPay\/GetConsultantOrganisations$/), body: { certification: 'Silver', zedId: 'ZEDMSME000001' } }]);
  });
});
