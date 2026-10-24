import { pbkdf2Sync, randomBytes } from 'crypto';
import { ApiError, HttpClient, isNetworkError, NetworkError } from '../src/api/http';
import { baseRequest, contextFields, errorOf, gsonJson, isSuccess } from '../src/api/legacy';
import { credentialToStore, hashCredential, isHashedCredential, verifyCredential, type Hasher } from '../src/auth/passwords';
import { apiBase, ENVIRONMENTS, environmentByName } from '../src/config/environments';
import { isValidMobileStart, numericFilter, percentageFilter, valueOrNull } from '../src/forms/validation';
import { extensionOf, newPhotoId, withoutBase64 } from '../src/photo/photoData';
import { formatDate, headerDate, isToday, parseLegacyDate } from '../src/util/dates';
import { textOf, utf8Decode, utf8Encode } from '../src/db/types';

const hasher: Hasher = {
  hash: (p, s, i) => pbkdf2Sync(p, Buffer.from(s, 'hex'), i, 32, 'sha256').toString('hex'),
  randomHex: b => randomBytes(b).toString('hex'),
};

describe('passwords (offline sign-in)', () => {
  it('accepts the legacy plain-text credential ignoring case and asks to upgrade it to a hash', () => {
    const r = verifyCredential('Secret1', 'SECRET1', hasher);
    expect(r.ok).toBe(true);
    expect(isHashedCredential(r.upgrade!)).toBe(true);
    expect(verifyCredential(r.upgrade!, 'secret1', hasher).ok).toBe(true);
  });

  it('refuses a wrong password and a missing row', () => {
    expect(verifyCredential('SECRET1', 'OTHER', hasher).ok).toBe(false);
    expect(verifyCredential(null, 'X', hasher).ok).toBe(false);
    expect(verifyCredential(credentialToStore('A1', hasher), 'A2', hasher).ok).toBe(false);
  });

  it('never stores the password itself', () => {
    const stored = hashCredential('PASSWORD', hasher, 1000);
    expect(stored).not.toContain('PASSWORD');
    expect(stored.split('$')).toHaveLength(5);
  });
});

describe('legacy request conventions', () => {
  const ctx = {
    version: '1.9',
    deviceInfo: { deviceId: 'abc', osVersion: '6.1 (1)', apiLevel: 35, device: 'emu', modelProduct: 'sdk (sdk)', manufacturer: 'Google' },
  };

  it('adds userName, version and deviceInfo to every body', () => {
    expect(baseRequest(ctx, 'ZED1', { certificationType: 'Bronze' })).toEqual({
      certificationType: 'Bronze',
      userName: 'ZED1',
      version: '1.9',
      deviceInfo: ctx.deviceInfo,
    });
    expect(baseRequest({ version: '1.9', deviceInfo: null }, 'Z', {})).toEqual({ userName: 'Z', version: '1.9' });
  });

  it('sends the device as deviceInfo.* fields in multipart requests', () => {
    expect(contextFields(ctx)).toEqual([
      { name: 'version', value: '1.9' },
      { name: 'deviceInfo.deviceId', value: 'abc' },
      { name: 'deviceInfo.osVersion', value: '6.1 (1)' },
      { name: 'deviceInfo.apiLevel', value: '35' },
      { name: 'deviceInfo.device', value: 'emu' },
      { name: 'deviceInfo.modelProduct', value: 'sdk (sdk)' },
      { name: 'deviceInfo.manufacturer', value: 'Google' },
    ]);
  });

  it('writes JSON as Gson did (nulls left out)', () => {
    expect(gsonJson({ photoId: 'p', photo: null, name: undefined, isPdf: false })).toBe('{"photoId":"p","isPdf":false}');
  });

  it('reads status "1" as success, anything else with the message or the legacy fallback', () => {
    expect(isSuccess({ status: '1' })).toBe(true);
    expect(isSuccess({ status: 1 })).toBe(true);
    expect(isSuccess({ status: '0' })).toBe(false);
    expect(isSuccess({})).toBe(false);
    expect(errorOf({ status: '0', errorMessage: 'Invalid Credentials.' })).toBe('Invalid Credentials.');
    expect(errorOf(null)).toBe('Unknown Error Occurred');
  });
});

describe('HttpClient', () => {
  const ok = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve(JSON.stringify(body)) } as Response);

  it('posts JSON without null fields and parses the answer', async () => {
    const fetchImpl = jest.fn((_url: string, _init?: RequestInit) => ok({ status: '1' }));
    const c = new HttpClient({ fetchImpl });
    expect(await c.postJson('https://h/x', { a: 1, b: null })).toEqual({ status: '1' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://h/x');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBe('{"a":1}');
    expect((init!.headers as Record<string, string>)['Content-Type']).toContain('application/json');
  });

  it('turns an HTTP error into Retrofit\'s "HTTP <code> <message>" text', async () => {
    const c = new HttpClient({
      fetchImpl: () => Promise.resolve({ ok: false, status: 500, statusText: '', text: () => Promise.resolve('{}') } as Response),
    });
    await expect(c.postJson('https://h/x', {})).rejects.toEqual(new ApiError('HTTP 500 Internal Server Error', 500));
  });

  it('reports a failed connection as a NetworkError (queued sends are retried)', async () => {
    const c = new HttpClient({ fetchImpl: () => Promise.reject(new TypeError('Network request failed')) });
    const e = await c.postJson('https://h/x', {}).catch(x => x);
    expect(e).toBeInstanceOf(NetworkError);
    expect(isNetworkError(e)).toBe(true);
  });

  it('times out as a NetworkError', async () => {
    const c = new HttpClient({
      timeoutMs: 10,
      fetchImpl: (_u, init) =>
        new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('Aborted')))),
    });
    await expect(c.getJson('https://h/x')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('environments', () => {
  it('keeps the legacy paths below each host', () => {
    expect(apiBase(ENVIRONMENTS.staging, 'surveillancemobileapi/surveillance/')).toBe(
      'https://zedv3.qci.org.in/surveillancemobileapi/surveillance/',
    );
    expect(apiBase(ENVIRONMENTS.production, '/Pay')).toBe('https://loginzed.msme.gov.in/Pay/');
    expect(environmentByName('nonsense')).toBe(ENVIRONMENTS.production);
  });
});

describe('dates (SimpleDateFormat, Locale.ENGLISH)', () => {
  const d = new Date(2026, 9, 4, 15, 5, 9);
  it('formats the photo time stamp and the header date as the legacy code', () => {
    expect(formatDate(d, 'MMM dd, yyyy h:mm a')).toBe('Oct 04, 2026 3:05 PM');
    expect(formatDate(new Date(2026, 0, 1, 0, 7), 'MMM dd, yyyy h:mm a')).toBe('Jan 01, 2026 12:07 AM');
    expect(formatDate(d, 'yyyyMMdd_HHmmss')).toBe('20261004_150509');
    expect(headerDate(d)).toBe('Sunday 04, Oct');
  });
  it('parses the .NET en-US dates of the API', () => {
    expect(parseLegacyDate('10/24/2026 03:30:00 PM')).toEqual(new Date(2026, 9, 24, 15, 30, 0));
    expect(parseLegacyDate('10/24/2026 12:00:00 AM')).toEqual(new Date(2026, 9, 24, 0, 0, 0));
    expect(parseLegacyDate('garbage')).toBeNull();
    expect(isToday(new Date(2026, 9, 24, 23, 0), new Date(2026, 9, 24, 1, 0))).toBe(true);
    expect(isToday(null)).toBe(false);
  });
});

describe('form rules', () => {
  it('treats blank as missing', () => {
    expect(valueOrNull('  ')).toBeNull();
    expect(valueOrNull(' a ')).toBe(' a ');
  });
  it('numeric fields take digits only, 20 at most', () => {
    expect(numericFilter('12a3.4')).toBe('1234');
    expect(numericFilter('1'.repeat(25))).toHaveLength(20);
  });
  it('percentage fields drop the last digit when above 100', () => {
    expect(percentageFilter('10', '100')).toBe('100');
    expect(percentageFilter('10', '101')).toBe('10');
    expect(percentageFilter('', '5')).toBe('5');
  });
  it('mobile numbers cannot begin with 0-5', () => {
    expect(isValidMobileStart('5123')).toBe(false);
    expect(isValidMobileStart('9123')).toBe(true);
  });
});

describe('photo data helpers', () => {
  it('builds ids as loginId + millis and keeps the extension with the dot', () => {
    expect(newPhotoId('ZED1', 1700000000000)).toBe('ZED11700000000000');
    expect(newPhotoId(null)).toBe('');
    expect(extensionOf('/x/abc.jpg')).toBe('.jpg');
  });
  it('clears the base64 for the copy kept in the app JSON', () => {
    expect(
      withoutBase64({ photoId: 'p', photo: 'b64', associatedId: 'a', status: 0, isPdf: false }).photo,
    ).toBeNull();
  });
  it('round-trips UTF-8 for BLOB columns', () => {
    expect(utf8Decode(utf8Encode('Pässwörd₹'))).toBe('Pässwörd₹');
    expect(textOf(utf8Encode('abc'))).toBe('abc');
    expect(textOf(null)).toBeNull();
  });
});
