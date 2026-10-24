import NativeZedDevice, { type Spec } from './NativeZedDevice';

export type {
  NativeAppInfo,
  NativeCaptureResult,
  NativeDeviceInfo,
  NativeLocation,
  NativeMemoryInfo,
  NativePickResult,
  NativePickedTime,
  NativeProcessedImage,
} from './NativeZedDevice';

let override: Spec | null = null;

/** Tests (Jest has no native modules) install a fake here. */
export function setZedDeviceForTesting(fake: Spec | null): void {
  override = fake;
}

/** The ZedDevice TurboModule (packages/shared/android). Throws when the native part is not linked. */
export function zedDevice(): Spec {
  const m = override ?? NativeZedDevice;
  if (!m) {
    throw new Error('ZedDevice native module is not linked (is @zed/shared a dependency of the app?)');
  }
  return m;
}
