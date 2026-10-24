import type { DeviceInfo, RequestContext } from '../api/legacy';
import { environmentByName, type Environment } from '../config/environments';
import { zedDevice } from '../native';

/**
 * Device registration: the device is identified to V4 by `deviceInfo` on every request (V4 binds it on sign-in,
 * `MobileDeviceBindings`, and records it with every change). Values as the GeoStat apps' Utils.getDeviceInfo:
 * ANDROID_ID, os.version (+ incremental), SDK_INT, Build.DEVICE, MODEL (PRODUCT), MANUFACTURER.
 */
let cached: DeviceInfo | null | undefined;

export function getDeviceInfo(): DeviceInfo | null {
  if (cached === undefined) {
    try {
      const d = zedDevice().getDeviceInfo();
      cached = {
        deviceId: d.deviceId,
        osVersion: d.osVersion,
        apiLevel: d.apiLevel,
        device: d.device,
        modelProduct: d.modelProduct,
        manufacturer: d.manufacturer,
      };
    } catch {
      cached = null;
    }
  }
  return cached;
}

export type AppInfo = { packageName: string; versionName: string; versionCode: number; environment: Environment };

export function getAppInfo(): AppInfo {
  const a = zedDevice().getAppInfo();
  return {
    packageName: a.packageName,
    versionName: a.versionName,
    versionCode: a.versionCode,
    environment: environmentByName(a.environment),
  };
}

/** The `version` (BuildConfig.VERSION_NAME) and `deviceInfo` sent with every request. */
export function requestContext(): RequestContext {
  return { version: getAppInfo().versionName, deviceInfo: getDeviceInfo() };
}
