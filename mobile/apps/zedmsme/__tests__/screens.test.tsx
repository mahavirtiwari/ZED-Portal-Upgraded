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
    // The Dashboard, with the Enterprise Profile on top (fromLogin).
    expect(byTestId(r, 'dashboard')).toHaveLength(1);
    expect(byTestId(r, 'my-account')).toHaveLength(1);
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

  it('My Certifications shows Bronze, Silver and Gold and the pledge certificate', async () => {
    const app = await signedInApp();
    const r = render(app, 'MyCertifications');
    for (const id of ['bronze-card', 'silver-card', 'gold-card', 'pledge-download']) expect(byTestId(r, id)).toHaveLength(1);
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
