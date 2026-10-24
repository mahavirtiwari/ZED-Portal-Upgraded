import { certificationCardState } from '../src/components/CertificationCard';
import {
  associatedIdOf,
  basicInformationIsValid,
  newBasicInformation,
  normalizeElements,
  normalizeNcDetails,
  plantAddress,
  preFinalSubmitIsValid,
  setNcDetails,
  Status,
  updateCertificationDetails,
  type CertificationDetails,
  type MsmeStatus,
} from '../src/models';
import { bronzeAction } from '../src/screens/MyCertificationsScreen';
import { paymentSummary } from '../src/screens/PaymentScreen';

const cert = (over: Partial<CertificationDetails> = {}): CertificationDetails => ({
  status: 1,
  nc1Status: 0,
  nc2Status: 0,
  nc3Status: 0,
  nc4Status: 0,
  nc5Status: 0,
  finalSubmitDone: false,
  ...over,
});

const photo = { photoId: 'p', associatedId: 'a', status: 0, isPdf: false };

describe('My Certifications card (CertificationStatusHandler / handleCertificationAction)', () => {
  it('Bronze at status 1: "Basic Information & Document Upload", current step once basic information exists', () => {
    expect(certificationCardState(cert(), true, false)).toMatchObject({ statusText: 'Basic Information & Document Upload', one: 'default', two: null, three: null, five: 'default' });
    expect(certificationCardState(cert({ basicInformation: newBasicInformation() }), true, false).one).toBe('current');
    expect(certificationCardState(cert({ finalSubmitDone: true }), true, false).one).toBe('completed');
  });
  it('Bronze at status 2 shows the NC mark when an NC is active; 3 and 5 are completed (5 with overlay)', () => {
    expect(certificationCardState(cert({ status: 2, nc1Status: 1 }), true, false)).toMatchObject({ statusText: 'Desktop Verification', five: 'nc' });
    expect(certificationCardState(cert({ status: 2 }), true, false).five).toBe('current');
    expect(certificationCardState(cert({ status: 3 }), true, true)).toMatchObject({ statusText: 'Completed', overlay: false });
    expect(certificationCardState(cert({ status: 5 }), true, true)).toMatchObject({ statusText: 'Completed', overlay: true });
  });
  it('apply when there are no details or all levels are inactive, arrow for status 1-4, nothing otherwise', () => {
    expect(bronzeAction(null)).toBe('apply');
    const s = (b: number, silver?: number, gold?: number): MsmeStatus =>
      ({ financialAssistanceStatus: 0, bronze: cert({ status: b }), silver: silver == null ? null : cert({ status: silver }), gold: gold == null ? null : cert({ status: gold }) }) as MsmeStatus;
    expect(bronzeAction(s(0, 0, 0))).toBe('apply');
    expect(bronzeAction(s(0))).toBe('none'); // silver/gold missing: not "all inactive"
    expect(bronzeAction(s(1))).toBe('arrow');
    expect(bronzeAction(s(4))).toBe('arrow');
    expect(bronzeAction(s(5))).toBe('none');
  });
});

describe('models', () => {
  it('basic information is valid only with every required part (BasicInformation.isValid)', () => {
    const b = newBasicInformation();
    expect(basicInformationIsValid(b)).toBe(false);
    Object.assign(b, {
      assessorSelfie: photo,
      auditsConducted: 'Yes',
      productDetailsList: [{ id: '1', productName: 'P', exported: 'No', productPhoto: photo, productDescriptionPhoto: photo }],
      domesticCustomers: 'C',
      rawMaterialImported: 'No',
      monthlyManufacturingCapacityUnits: 'Number',
      monthlyManufacturingCapacityValue: '1',
      monthlyUtilizationUnits: 'Number',
      monthlyUtilizationValue: '1',
      energySources: ['Solar'],
      siteExteriorPhotos: [photo],
    });
    expect(basicInformationIsValid(b)).toBe(true);
    b.productDetailsList[0]!.exported = 'Yes'; // then international customers are required
    expect(basicInformationIsValid(b)).toBe(false);
    b.internationalCustomers = 'X';
    expect(basicInformationIsValid(b)).toBe(true);
    b.rawMaterialImported = 'Yes'; // then at least one raw material
    expect(basicInformationIsValid(b)).toBe(false);
  });

  it('updateCertificationDetails takes the server statuses and keeps the local work', () => {
    const local = { financialAssistanceStatus: 0, bronze: cert({ basicInformation: newBasicInformation(), parameters: [] }) } as MsmeStatus;
    updateCertificationDetails(local, { financialAssistanceStatus: 2, bronze: cert({ status: 3, certificate: 'c', nc2Status: 1 }) } as MsmeStatus);
    expect(local.bronze).toMatchObject({ status: 3, certificate: 'c', nc2Status: 1 });
    expect(local.bronze!.basicInformation).not.toBeNull();
    expect(local.financialAssistanceStatus).toBe(2);
  });

  it('setNcDetails files the answer under the open NC and prepares the site photo list', () => {
    const c = cert({ nc1Status: 2, nc2Status: 1 });
    setNcDetails(c, normalizeNcDetails({ status: '1', siteExteriorPhotos: ['a.jpg'], products: [{ id: undefined as never, productId: 7 as never, productName: 'P' }] }));
    expect(c.ncTwoDetails).toBe(c.activeNcDetails);
    expect(c.ncOneDetails).toBeUndefined();
    expect(c.activeNcDetails!.siteExteriorPhotoData).toEqual([]);
    expect(c.activeNcDetails!.products![0]).toMatchObject({ productId: '7', status: Status.TO_START });
  });

  it('reads numeric ids and codes as strings, as Gson did', () => {
    const [e] = normalizeElements([{ id: 1 as never, code: 2 as never, requirements: [{ id: 3 as never, code: 4 as never, evidences: [{ id: 5 as never, code: 6 as never }] }] }])!;
    expect(e).toMatchObject({ id: '1', code: '2', requirements: [{ id: '3', code: '4', evidences: [{ id: '5', code: '6', validationRequired: false }] }] });
  });

  it('pre-final-submit data rules (EvidenceFinalSubmitData.isValid)', () => {
    expect(preFinalSubmitIsValid({ isSubmitted: false })).toBe(false);
    expect(preFinalSubmitIsValid({ isSubmitted: false, financialAssistanceAvailed: 'Yes' })).toBe(true);
    expect(preFinalSubmitIsValid({ isSubmitted: false, financialAssistanceAvailed: 'No', anyDocuments: 'No' })).toBe(true);
    expect(preFinalSubmitIsValid({ isSubmitted: false, financialAssistanceAvailed: 'No', anyDocuments: 'Yes', documentTypes: [] })).toBe(false);
    expect(preFinalSubmitIsValid({ isSubmitted: false, financialAssistanceAvailed: 'No', anyDocuments: 'Yes', documentTypes: ['x'] })).toBe(true);
  });

  it('owner id and address as the Kotlin string templates built them', () => {
    expect(associatedIdOf({ MsmeDetails: { MsmeId: '1', ZedId: 'Z' }, remoteAssessmentData: { isSelfieSubmitted: false } })).toBe('1Z');
    expect(associatedIdOf({ MsmeDetails: { ZedId: 'Z' }, remoteAssessmentData: { isSelfieSubmitted: false } })).toBe('nullZ');
    expect(plantAddress({ PAddress: 'Plot 1', DISTRICT_NAME: 'D', state_name: '', PPin: '1' })).toBe('Plot 1\nD, 1');
  });
});

describe('payment summary (showPaymentSummary)', () => {
  const details = {
    Id: 5,
    EnterpriseTypee: 'Small',
    Certification: 'Bronze',
    AssessmentFee: 10000,
    Gst: 1800,
    Total: 11800,
    Coupon: 10000,
    TotalAfterCoupon: 1800,
    SubsidyPercentage: 80,
    ApplicantContributionAfterSubsidy: 360,
    GstAfterSubsidy: 54.9,
    Tds15: 7.2,
    Tds75: 36,
    NetPaybleTds15: 352.8,
    NetPaybleTds75: 324,
  };
  it('lists the rows and the net payable amount, with TDS when chosen', () => {
    const s = paymentSummary(details, null, 'Bronze');
    expect(s.rows.map(r => [r.label, r.value])).toEqual([
      ['Certification Fee', '₹ 11800'],
      ['Joining Reward', '₹ 10000'],
      ['Final Certification Fee\n(After adjusting joining reward)', '₹ 1800'],
      ['Subsidy (80%)\n(On Final certification fee)', '₹ -1440'],
      ['Amount Payable', '₹ 360'],
      ['Amount', '₹ 305.1'],
      ['GST(18%)', '₹ 54.9'],
      ['Net Payable Amount', '₹ 360'],
    ]);
    const t = paymentSummary(details, '2', 'Bronze');
    expect(t.due).toBe(352.8);
    expect(t.rows.find(r => r.key === 'tds')).toMatchObject({ label: 'TDS Deducted (2%)', value: '₹ 7.2' });
    expect(paymentSummary({ ...details, Coupon: 0 }, '10', 'Bronze').rows.some(r => r.key === 'reward')).toBe(false);
  });
});
