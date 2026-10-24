import { LegacyLoginStore } from '../src/db/legacyLoginStore';
import { PhotoStore, PHOTOS_TABLE_DDL } from '../src/db/photoStore';
import { utf8Encode } from '../src/db/types';
import type { PhotoData } from '../src/photo/photoData';
import { memoryDb } from './helpers/sqljs';

describe('LegacyLoginStore (QCI_MSME_DB.LoginData)', () => {
  it('reads a row written by the legacy app: password as a BLOB, response as JSON', async () => {
    const db = await memoryDb();
    // Exactly the legacy DBHelper.onCreate statement and LoginDataAccessObject.createOrReplaceData values.
    db.raw.run('create table if not exists LoginData(UserName text, EncCred text, LoginData text,  PRIMARY KEY (UserName));');
    db.raw.run('INSERT INTO LoginData VALUES (?, ?, ?)', [
      'ZEDMSME000001',
      utf8Encode('SECRET1'),
      JSON.stringify({ status: '1', MsmeDetails: { ZedId: 'ZEDMSME000001', msmeStatus: { bronze: { status: 1 } } } }),
    ]);
    const store = new LegacyLoginStore<{ MsmeDetails: { ZedId: string } }>(db);
    await store.ensureSchema(); // no-op on the existing table
    expect(await store.credential('ZEDMSME000001')).toBe('SECRET1');
    expect((await store.load('ZEDMSME000001'))?.MsmeDetails.ZedId).toBe('ZEDMSME000001');
    expect(await store.load('UNKNOWN')).toBeNull();
  });

  it('replaces a row, updates the credential and deletes', async () => {
    const db = await memoryDb();
    const store = new LegacyLoginStore<{ a: number }>(db);
    await store.ensureSchema();
    await store.save('U', 'c1', { a: 1 });
    await store.save('U', 'c2', { a: 2 });
    expect(await store.users()).toEqual(['U']);
    expect(await store.load('U')).toEqual({ a: 2 });
    await store.updateCredential('U', 'zed1$x');
    expect(await store.credential('U')).toBe('zed1$x');
    expect(await store.remove('U')).toBe(true);
    expect(await store.load('U')).toBeNull();
  });

  it('treats unreadable JSON as no data (Gson jsonToObject returned null)', async () => {
    const db = await memoryDb();
    const store = new LegacyLoginStore(db);
    await store.ensureSchema();
    db.raw.run("INSERT INTO LoginData VALUES ('U', 'x', '{not json')");
    expect(await store.load('U')).toBeNull();
  });
});

const photo = (id: string, extra: Partial<PhotoData> = {}): PhotoData => ({
  photoId: id,
  photo: 'BASE64',
  name: null,
  photoPath: `/data/files/${id}.jpg`,
  timeStamp: 'Oct 24, 2026 3:05 PM',
  latitude: '28.6139',
  longitude: '77.209',
  associatedId: 'M1ZED1',
  status: 0,
  isPdf: false,
  ...extra,
});

describe('PhotoStore (ZED_MSME_Media_DB.photos_table)', () => {
  it('uses the Room table of the legacy app', async () => {
    const db = await memoryDb();
    db.raw.run(PHOTOS_TABLE_DDL);
    // A row as Room wrote it (booleans as 0/1).
    db.raw.run(
      "INSERT INTO photos_table VALUES ('ZED11','b64',NULL,'/f/1.jpg','Oct 24, 2026 3:05 PM','1.5','2.5','A',2,1)",
    );
    const store = new PhotoStore(db);
    await store.ensureSchema();
    expect(await store.get('ZED11')).toEqual({
      photoId: 'ZED11',
      photo: 'b64',
      name: null,
      photoPath: '/f/1.jpg',
      timeStamp: 'Oct 24, 2026 3:05 PM',
      latitude: '1.5',
      longitude: '2.5',
      associatedId: 'A',
      status: 2,
      isPdf: true,
    });
  });

  it('insert replaces, status updates, queries by owner and status', async () => {
    const db = await memoryDb();
    const store = new PhotoStore(db);
    await store.ensureSchema();
    await store.insert(photo('p1'));
    await store.insert(photo('p1', { name: 'renamed' }));
    await store.insert(photo('p2', { associatedId: 'OTHER' }));
    expect((await store.get('p1'))?.name).toBe('renamed');
    await store.updateStatus(1, 'p1');
    expect((await store.submissionReady()).map(p => p.photoId)).toEqual(['p1']);
    expect((await store.byAssociatedId('M1ZED1')).map(p => p.photoId)).toEqual(['p1']);
    await store.deleteByAssociatedId('M1ZED1');
    expect(await store.get('p1')).toBeNull();
    expect(await store.allPaths()).toEqual(['/data/files/p2.jpg']);
  });

  it('fill returns the stored copies with base64, or the legacy error when one is missing', async () => {
    const db = await memoryDb();
    const store = new PhotoStore(db);
    await store.ensureSchema();
    await store.insert(photo('p1'));
    const filled = await store.fill([{ ...photo('p1'), photo: null }], 'Site photos missing, please capture again');
    expect(filled[0]!.photo).toBe('BASE64');
    await expect(store.fill([photo('nope')], 'Site photos missing, please capture again')).rejects.toThrow(
      'Site photos missing, please capture again',
    );
  });

  it('refuses a photo without owner, as the PhotoData constructor', async () => {
    const db = await memoryDb();
    const store = new PhotoStore(db);
    await store.ensureSchema();
    await expect(store.insert({ ...photo('x'), associatedId: null as unknown as string })).rejects.toThrow();
  });
});
