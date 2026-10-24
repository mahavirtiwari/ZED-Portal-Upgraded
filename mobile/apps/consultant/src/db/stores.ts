import { textOf, zedDevice, type SqlDb } from '@zed/shared';
import type { AssessmentDetails, PhotoInformation, SubmitAssessmentRequest, SubmitSelfieImageRequest } from '../models';

/** The legacy SQLite database (database/DBHelper.java): opened in place after the update. */
export const ASSESSMENT_DB_NAME = 'com.zed.assessmentdb';
/** The legacy Room photo database (database/AppDatabase.java), the same name as the MSME app's. */
export const MEDIA_DB_NAME = 'ZED_MSME_Media_DB';

/** DBHelper.onCreate, as written by the legacy app. */
const ASSESSOR_DDL =
  'create table if not exists AssessorData(UserId text, AssessorDataColumn text, OpenMeetingData text, SelfieData text, OpenCloseMeetingData text,  PRIMARY KEY (UserId));';
const EVIDENCE_DDL =
  'create table if not exists EvidenceData(UserId text, EvidenceId text, EvidenceDataColumn text, EvidenceTypeColumn integer,  PRIMARY KEY (EvidenceId));';

const parse = <T>(text: string | null): T | null => {
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/** Gson leaves nulls out; so does this (keeps the stored JSON the same shape). */
const toJson = (value: unknown) => JSON.stringify(value, (_k, v) => (v === null ? undefined : v));

/**
 * AssessorDataAccessObject: one row per assessor + unit (UserId = saId + zedId) with the sign-in answer and the work
 * done on it (AssessorDataColumn), and the meeting and selfie requests saved while offline.
 */
export class AssessorStore {
  constructor(private readonly db: SqlDb) {}

  async ensureSchema(): Promise<void> {
    await this.db.execute(ASSESSOR_DDL);
    await this.db.execute(EVIDENCE_DDL);
  }

  /** createOrReplaceData: the meeting and selfie columns are carried over. */
  async save(userId: string, details: AssessmentDetails): Promise<boolean> {
    try {
      await this.db.transaction(async tx => {
        const r = await tx.execute('SELECT OpenMeetingData, SelfieData, OpenCloseMeetingData FROM AssessorData WHERE UserId = ?', [userId]);
        const row = r.rows[0];
        await tx.execute(
          'INSERT OR REPLACE INTO AssessorData (UserId, AssessorDataColumn, OpenMeetingData, SelfieData, OpenCloseMeetingData) VALUES (?, ?, ?, ?, ?)',
          [userId, toJson(details), row ? textOf(row.OpenMeetingData) : null, row ? textOf(row.SelfieData) : null, row ? textOf(row.OpenCloseMeetingData) : null],
        );
      });
      return true;
    } catch {
      return false;
    }
  }

  async load(userId: string): Promise<AssessmentDetails | null> {
    const r = await this.db.execute('SELECT AssessorDataColumn FROM AssessorData WHERE UserId = ?', [userId]);
    return r.rows[0] ? parse<AssessmentDetails>(textOf(r.rows[0].AssessorDataColumn)) : null;
  }

  async delete(userId: string): Promise<boolean> {
    const r = await this.db.execute('DELETE FROM AssessorData WHERE UserId = ?', [userId]);
    return r.rowsAffected > 0;
  }

  private column(open: boolean) {
    return open ? 'OpenMeetingData' : 'OpenCloseMeetingData';
  }

  /** saveMeetingData (the legacy built the SQL by hand; here a parameter keeps quotes in names safe). */
  async saveMeeting(userId: string, request: SubmitAssessmentRequest, open: boolean): Promise<boolean> {
    try {
      await this.db.execute(`UPDATE AssessorData SET ${this.column(open)} = ? WHERE UserId = ?`, [toJson(request), userId]);
      return true;
    } catch {
      return false;
    }
  }

  async meeting(userId: string, open: boolean): Promise<SubmitAssessmentRequest | null> {
    const r = await this.db.execute(`SELECT ${this.column(open)} AS v FROM AssessorData WHERE UserId = ?`, [userId]);
    return r.rows[0] ? parse<SubmitAssessmentRequest>(textOf(r.rows[0].v)) : null;
  }

  async clearMeeting(userId: string, open: boolean): Promise<boolean> {
    const r = await this.db.execute(`UPDATE AssessorData SET ${this.column(open)} = NULL WHERE UserId = ?`, [userId]);
    return r.rowsAffected > 0;
  }

  async saveSelfie(userId: string, request: SubmitSelfieImageRequest): Promise<boolean> {
    try {
      await this.db.execute('UPDATE AssessorData SET SelfieData = ? WHERE UserId = ?', [toJson(request), userId]);
      return true;
    } catch {
      return false;
    }
  }

  async selfie(userId: string): Promise<SubmitSelfieImageRequest | null> {
    const r = await this.db.execute('SELECT SelfieData FROM AssessorData WHERE UserId = ?', [userId]);
    return r.rows[0] ? parse<SubmitSelfieImageRequest>(textOf(r.rows[0].SelfieData)) : null;
  }

  async clearSelfie(userId: string): Promise<boolean> {
    const r = await this.db.execute('UPDATE AssessorData SET SelfieData = NULL WHERE UserId = ?', [userId]);
    return r.rowsAffected > 0;
  }

  // ----- EvidenceDataAccessObject -----

  async saveEvidence(userId: string, info: PhotoInformation): Promise<boolean> {
    try {
      await this.db.execute('INSERT OR REPLACE INTO EvidenceData (UserId, EvidenceId, EvidenceDataColumn, EvidenceTypeColumn) VALUES (?, ?, ?, ?)', [
        userId,
        info.evidenceId ?? null,
        toJson(info),
        info.type,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async evidence(userId: string, evidenceId: string | null | undefined): Promise<PhotoInformation | null> {
    const r = await this.db.execute('SELECT EvidenceDataColumn FROM EvidenceData WHERE UserId = ? AND EvidenceId = ?', [userId, evidenceId ?? null]);
    return r.rows[0] ? parse<PhotoInformation>(textOf(r.rows[0].EvidenceDataColumn)) : null;
  }

  /** getSiteTourEvidences / getAddedEvidences (in table order, as the cursor read them). */
  async evidencesOfType(userId: string, type: number): Promise<PhotoInformation[]> {
    const r = await this.db.execute('SELECT EvidenceDataColumn FROM EvidenceData WHERE EvidenceTypeColumn = ? AND UserId = ? ORDER BY rowid', [type, userId]);
    return r.rows.map(row => parse<PhotoInformation>(textOf(row.EvidenceDataColumn))).filter((p): p is PhotoInformation => p != null);
  }

  async deleteEvidence(userId: string, evidenceId: string | null | undefined): Promise<boolean> {
    const r = await this.db.execute('DELETE FROM EvidenceData WHERE UserId = ? AND EvidenceId = ?', [userId, evidenceId ?? null]);
    return r.rowsAffected > 0;
  }

  async deleteAllEvidences(userId: string): Promise<boolean> {
    const r = await this.db.execute('DELETE FROM EvidenceData WHERE UserId = ?', [userId]);
    return r.rowsAffected > 0;
  }
}

/** SharedPreferences of the legacy app, by file and key (read and written through the native module). */
export interface Prefs {
  get(file: string, key: string): string | null;
  set(file: string, key: string, value: string): void;
  setBoolean(file: string, key: string, value: boolean): void;
  remove(file: string, key: string): void;
}

export const nativePrefs: Prefs = {
  get: (f, k) => zedDevice().getPreference(f, k),
  set: (f, k, v) => zedDevice().setPreference(f, k, v),
  setBoolean: (f, k, v) => zedDevice().setPreferenceBoolean(f, k, v),
  remove: (f, k) => zedDevice().removePreference(f, k),
};

export function memoryPrefs(): Prefs & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const key = (f: string, k: string) => `${f}/${k}`;
  return {
    data,
    get: (f, k) => data.get(key(f, k)) ?? null,
    set: (f, k, v) => void data.set(key(f, k), v),
    setBoolean: (f, k, v) => void data.set(key(f, k), String(v)),
    remove: (f, k) => void data.delete(key(f, k)),
  };
}

/** Preference files and keys of the legacy app. */
export const PREFS = {
  /** GlobalDataManager: the assessor and unit of the assessment in progress. */
  assessment: 'AssessmentPrefs',
  saId: 'saId',
  zedId: 'zedId',
  assessmentData: 'AssessmentData',
  /** LoginActivity.getPreferences: offline sign-in (Base64 of the typed values). */
  login: 'LoginActivity',
  loginAssessorId: 'assessor_id',
  loginPassword: 'PASSWORD',
  loginZedId: 'zed_id',
  /** SiteTourActivity.getPreferences: instruction shown once. */
  siteTour: 'SiteTourActivity',
  tourInstruction: 'tour_instruction',
  pickInstruction: 'pick_instruction',
  /** SiteImagesCapturingActivity: the opening meeting draft between its two screens. */
  meetingDraft: 'meeting_data_prefs',
  meetingDraftKey: 'assessment_request',
  /** SiteTourStatusHelper */
  siteTourStatus: 'SiteTourStatus',
} as const;
