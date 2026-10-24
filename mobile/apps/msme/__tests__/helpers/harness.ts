import { pbkdf2Sync, randomBytes } from 'crypto';
import { ENVIRONMENTS, HttpClient, NetworkError, setZedDeviceForTesting, type SqlDb } from '@zed/shared';
import { MsmeApi } from '../../src/api';
import { MsmeApp } from '../../src/app/MsmeApp';
import { registerHandlers } from '../../src/sync/queue';
import { memoryDb } from './sqljs';

export const DEVICE = {
  deviceId: 'test-device-1',
  osVersion: '6.6.0 (12345)',
  apiLevel: 35,
  device: 'emu64x',
  modelProduct: 'sdk_gphone64 (sdk_gphone64_x86_64)',
  manufacturer: 'Google',
};

/** The parts of a request as the server sees them (JSON body or multipart fields). */
export type SentRequest = {
  url: string;
  method: string;
  json?: Record<string, unknown>;
  fields?: Record<string, string>;
  files?: Array<{ name: string; uri: string; fileName: string; type: string }>;
};

type Responder = (req: SentRequest) => unknown | Promise<unknown>;

/** A fake V4 server: records requests, answers with the responder (or throws NetworkError when offline). */
export class FakeServer {
  readonly requests: SentRequest[] = [];
  online = true;
  constructor(public responder: Responder = () => ({ status: '1' })) {}

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (!this.online) throw new TypeError('Network request failed');
    const req: SentRequest = { url, method: init?.method ?? 'GET' };
    const body = init?.body as unknown;
    if (typeof body === 'string') req.json = JSON.parse(body);
    else if (body && typeof body === 'object') {
      req.fields = {};
      req.files = [];
      // React Native's FormData (installed by helpers/setup.ts) exposes its parts.
      const parts = (body as { getParts: () => Array<{ fieldName: string; string?: string; uri?: string; name?: string; type?: string }> })
        .getParts()
        .map(p => [p.fieldName, p.uri ? { uri: p.uri, name: p.name, type: p.type } : p.string] as [string, unknown]);
      for (const [k, v] of parts) {
        if (v && typeof v === 'object' && 'uri' in (v as object)) {
          const f = v as { uri: string; name: string; type: string };
          req.files.push({ name: k, uri: f.uri, fileName: f.name, type: f.type });
        } else req.fields[k] = String(v);
      }
    }
    this.requests.push(req);
    const answer = await this.responder(req);
    if (answer instanceof NetworkError) throw new TypeError('Network request failed');
    const text = JSON.stringify(answer);
    return { ok: true, status: 200, statusText: 'OK', text: async () => text } as Response;
  };

  last(path: string): SentRequest | undefined {
    return [...this.requests].reverse().find(r => r.url.endsWith(path));
  }
}

export const deletedFiles: string[] = [];

export function installFakeDevice() {
  setZedDeviceForTesting({
    getDeviceInfo: () => DEVICE,
    getAppInfo: () => ({ packageName: 'com.qci.zed.bronzesurveillance', versionName: '1.9', versionCode: 13, environment: 'local' }),
    getMemoryInfo: () => ({ availableRamMb: 2048, availableStorageMb: 4096 }),
    isAutoTimeEnabled: () => true,
    isGpsEnabled: () => true,
    openLocationSettings: () => undefined,
    getCurrentLocation: async () => ({ latitude: 28.6139, longitude: 77.209, latitudeText: '28.6139', longitudeText: '77.209', accuracy: 5, time: Date.now() }),
    capturePhoto: async () => null,
    pickImage: async () => null,
    pickPdf: async () => null,
    processImage: async () => ({ photoPath: '/files/x.jpg', base64: 'B64', timeStamp: 'Oct 24, 2026 3:05 PM', width: 810, height: 1080 }),
    copyPdf: async () => '/files/x.pdf',
    readFileBase64: async () => '',
    deleteFile: (p: string) => (deletedFiles.push(p), true),
    fileExists: () => true,
    openImage: () => undefined,
    openPdf: () => undefined,
    pickDate: async () => '2026-10-24',
    pickDateInRange: async () => '2026-10-24',
    pickTime: async () => ({ text: '10:30 AM', hour: 10, minute: 30 }),
    downloadFile: async (_url: string, name: string) => '/cache/downloads/' + name,
    setClipboard: () => undefined,
    hashPassword: (p: string, s: string, i: number) => pbkdf2Sync(p, Buffer.from(s, 'hex'), i, 32, 'sha256').toString('hex'),
    randomHex: (b: number) => randomBytes(b).toString('hex'),
    getPreference: () => null,
    setPreference: () => undefined,
    removePreference: () => undefined,
  } as never);
}

export async function makeApp(server: FakeServer, dbs?: { loginDb: SqlDb; mediaDb: SqlDb }) {
  installFakeDevice();
  const loginDb = dbs?.loginDb ?? (await memoryDb());
  const mediaDb = dbs?.mediaDb ?? (await memoryDb());
  const api = new MsmeApi(ENVIRONMENTS.local, () => ({ version: '1.9', deviceInfo: DEVICE }), new HttpClient({ fetchImpl: server.fetch }));
  const app = new MsmeApp({ loginDb, mediaDb, environment: ENVIRONMENTS.local, versionName: '1.9', api });
  await app.init();
  registerHandlers(app);
  return { app, loginDb, mediaDb };
}
