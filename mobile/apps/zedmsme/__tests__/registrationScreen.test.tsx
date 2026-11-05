import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import type { MsmeApp } from '../src/app/MsmeApp';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';

jest.useFakeTimers();
jest.setTimeout(60000);

function render(app: MsmeApp) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <StackNavigator screens={SCREENS} initial={{ name: 'Registration' }} />
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
const handler = (r: ReactTestRenderer.ReactTestRenderer, id: string, prop: string) => r.root.findAll(n => n.props.testID === id && typeof n.props[prop] === 'function')[0]!;
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));
const type = (r: ReactTestRenderer.ReactTestRenderer, id: string, v: string) => act(() => handler(r, id, 'onChangeText').props.onChangeText(v));
const blur = (r: ReactTestRenderer.ReactTestRenderer, id: string) => act(() => handler(r, id, 'onBlur').props.onBlur());
const press = (r: ReactTestRenderer.ReactTestRenderer, id: string) => act(async () => handler(r, id, 'onPress').props.onPress());

const LOOKUP = {
  status: '1',
  BasicDetails: { UdyogAadharNo: 'UDYAM-UP-29-0003915', EnterpriseName: 'Acme Castings', EnterpriseType: 'Micro', OwnerName: 'A Kumar' },
  Plants: [{ PlantIdNo: 'P1', UnitName: 'Acme Unit 1', PAddress: 'Plot 4, Industrial Area', DISTRICT_NAME: 'KANPUR', state_name: 'UTTAR PRADESH', PPin: '208022' }],
  Activities: [{ Activity: 'Manufacturing', Two_DigitActivity: '24-Manufacture of basic metals', Four_DigitActivity: '2431', Five_DigitActivity: '24311' }],
};

describe('Registration (legacy look, immediate messages)', () => {
  it('shows the four-step status, the ZED banner and the Udyam link on the Welcome page', async () => {
    const { app } = await makeApp(new FakeServer());
    const r = render(app);
    expect(byTestId(r, 'page-status')).toHaveLength(1);
    expect(byTestId(r, 'udyam-link')).toHaveLength(1);
    expect(texts(r)).toContain('https://udyamregistration.gov.in');
    expect(texts(r)).toContain('BACK TO LOGIN');
  });

  it('flags a wrong Udyam number or mobile number while typing', async () => {
    const { app } = await makeApp(new FakeServer());
    const r = render(app);
    await press(r, 'footer-proceed');
    expect(texts(r)).toContain('(as provided at the time of Udyam Registration)');

    type(r, 'udyam-number', 'UDYAM-1');
    expect(texts(r)).toContain('Please enter a valid Udyam Registration Number.');
    type(r, 'udyam-number', 'udyam-up-29');
    expect(texts(r)).not.toContain('Please enter a valid Udyam Registration Number.');
    blur(r, 'udyam-number'); // left unfinished
    expect(texts(r)).toContain('Please enter a valid Udyam Registration Number.');
    type(r, 'udyam-number', 'UDYAM-UP-29-0003915');
    expect(texts(r)).not.toContain('Please enter a valid Udyam Registration Number.');

    type(r, 'udyam-mobile', '4');
    expect(texts(r)).toContain('Mobile Number cannot begin with 0-5');
    type(r, 'udyam-mobile', '98765');
    expect(texts(r)).not.toContain('Mobile Number cannot begin with 0-5');
    expect(handler(r, 'footer-proceed', 'onPress').props.disabled).toBe(true);
    blur(r, 'udyam-mobile');
    expect(texts(r)).toContain('Please enter a valid 10 digit mobile number.');
    type(r, 'udyam-mobile', '9876543210');
    expect(texts(r)).not.toContain('Please enter a valid 10 digit mobile number.');
    expect(handler(r, 'footer-proceed', 'onPress').props.disabled).toBe(false);
  });

  it('shows the plants and activities as selectable cards, then flags a wrong e-mail while typing', async () => {
    const server = new FakeServer(req => (req.url.endsWith('Msme/LookupUdyam') ? LOOKUP : { status: '1' }));
    const { app } = await makeApp(server);
    const r = render(app);
    await press(r, 'footer-proceed');
    type(r, 'udyam-number', 'UDYAM-UP-29-0003915');
    type(r, 'udyam-mobile', '9876543210');
    await press(r, 'footer-proceed');
    expect(byTestId(r, 'validated-note')).toHaveLength(1);
    expect(texts(r)).toContain('Select this Unit');
    expect(byTestId(r, 'activity-note')).toHaveLength(0);
    await press(r, 'plant-0-select');
    expect(texts(r)).toContain('Selected');
    expect(byTestId(r, 'activity-note')).toHaveLength(1);
    expect(texts(r)).toContain('24-Manufacture of basic metals');
    await press(r, 'activity-0-select');
    await press(r, 'footer-proceed');

    type(r, 'email', 'ple dge');
    expect(texts(r)).toContain('Not a valid email');
    type(r, 'email', 'pledge@acme');
    expect(texts(r)).not.toContain('Not a valid email');
    blur(r, 'email');
    expect(texts(r)).toContain('Not a valid email');
    type(r, 'email', 'pledge@acme.test');
    expect(texts(r)).not.toContain('Not a valid email');
    type(r, 'email-again', 'pledge@');
    expect(texts(r)).not.toContain('Email ID is not matching');
    type(r, 'email-again', 'pledge@x');
    expect(texts(r)).toContain('Email ID is not matching');
    type(r, 'email-again', 'pledge@acme.test');
    expect(texts(r)).not.toContain('Email ID is not matching');
    await press(r, 'email-proceed');
    expect(server.last('Msme/SendPledgeEmailOtp')!.json).toEqual({ email: 'pledge@acme.test' });
    expect(texts(r)).toContain('If you have not received the OTP, then please re-check the Email ID.');
    type(r, 'otp', 'ab12');
    await press(r, 'otp-submit');

    // Summary: each section with its edit pencil; the e-mail one reopens the e-mail dialog.
    expect(byTestId(r, 'registration-page-3')).toHaveLength(1);
    expect(texts(r)).toContain('Provided Email ID');
    expect(texts(r)).toContain('Selected Unit');
    expect(texts(r)).toContain('Selected Activity');
    await press(r, 'summary-email-heading-edit');
    expect(byTestId(r, 'email-dialog')).toHaveLength(1);
  });
});
