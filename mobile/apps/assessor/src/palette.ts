// Imported first by index.js (before any @zed/shared module loads): the legacy app's colours (res/values/colors.xml,
// Theme.Styled) for the shared components. Material accents, buttons and dialogs use `primary` there.
(globalThis as { __ZED_PALETTE__?: Record<string, string> }).__ZED_PALETTE__ = {
  appColor: '#FFB243',
  appColorDark: '#E0952C',
  appColor3: '#33FFB243',
  appColor90: '#E6FFB243',
  appColorSecondary: '#FFB243',
  textColor: '#232527',
  darkGrey: '#232527',
  labelColor: '#595959',
};

export {};
