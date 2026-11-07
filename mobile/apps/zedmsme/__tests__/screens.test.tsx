import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import NetInfo from '@react-native-community/netinfo';
import { formatDate, StackNavigator, UiHost, zedDevice } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { certificationDetailsOf, Status } from '../src/models';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

async function signedInApp(server = new FakeServer()) {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  return app;
}

function render(app: MsmeApp, name: string, params?: Record<string, unknown>) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name, params }} overlay={<AppDrawerOverlay />} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

/** Host elements with the testID (composite wrappers pass the same testID down). */
const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
/** The element with the testID that handles presses / text changes. */
const handler = (r: ReactTestRenderer.ReactTestRenderer, id: string, prop: string) => r.root.findAll(n => n.props.testID === id && typeof n.props[prop] === 'function')[0]!;
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

describe('CertificationOptionsFragment', () => {
  it('shows only the options the certification status allows', async () => {
    const app = await signedInApp();
    const c = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
    c.report = 'r.pdf';
    c.surveillanceStatus = '1';
    c.surveillanceDate = formatDate(new Date(), 'MM/dd/yyyy hh:mm:ss a');
    const r = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
    expect(byTestId(r, 'option-basic-info')).toHaveLength(1);
    expect(byTestId(r, 'option-nc')).toHaveLength(0); // no active NC: the option is gone
    expect(byTestId(r, 'option-certificate')).toHaveLength(0); // no certificate URL
    expect(byTestId(r, 'option-report')).toHaveLength(1);
    expect(byTestId(r, 'option-surveillance')).toHaveLength(0); // the surveillance apps' work, not the applicant's
    expect(byTestId(r, 'option-remote')).toHaveLength(0);
    expect(texts(r)).toContain('Basic Information & Document Upload');
  });

  it('opens the evidences when the basic information was submitted and no final submit happened', async () => {
    const app = await signedInApp();
    const r = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
    await act(async () => handler(r, 'option-basic-info', 'onPress').props.onPress());
    expect(byTestId(r, 'evidences')).toHaveLength(1);
    expect(texts(r)).toContain('Documents Upload');
  });
});

describe('EvidencesActivity', () => {
  it('lists the evidences with their state and keeps final submit hidden until all are sent or not available', async () => {
    const app = await signedInApp();
    const r = render(app, 'Evidences', { certificationType: 'Bronze' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(texts(r)).toEqual(expect.arrayContaining(['Photo of the test process document', 'Already sent', 'Sync your offline changes now']));
    expect(byTestId(r, 'final-submit')).toHaveLength(0);

    const ev = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!.parameters![0]!.requirements![0]!.evidences![0]!;
    ev.status = Status.SUBMITTED;
    await act(async () => app.touch());
    expect(byTestId(r, 'final-submit')).toHaveLength(1);
    expect(handler(r, 'final-submit', 'onPress').props.disabled).toBe(true);
  });

  it('offline: shows the red offline note and the legacy reminder instead of UPLOAD', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
    const app = await signedInApp();
    const r = render(app, 'Evidences', { certificationType: 'Bronze' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(byTestId(r, 'offline-note')).toHaveLength(1);
    expect(texts(r)).toContain('Don’t forget to sync your offline changes once you are connected to the Internet again.');
    expect(byTestId(r, 'evidence-0-upload')).toHaveLength(0);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  });
});

describe('Login (LoginFragment)', () => {
  it('stops at the first blank field and signs in offline with the stored credential', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
    const loginDb = await memoryDb();
    const mediaDb = await memoryDb();
    await writeLegacyLoginRow(loginDb, 'PW');
    await writeLegacyPhotoRows(mediaDb);
    const { app } = await makeApp(new FakeServer(), { loginDb, mediaDb });
    const r = render(app, 'Launcher');
    act(() => {
      jest.advanceTimersByTime(2500); // splash
    });
    expect(byTestId(r, 'login-button')).toHaveLength(1);
    const type = (id: string, v: string) => act(() => handler(r, id, 'onChangeText').props.onChangeText(v));
    await act(async () => handler(r, 'login-button', 'onPress').props.onPress());
    expect(byTestId(r, 'dashboard')).toHaveLength(0);
    type('login-zed-id', ZED_ID.toLowerCase());
    type('login-password', 'pw');
    await act(async () => {
      await handler(r, 'login-button', 'onPress').props.onPress();
    });
    expect(app.loginId).toBe(ZED_ID);
    // The Dashboard itself (2026-11-07: no Enterprise Profile on top any more; it is in the menu).
    expect(byTestId(r, 'dashboard')).toHaveLength(1);
    expect(byTestId(r, 'my-account')).toHaveLength(0);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  });
});

describe('ZED MSME applicant screens', () => {
  const type = (r: ReactTestRenderer.ReactTestRenderer, id: string, v: string) => act(() => handler(r, id, 'onChangeText').props.onChangeText(v));
  const press = (r: ReactTestRenderer.ReactTestRenderer, id: string) => act(async () => handler(r, id, 'onPress').props.onPress());

  it('login asks for the ZED ID and password only and offers Forgot Password and Register Now', async () => {
    const { app } = await makeApp(new FakeServer());
    const r = render(app, 'Launcher');
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(byTestId(r, 'login-assessor-id')).toHaveLength(0);
    expect(byTestId(r, 'forgot-password')).toHaveLength(1);
    await press(r, 'register-now');
    expect(byTestId(r, 'registration-page-0')).toHaveLength(1);
  });

  it('Forgot Password opens again after going back to the login', async () => {
    const { app } = await makeApp(new FakeServer());
    const r = render(app, 'Launcher');
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    for (let i = 0; i < 3; i++) {
      await press(r, 'forgot-password');
      expect(byTestId(r, 'forgot-password-screen')).toHaveLength(1);
      await press(r, 'footer-back');
      expect(byTestId(r, 'forgot-password-screen')).toHaveLength(0);
    }
  });

  it('registers with the Udyam record the server looked up, an OTP-verified e-mail and the pledge', async () => {
    const server = new FakeServer(req => {
      if (req.url.endsWith('Msme/LookupUdyam'))
        return {
          status: '1',
          BasicDetails: { UdyogAadharNo: 'UDYAM-UP-29-0003915', EnterpriseName: 'Acme Castings', EnterpriseType: 'Micro', OwnerName: 'A Kumar' },
          Plants: [{ PlantIdNo: 'P1', UnitName: 'Acme Unit 1', PAddress: 'Plot 4, Industrial Area' }],
          Activities: [{ Activity: 'Manufacturing', Two_DigitActivity: '24', Four_DigitActivity: '2431', Five_DigitActivity: '24311' }],
        };
      return { status: '1' };
    });
    const { app } = await makeApp(server);
    const r = render(app, 'Registration');
    await press(r, 'footer-proceed'); // Welcome
    expect(byTestId(r, 'registration-page-1')).toHaveLength(1);
    type(r, 'udyam-number', 'udyam-up-29-0003915');
    type(r, 'udyam-mobile', '5999999999');
    expect(texts(r)).toContain('Mobile Number cannot begin with 0-5');
    type(r, 'udyam-mobile', '9999999999');
    await press(r, 'footer-proceed');
    expect(server.last('Msme/LookupUdyam')!.json).toEqual({ udyamNumber: 'UDYAM-UP-29-0003915', mobileNo: '9999999999' });
    expect(texts(r)).toContain('Acme Unit 1');

    await press(r, 'plant-0-select');
    await press(r, 'activity-0-select');
    await press(r, 'footer-proceed');
    expect(server.last('Msme/ValidatePlantAndActivity')!.json).toEqual({ UdyogAadharNo: 'UDYAM-UP-29-0003915', PlantIdNo: 'P1', TwoDigitActivity: '24' });

    type(r, 'email', 'pledge@acme.test');
    type(r, 'email-again', 'other@acme.test');
    await press(r, 'email-proceed');
    expect(texts(r)).toContain('Email ID is not matching');
    type(r, 'email-again', 'pledge@acme.test');
    await press(r, 'email-proceed');
    expect(server.last('Msme/SendPledgeEmailOtp')!.json).toEqual({ email: 'pledge@acme.test' });
    type(r, 'otp', 'ab12');
    await press(r, 'otp-submit');
    expect(server.last('Msme/VerifyPledgeEmailOtp')!.json).toEqual({ email: 'pledge@acme.test', otp: 'AB12' });

    expect(byTestId(r, 'registration-page-3')).toHaveLength(1);
    expect(handler(r, 'footer-proceed', 'onPress').props.disabled).toBe(true);
    act(() => handler(r, 'summary-confirm', 'onChange').props.onChange(true));
    await press(r, 'footer-proceed'); // to the pledge
    await press(r, 'footer-proceed'); // I/We Pledge
    const submit = server.last('Msme/FinalSubmit')!.json!;
    expect(submit).toMatchObject({
      PledgeEmailId: 'pledge@acme.test',
      RegistrationType: 'UDYAM',
      RegistrationFrom: 'Android',
      BasicDetails: { UdyogAadharNo: 'UDYAM-UP-29-0003915', MobileNo: '9999999999' },
      PlantDetails: { PlantIdNo: 'P1' },
      ActivityDetails: { Two_DigitActivity: '24' },
    });
    expect(byTestId(r, 'registration-success')).toHaveLength(1);
  });

  it('greys out a registered plant and an activity the scheme does not cover, with the reason', async () => {
    const server = new FakeServer(req => {
      if (req.url.endsWith('Msme/LookupUdyam'))
        return {
          status: '1',
          BasicDetails: { UdyogAadharNo: 'UDYAM-UP-29-0003915', EnterpriseName: 'Acme Foods', EnterpriseType: 'Micro', OwnerName: 'A Kumar' },
          Plants: [
            { PlantIdNo: 'P1', UnitName: 'Acme Unit 1', PAddress: 'Plot 4', V4RegisteredZedId: 'ZEDM•••123' },
            { PlantIdNo: 'P2', UnitName: 'Acme Unit 2', PAddress: 'Plot 9' },
          ],
          Activities: [
            { Activity: 'Trading', Two_DigitActivity: '46-Wholesale trade', V4NotEligible: 'Currently this scheme is not applicable for the selected plant activity.' },
            { Activity: 'Manufacturing', Two_DigitActivity: '10-Manufacture of food products' },
          ],
        };
      return { status: '1' };
    });
    const { app } = await makeApp(server);
    const r = render(app, 'Registration');
    await press(r, 'footer-proceed');
    type(r, 'udyam-number', 'UDYAM-UP-29-0003915');
    type(r, 'udyam-mobile', '9999999999');
    await press(r, 'footer-proceed');

    expect(texts(r)).toContain('Already registered: ZEDM•••123. Log in with its ZED ID.');
    expect(handler(r, 'plant-0-select', 'onPress').props.disabled).toBe(true);
    await press(r, 'plant-1-select');
    expect(texts(r)).toContain('Currently this scheme is not applicable for the selected plant activity.');
    expect(handler(r, 'activity-0-select', 'onPress').props.disabled).toBe(true);
    await press(r, 'activity-1-select');
    await press(r, 'footer-proceed');
    expect(server.last('Msme/ValidatePlantAndActivity')!.json).toEqual({ UdyogAadharNo: 'UDYAM-UP-29-0003915', PlantIdNo: 'P2', TwoDigitActivity: '10-Manufacture of food products' });
  });

  it('Forgot Password finds the units of a PAN and shows the partly hidden e-mail the link went to', async () => {
    const server = new FakeServer(req => {
      if (req.url.endsWith('Msme/FindAccounts'))
        return {
          status: '1',
          Units: [
            { Ref: 'r1', UnitName: 'Acme Foods Unit 1', District: 'East Delhi', State: 'Delhi', ZedId: 'ZEDM•••123' },
            { Ref: 'r2', UnitName: 'Acme Foods Unit 2', District: 'Kanpur', State: 'Uttar Pradesh', ZedId: 'ZEDM•••456' },
          ],
        };
      if (req.url.endsWith('Msme/SendResetLink')) return { status: '1', MaskedEmail: 'ra•••••@gm•••.com' };
      return { status: '1' };
    });
    const { app } = await makeApp(server);
    const r = render(app, 'ForgotPassword');
    await press(r, 'find-by-pan');
    type(r, 'forgot-zed-id', 'abcde1234f');
    await press(r, 'footer-proceed');
    expect(server.last('Msme/FindAccounts')!.json).toEqual({ by: 'pan', value: 'abcde1234f' });
    expect(texts(r)).toContain('Acme Foods Unit 2');
    expect(texts(r)).toContain('ZEDM•••456');
    expect(handler(r, 'footer-proceed', 'onPress').props.disabled).toBe(true);
    await act(async () => r.root.findAll(n => n.props.testID === 'found-unit' && typeof n.props.onPress === 'function')[1]!.props.onPress());
    await press(r, 'footer-proceed');
    expect(server.last('Msme/SendResetLink')!.json).toEqual({ reference: 'r2' });
    expect(byTestId(r, 'reset-link-sent')).toHaveLength(1);
    expect(texts(r)).toContain('ra•••••@gm•••.com');
  });

  it('Enterprise Profile shows the web sections and changes the e-mail only after the OTP; Edit History lists the changes', async () => {
    const server = new FakeServer(req => {
      if (req.url.endsWith('Msme/AppProfile'))
        return {
          status: '1',
          Msme: { ZedId: 'ZEDM000001', PUnitName: 'Pump Engineers', PAddress: 'New Ashok Nagar', PDistrictName: 'EAST', PStateName: 'DELHI', PPin: '110092', TwoDigitActivity: '10-Food', FiveDigitActivity: '10202' },
          BasicInfo: { EnterpriseName: 'Pump Enterprise Private Limited', UdyogAadharNo: 'UDYAM-UP-16-0001476', Address: 'Basti', TotalEmp: '12' },
          RegisteredEmail: 'old@acme.test',
        };
      if (req.url.endsWith('Msme/AppEmailOtp')) return { status: '1', SentTo: 'new@acme.test' };
      if (req.url.endsWith('Msme/AppEmailVerify')) return { status: '1', Email: 'new@acme.test' };
      if (req.url.includes('Msme/AppEditHistory'))
        return { status: '1', Total: 1, Rows: [{ Id: 1, At: '2026-11-07T01:28:00Z', Channel: 'Mobile', Action: 'App: password changed', Result: 'Success', Data: '{"req":{"userName":"ZEDM000001","newPassword":"***"}}' }] };
      return { status: '1' };
    });
    const app = await signedInApp(server);
    const r = render(app, 'MyAccount');
    await act(async () => {
      await Promise.resolve();
    });
    expect(texts(r)).toContain('Pump Enterprise Private Limited');
    expect(texts(r)).toContain('Pump Engineers');
    expect(texts(r)).toContain('New Ashok Nagar, EAST, DELHI, 110092');
    expect(texts(r)).not.toContain('12');
    await press(r, 'profile-show-all');
    expect(texts(r)).toContain('12');

    await press(r, 'email-change');
    type(r, 'new-email', 'new@acme.test');
    await press(r, 'email-send-otp');
    expect(server.last('Msme/AppEmailOtp')!.json).toEqual({ email: 'new@acme.test' });
    expect(texts(r)).toContain('old@acme.test');
    type(r, 'email-otp', '123456');
    await press(r, 'email-verify');
    expect(server.last('Msme/AppEmailVerify')!.json).toEqual({ otp: '123456' });
    expect(texts(r)).toContain('new@acme.test');

    const h = render(app, 'EditHistory');
    await act(async () => {
      await Promise.resolve();
    });
    expect(texts(h)).toContain('Password changed');
    await press(h, 'history-item');
    expect(texts(h).join(' ')).not.toContain('***');
  });

  it('My Certifications shows Bronze, Silver and Gold and the pledge certificate', async () => {
    const app = await signedInApp();
    const r = render(app, 'MyCertifications');
    for (const id of ['bronze-card', 'silver-card', 'gold-card', 'pledge-download']) expect(byTestId(r, id)).toHaveLength(1);
    // The info icon on a level's strip opens its info (showCertificationInfo).
    await press(r, 'silver-card-info');
    expect(byTestId(r, 'certification-info')).toHaveLength(1);
    expect(texts(r)).toContain('This level has 14 parameters, which need to be conformed to, for achieving a Certification.');
  });

  it('My Documents lists the guidelines and certificates and downloads one with the sign-in token', async () => {
    const server = new FakeServer(req =>
      req.url.endsWith('GetMyDocuments')
        ? {
            Guidelines: [{ DocumentName: 'ZED Guidelines', DocumentPath: 'https://zedv3.qci.org.in/Uploads/Documents/Guide.pdf', OrderNo: 1 }],
            Certificates: [{ Pledge: 'https://zedv3.qci.org.in/Certificates/X/Pledge.pdf', Bronze: 'https://zedv3.qci.org.in/Certifications/DA/X/Bronze.pdf', Silver: null }],
          }
        : { status: '1' },
    );
    const app = await signedInApp(server);
    await app.session.signedIn(ZED_ID, 'h1.token');
    const download = jest.spyOn(zedDevice(), 'downloadFile');
    const r = render(app, 'MyDocuments');
    await act(async () => {
      await Promise.resolve();
    });
    expect(server.last('GetMyDocuments')!.json).toEqual({ zedId: ZED_ID });
    expect(byTestId(r, 'guideline-0')).toHaveLength(1);
    expect(byTestId(r, 'certificate-Pledge')).toHaveLength(1);
    expect(byTestId(r, 'certificate-Silver')).toHaveLength(0);
    await press(r, 'certificate-Bronze');
    expect(download).toHaveBeenCalledWith(
      'http://10.0.2.2:5106/Msme/AppDocument?path=' + encodeURIComponent('https://zedv3.qci.org.in/Certifications/DA/X/Bronze.pdf'),
      'Bronze.pdf',
      'h1.token',
    );
  });

  it('Change Password sends the current and new password and then sends the user to the login', async () => {
    const server = new FakeServer();
    const app = await signedInApp(server);
    const r = render(app, 'ChangePassword');
    type(r, 'current-password', 'Old#Pass1');
    type(r, 'new-password', 'New#Pass1');
    type(r, 'new-password-again', 'New#Pass2');
    expect(handler(r, 'footer-proceed', 'onPress').props.disabled).toBe(true);
    type(r, 'new-password-again', 'New#Pass1');
    await press(r, 'footer-proceed');
    expect(server.last('mobileapi/msme/ChangePassword')!.json).toMatchObject({ userName: ZED_ID, oldPassword: 'Old#Pass1', newPassword: 'New#Pass1' });
    expect(byTestId(r, 'password-changed')).toHaveLength(1);
  });
});
