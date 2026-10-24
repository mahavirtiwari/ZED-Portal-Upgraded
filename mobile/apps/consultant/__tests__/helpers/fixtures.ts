import { Status, type AssessmentDetails } from '../../src/models';

export const SA_ID = 'ZEDRNCL01';
export const CO_ID = 'ZEDRNCC01';
export const ZED_ID = 'ZEDRNCS0001';

/** What V4 ConsultancySAController.Login answers for a lead consultant after the allocation (first milestone). */
export function loginAnswer(over: Partial<AssessmentDetails> = {}): AssessmentDetails {
  return {
    status: '1',
    userType: 1,
    milestone: 1,
    certificationType: 'Silver',
    isSelfieSubmitted: false,
    isOpenMeetingSubmitted: false,
    isCloseMeetingSubmitted: false,
    isSiteTourSubmitted: false,
    isBasicInfoSubmitted: false,
    technologyUpgradationStatus: Status.TO_START,
    companyProfile: {
      saDate: '10/24/2026 09:00:00 AM',
      bdsFromDate: '10/24/2026 12:00:00 AM',
      bdsToDate: '10/31/2026 12:00:00 AM',
      hapFromDate: '11/01/2026 12:00:00 AM',
      hapToDate: '11/15/2026 12:00:00 AM',
      zedId: ZED_ID,
      msmeName: 'RN Consultancy Unit Pvt Ltd',
      sectorName: 'Manufacture of fabricated metal products',
      sectorId: '25',
      unitAddress: 'Plot 2, Test Road, NEW DELHI, DELHI 110001',
      address: 'Plot 2, Test Road',
      stateName: 'DELHI',
      districtName: 'NEW DELHI',
      pincode: '110001',
      email: 'dev.zed@qcin.org',
      phone: '9000000003',
    },
    assessors: [
      { assessorId: SA_ID, assessorName: 'RN Lead Consultant', userType: '1' },
      { assessorId: CO_ID, assessorName: 'RN Co Consultant', userType: '2' },
    ],
    allottedParameters: [
      {
        parameterId: '9101',
        parameterName: 'Test Parameter One',
        parameterType: 'Mandatory',
        parameterCode: '1',
        status: 0,
        isSelectedToSubmit: false,
        requirements: [
          { id: 9201 as never, code: 'R1', options: [{ id: 9301, code: '1', label: 'The unit has a documented test process', subOptions: [{ id: 1, code: 'a', label: 'Written procedure' }] }], reviewNeeded: false },
          { id: 9202 as never, code: 'R2', options: [{ id: 9302, code: '1', label: 'The unit keeps test records' }], reviewNeeded: false },
        ],
      },
      {
        parameterId: '9102',
        parameterName: 'Test Parameter Two',
        parameterType: 'Mandatory',
        parameterCode: '2',
        status: 0,
        isSelectedToSubmit: false,
        requirements: [{ id: 9203 as never, code: 'R3', options: [{ id: 9303, code: '1', label: 'The unit trains its test staff' }], reviewNeeded: false }],
      },
    ],
    ...over,
  };
}

/** Before the allocation: input parameters, no allotted ones. */
export function allocationAnswer(): AssessmentDetails {
  return loginAnswer({
    allottedParameters: null,
    inputParameters: [
      { parameterId: '9101', parameterName: 'Test Parameter One', parameterCode: '1', isExcemptedFromSa: false },
      { parameterId: '9102', parameterName: 'Test Parameter Two', parameterCode: '2', isExcemptedFromSa: false },
    ],
  });
}

/** Technology upgradation (fourth milestone, the DFO): no parameters. */
export function tuAnswer(): AssessmentDetails {
  return loginAnswer({ milestone: 4, allottedParameters: null });
}
