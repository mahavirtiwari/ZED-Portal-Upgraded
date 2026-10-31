/**
 * The legacy request/response conventions shared by every ZED app (models/ServiceModels.kt of the MSME code base,
 * the GeoStat apps' BaseServiceRequest/ServiceResponse), as the V4 mobile API reads and answers them.
 */
import type { MultipartField } from './http';

export const SUCCESS_RESPONSE = '1';
export const UNKNOWN_ERROR = 'Unknown Error Occurred';

/** ServiceResponse: `status` "1" is success; anything else shows `errorMessage`. */
export type BaseServiceResponse = {
  status?: string | number | null;
  errorMessage?: string | null;
  refId?: string | null;
};

export function isSuccess(r: BaseServiceResponse | null | undefined): boolean {
  return r != null && String(r.status ?? '0') === SUCCESS_RESPONSE;
}

/** BaseServiceResponse.getError. */
export function errorOf(r: BaseServiceResponse | null | undefined): string {
  return r?.errorMessage ?? UNKNOWN_ERROR;
}

export function errorResponse(message?: string | null): BaseServiceResponse {
  return { status: '0', errorMessage: message ?? UNKNOWN_ERROR };
}

export function successResponse(): BaseServiceResponse {
  return { status: '1' };
}

/**
 * New in V4 (audit C1): the refusal of a call whose app sign-in token (X-Zed-App-Token) the server no longer accepts.
 * The app then signs out and shows the login page with this text.
 */
export const SESSION_EXPIRED_MESSAGE = 'Your sign-in has expired. Please sign in again.';

/** A body with `errorMessage` exactly {@link SESSION_EXPIRED_MESSAGE} (any HTTP status, any `status`). */
export function isSessionExpiredResponse(body: unknown): boolean {
  return body != null && typeof body === 'object' && (body as BaseServiceResponse).errorMessage === SESSION_EXPIRED_MESSAGE;
}

/**
 * New in V4 (audit C1): takes the top-level `appToken` out of a successful login answer, so that it is kept apart
 * from the stored sign-in data (which other requests copy from). Null when the server sent none (an older server):
 * the app then carries on without the header.
 */
export function takeAppToken(loginResponse: object | null | undefined): string | null {
  if (loginResponse == null) return null;
  const r = loginResponse as { appToken?: unknown };
  const token = typeof r.appToken === 'string' && r.appToken.trim() !== '' ? r.appToken : null;
  delete r.appToken;
  return token;
}

/** The DeviceInfo object of the legacy request models; V4 records it for every sign-in and change. */
export type DeviceInfo = {
  deviceId: string;
  osVersion: string;
  apiLevel: number;
  device: string;
  modelProduct: string;
  manufacturer: string;
};

/** What every request carries besides its own fields: the app version and the device. */
export type RequestContext = {
  version: string;
  deviceInfo: DeviceInfo | null;
};

/** BaseServiceRequest(userName) + version + deviceInfo, then the request's own fields. */
export function baseRequest<T extends object>(ctx: RequestContext, userName: string, fields: T): T & {
  userName: string;
  version: string;
  deviceInfo?: DeviceInfo;
} {
  const req: Record<string, unknown> = { ...fields, userName, version: ctx.version };
  if (ctx.deviceInfo) req.deviceInfo = ctx.deviceInfo;
  return req as T & { userName: string; version: string; deviceInfo?: DeviceInfo };
}

/**
 * The device and version as multipart text fields (`deviceInfo.deviceId`, ...), which the V4 binder reads like the
 * old MVC model binder did. The legacy multipart calls carried none of them. (The app sign-in token travels as a
 * header on multipart calls too, added by HttpClient.)
 */
export function contextFields(ctx: RequestContext): MultipartField[] {
  const fields: MultipartField[] = [{ name: 'version', value: ctx.version }];
  const d = ctx.deviceInfo;
  if (d) {
    fields.push(
      { name: 'deviceInfo.deviceId', value: d.deviceId },
      { name: 'deviceInfo.osVersion', value: d.osVersion },
      { name: 'deviceInfo.apiLevel', value: String(d.apiLevel) },
      { name: 'deviceInfo.device', value: d.device },
      { name: 'deviceInfo.modelProduct', value: d.modelProduct },
      { name: 'deviceInfo.manufacturer', value: d.manufacturer },
    );
  }
  return fields;
}

/**
 * Gson's toJson as the legacy apps used it: null fields are left out (serializeNulls off), the rest as is.
 * Used for JSON text inside multipart fields (photo metadata).
 */
export function gsonJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v === null || v === undefined ? undefined : v));
}
