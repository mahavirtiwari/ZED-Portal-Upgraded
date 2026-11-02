import { utf8Encode, type SqlDb } from '@zed/shared';

/**
 * A LoginResponse as the legacy app's Gson wrote it into QCI_MSME_DB.LoginData after the assessor had worked
 * offline: basic information SUBMITTED, one evidence COMPLETED (captured, not sent), one SUBMITTED.
 * Field names and value types are those of the Kotlin models (Gson: nulls left out, ids as strings, enums by name).
 */
export const ZED_ID = 'ZEDRNTEST0001';
export const MSME_ID = '990001';
export const ASSOCIATED_ID = MSME_ID + ZED_ID;

export const legacyPhoto = (id: string, file: string) => ({
  photoId: id,
  name: undefined,
  photoPath: `/data/user/0/com.qci.zed.bronzesurveillance/files/${file}`,
  timeStamp: 'Oct 23, 2026 11:15 AM',
  latitude: '28.6139',
  longitude: '77.209',
  associatedId: ASSOCIATED_ID,
  status: 0,
  isPdf: false,
});

export function legacyLoginResponse() {
  return {
    errorMessage: null,
    status: '1',
    MsmeDetails: {
      MsmeId: MSME_ID,
      ZedId: ZED_ID,
      CertificateNo: ZED_ID,
      DateOfPledge: '10/24/2026 4:16:10 PM',
      PledgeEmailId: 'dev.zed@qcin.org',
      BasicDetails: { EnterpriseName: 'RN Test Enterprise Pvt Ltd', EnterpriseTypee: 'Small', Address: 'Plot 1', state_name: 'DELHI', DISTRICT_NAME: 'NEW DELHI', PINCode: '110001' },
      PlantDetails: { UnitName: 'RN Test Unit', PAddress: 'Plot 1', state_name: 'DELHI', DISTRICT_NAME: 'NEW DELHI', PPin: '110001' },
      msmeStatus: {
        status: '1',
        financialAssistanceStatus: 0,
        isCouponUsed: true,
        bronze: {
          status: 1,
          nc1Status: 0,
          nc2Status: 0,
          nc3Status: 0,
          nc4Status: 0,
          nc5Status: 0,
          finalSubmitDone: false,
          basicInformation: {
            assessorSelfie: legacyPhoto('ZEDRNTEST00011700000000001', 'a1.jpg'),
            auditsConducted: 'Yes',
            productDetailsList: [],
            domesticCustomers: 'Customer A',
            rawMaterialImported: 'No',
            rawMaterialsList: [],
            monthlyManufacturingCapacityUnits: 'Number',
            monthlyManufacturingCapacityValue: '100',
            monthlyUtilizationUnits: 'Number',
            monthlyUtilizationValue: '80',
            energySources: ['Electricity'],
            siteExteriorPhotos: [legacyPhoto('ZEDRNTEST00011700000000002', 'a2.jpg')],
            sitePhotosSubmitted: false,
            status: 'SUBMITTED',
          },
          parameters: [
            {
              code: '1',
              id: '9101',
              label: 'Test Parameter One',
              requirements: [
                {
                  code: '1',
                  id: '9201',
                  evidences: [
                    {
                      code: '1',
                      id: '9501',
                      label: 'Photo of the test process document',
                      status: 'COMPLETED',
                      photos: [legacyPhoto('ZEDRNTEST00011700000000003', 'e1.jpg'), legacyPhoto('ZEDRNTEST00011700000000004', 'e2.jpg')],
                      validationRequired: false,
                    },
                    { code: '2', id: '9502', label: 'Already sent', status: 'SUBMITTED', photos: [], validationRequired: false },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    remoteAssessmentData: { isSelfieSubmitted: false },
  };
}

/** The legacy DBHelper table with the row as LoginDataAccessObject wrote it (password as plain UTF-8 BLOB). */
export async function writeLegacyLoginRow(db: SqlDb, password: string) {
  await db.execute('create table if not exists LoginData(UserName text, EncCred text, LoginData text,  PRIMARY KEY (UserName));');
  await db.execute('INSERT INTO LoginData VALUES (?, ?, ?)', [ZED_ID, utf8Encode(password), JSON.stringify(legacyLoginResponse())]);
}

/** The legacy Room photo rows of the photos above (with their base64 copies). */
export async function writeLegacyPhotoRows(db: SqlDb) {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS `photos_table` (`photoId` TEXT NOT NULL, `photo` TEXT, `name` TEXT, `photoPath` TEXT, `timeStamp` TEXT, `latitude` TEXT, `longitude` TEXT, `associatedId` TEXT, `status` INTEGER NOT NULL, `isPdf` INTEGER NOT NULL, PRIMARY KEY(`photoId`))',
  );
  await db.execute('CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)');
  const files: Array<[string, string]> = [
    ['ZEDRNTEST00011700000000001', 'a1.jpg'],
    ['ZEDRNTEST00011700000000002', 'a2.jpg'],
    ['ZEDRNTEST00011700000000003', 'e1.jpg'],
    ['ZEDRNTEST00011700000000004', 'e2.jpg'],
  ];
  for (const [id, file] of files) {
    const p = legacyPhoto(id, file);
    await db.execute('INSERT INTO photos_table VALUES (?,?,?,?,?,?,?,?,?,?)', [
      p.photoId,
      'BASE64-' + id,
      null,
      p.photoPath,
      p.timeStamp,
      p.latitude,
      p.longitude,
      p.associatedId,
      0,
      0,
    ]);
  }
}
