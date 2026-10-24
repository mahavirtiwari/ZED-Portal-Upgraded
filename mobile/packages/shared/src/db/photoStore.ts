import type { PhotoData } from '../photo/photoData';
import { PHOTO_TO_SUBMIT } from '../photo/photoData';
import { textOf, type SqlDb, type SqlRow } from './types';

/**
 * The legacy Room photo table (database/AppDatabase "ZED_MSME_Media_DB", entity PhotoData, DAO PhotoDao).
 * The DDL is the one Room generates for that entity, so a new install has the same table and an updated
 * install keeps reading the legacy rows.
 */
export const PHOTOS_TABLE_DDL =
  'CREATE TABLE IF NOT EXISTS `photos_table` (`photoId` TEXT NOT NULL, `photo` TEXT, `name` TEXT, `photoPath` TEXT, ' +
  '`timeStamp` TEXT, `latitude` TEXT, `longitude` TEXT, `associatedId` TEXT, `status` INTEGER NOT NULL, ' +
  '`isPdf` INTEGER NOT NULL, PRIMARY KEY(`photoId`))';

function rowToPhoto(r: SqlRow): PhotoData {
  return {
    photoId: textOf(r.photoId) ?? '',
    photo: textOf(r.photo),
    name: textOf(r.name),
    photoPath: textOf(r.photoPath),
    timeStamp: textOf(r.timeStamp),
    latitude: textOf(r.latitude),
    longitude: textOf(r.longitude),
    associatedId: textOf(r.associatedId) ?? '',
    status: Number(r.status ?? 0),
    isPdf: Number(r.isPdf ?? 0) === 1,
  };
}

export class PhotoStore {
  constructor(private readonly db: SqlDb) {}

  async ensureSchema(): Promise<void> {
    await this.db.execute(PHOTOS_TABLE_DDL);
  }

  /** @Insert(onConflict = REPLACE) */
  async insert(p: PhotoData): Promise<void> {
    if (p.associatedId == null) throw new Error('associatedId is required'); // as the PhotoData constructor
    await this.db.execute(
      'INSERT OR REPLACE INTO `photos_table` (`photoId`,`photo`,`name`,`photoPath`,`timeStamp`,`latitude`,`longitude`,`associatedId`,`status`,`isPdf`) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        p.photoId,
        p.photo ?? null,
        p.name ?? null,
        p.photoPath ?? null,
        p.timeStamp ?? null,
        p.latitude ?? null,
        p.longitude ?? null,
        p.associatedId,
        p.status ?? 0,
        p.isPdf ? 1 : 0,
      ],
    );
  }

  async get(photoId: string): Promise<PhotoData | null> {
    const res = await this.db.execute('SELECT * FROM photos_table WHERE photoId = ?', [photoId]);
    return res.rows[0] ? rowToPhoto(res.rows[0]) : null;
  }

  async delete(photoId: string): Promise<void> {
    await this.db.execute('DELETE FROM photos_table WHERE photoId = ?', [photoId]);
  }

  async deleteByAssociatedId(associatedId: string): Promise<void> {
    await this.db.execute('DELETE FROM photos_table WHERE associatedId = ?', [associatedId]);
  }

  async deleteAll(): Promise<void> {
    await this.db.execute('DELETE FROM photos_table');
  }

  async updateStatus(status: number, photoId: string): Promise<void> {
    await this.db.execute('UPDATE photos_table SET status = ? WHERE photoId = ?', [status, photoId]);
  }

  /** getSubmissionReadyData: status TO_SUBMIT, LIMIT 10. */
  async submissionReady(): Promise<PhotoData[]> {
    const res = await this.db.execute('SELECT * FROM photos_table WHERE status = ? LIMIT 10', [PHOTO_TO_SUBMIT]);
    return res.rows.map(rowToPhoto);
  }

  async byAssociatedId(associatedId: string): Promise<PhotoData[]> {
    const res = await this.db.execute('SELECT * FROM photos_table WHERE associatedId = ?', [associatedId]);
    return res.rows.map(rowToPhoto);
  }

  /** All photo files referenced by the table (used to find orphaned files after a logout clean-up). */
  async allPaths(): Promise<string[]> {
    const res = await this.db.execute('SELECT photoPath FROM photos_table WHERE photoPath IS NOT NULL');
    return res.rows.map(r => textOf(r.photoPath) ?? '').filter(Boolean);
  }

  /**
   * Utils.fillPhotos: the stored copies (with base64) of the given photos, in order; an error with the given
   * message when any is missing or has no file.
   */
  async fill(photos: PhotoData[], error: string): Promise<PhotoData[]> {
    const out: PhotoData[] = [];
    for (const p of photos) {
      const stored = await this.get(p.photoId);
      if (stored?.photoPath == null) throw new Error(error);
      out.push(stored);
    }
    return out;
  }
}
