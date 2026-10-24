// Imported first by index.js (before any @zed/shared module loads): the legacy app's colours (res/values/colors.xml,
// Theme.Styled) for the shared components. Material accents, buttons and dialogs use `primary` there.
(globalThis as { __ZED_PALETTE__?: Record<string, string> }).__ZED_PALETTE__ = {
  appColor: '#45A5AD',
  appColorDark: '#2F7F86',
  appColor3: '#3345A5AD',
  appColor90: '#E645A5AD',
  appColorSecondary: '#45A5AD',
  textColor: '#232527',
  darkGrey: '#232527',
  labelColor: '#595959',
};

export {};
