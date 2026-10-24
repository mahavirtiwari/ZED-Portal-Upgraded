import type { AssessmentDetails } from '../../src/models';

export const SA_ID = 'ZEDRNLA01';
export const CO_ID = 'ZEDRNCA01';
export const ZED_ID = 'ZEDRNSA0001';

/** What V4 SAController.Login answers for a lead assessor after the allocation (status 9). */
export function loginAnswer(over: Partial<AssessmentDetails> = {}): AssessmentDetails {
  return {
    status: '1',
    userType: 1,
    certificationType: 'Silver',
    isSelfieSubmitted: false,
    isOpenMeetingSubmitted: false,
    isCloseMeetingSubmitted: false,
    isSiteTourSubmitted: false,
    isBasicInfoSubmitted: false,
    allowFinalSubmit: false,
    companyProfile: {
      saDate: '10/24/2026 09:00:00 AM',
      zedId: ZED_ID,
      msmeName: 'RN Test Enterprise Pvt Ltd',
      sectorName: '25',
      unitAddress: 'Plot 1, Test Road, NEW DELHI, DELHI 110001',
      email: 'dev.zed@qcin.org',
      phone: '9000000002',
    },
    basicInformation: {
      auditsConducted: 'Yes',
      domesticCustomers: 'Customer A',
      productDetailsList: [{ id: '1', productName: 'Widget', exported: 'No' }],
      rawMaterialsList: [],
      energySources: ['Electricity'],
      sitePhotosSubmitted: false,
      status: 'IN_PROGRESS' as never,
    },
    assessors: [
      { assessorId: SA_ID, assessorName: 'RN Lead Assessor', userType: '1' },
      { assessorId: CO_ID, assessorName: 'RN Co Assessor', userType: '2' },
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
          { id: 9201 as never, options: [{ id: 9301, code: '1', label: 'The unit has a documented test process' }], reviewNeeded: false },
          { id: 9202 as never, options: [{ id: 9302, code: '1', label: 'The unit keeps test records' }], reviewNeeded: false },
        ],
      },
      {
        parameterId: '9102',
        parameterName: 'Test Parameter Two',
        parameterType: 'Mandatory',
        parameterCode: '2',
        status: 0,
        isSelectedToSubmit: false,
        requirements: [{ id: 9203 as never, options: [{ id: 9303, code: '1', label: 'The unit trains its test staff' }], reviewNeeded: false }],
      },
    ],
    ...over,
  };
}

/** Before the allocation (status 8): input parameters, no allotted ones. */
export function allocationAnswer(): AssessmentDetails {
  return loginAnswer({
    allottedParameters: null,
    inputParameters: [
      { parameterId: '9101', parameterName: 'Test Parameter One', parameterCode: '1', isExcemptedFromSa: false },
      { parameterId: '9102', parameterName: 'Test Parameter Two', parameterCode: '2', isExcemptedFromSa: false },
      { parameterId: '9103', parameterName: 'Exempted Parameter', parameterCode: '3', isExcemptedFromSa: true },
    ],
  });
}
