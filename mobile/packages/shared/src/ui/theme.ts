/**
 * Theme taken from the legacy res folders (ZED_MSME_Bronze res/values: colors.xml, dimens.xml, themes.xml
 * "Theme.ZEDMSME"). dp and sp map one to one to React Native's density-independent units.
 */
/**
 * An app with its own look (the site assessor and consultant apps) sets `globalThis.__ZED_PALETTE__` in a module it
 * imports first in index.js (before anything else loads), overriding these tokens for every shared component.
 */
const override = ((globalThis as { __ZED_PALETTE__?: Record<string, string> }).__ZED_PALETTE__ ?? {}) as Record<string, string>;

const baseColors = {
  appColor: '#45A5AD',
  appColor3: '#45A5AD33', // React Native reads #RRGGBBAA (Android's #AARRGGBB)
  appColor90: '#45A5ADE6',
  appColorDark: '#368289',
  appColorSecondary: '#B3E079',
  /** Behind the status bar (the legacy theme's statusBarColor); ZED MSME's current app has it white. */
  statusBar: '#B3E079',
  textColor: '#232527',
  black: '#000000',
  white: '#FFFFFF',
  labelColor: '#8D8F90',
  darkGrey: '#232527',
  darkGrey2: '#3A3C3E',
  secondary3: '#B3E07933',
  secondary90: '#B3E079E6',
  lightGrey: '#F0F0F0',
  lightGrey2: '#F7F7F7',
  progressBarColor: '#DFE1E4',
  selectionGreen: '#79C689',
  selectionGreen30: '#79C6894D',
  selectionGreen10: '#79C6891A',
  pledgeTextBackground: '#FBF8DB',
  pledgeButtonColor: '#C69851',
  couponBorder: '#7EBFDF',
  bronze: '#D87B62',
  silver: '#CDCFD1',
  gold: '#CCB160',
  ncBackground: '#D87B621A',
  activitySelectTextBackground: '#F8CC5C66',
  ncRed: '#DD4F5A',
  orange: '#FFB243',
  yellow: '#FBE5AD',
  green: '#79C688',
  /** Material error red used by TextInputLayout errors. */
  error: '#B00020',
};

export type Palette = Partial<Record<keyof typeof baseColors, string>>;

const merged = { ...baseColors, ...(override as Palette) };
// The status bar follows the secondary colour unless an app sets its own.
export const colors: Readonly<typeof baseColors> = { ...merged, statusBar: override.statusBar ?? merged.appColorSecondary };

export const dimens = {
  padding1: 5,
  padding2: 8,
  padding3: 12,
  padding4: 16,
  padding5: 20,
  textSize14: 14,
  textSize: 16,
  textSize2: 18,
  textSize3: 22,
  incentiveLogoSize: 96,
} as const;

/** android:lineSpacingMultiplier 1.25 of the theme. */
export function lineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.25 * 1.17);
}

export const textStyles = {
  /** Theme default: black, 16sp. */
  body: { color: colors.black, fontSize: dimens.textSize },
  /** @style/DefaultLabel */
  defaultLabel: { fontWeight: 'bold' as const, color: colors.textColor, marginBottom: dimens.padding1, fontSize: dimens.textSize },
  /** @style/TextSubheading */
  subheading: {
    fontSize: dimens.textSize3,
    fontWeight: 'bold' as const,
    marginBottom: dimens.padding2,
    marginTop: dimens.padding1,
    color: colors.black,
  },
  /** @style/TextSubheadingDarkBackground */
  subheadingDark: {
    fontSize: dimens.textSize,
    fontWeight: 'bold' as const,
    color: colors.white,
    backgroundColor: colors.darkGrey,
    borderRadius: dimens.padding1,
    padding: dimens.padding2,
    marginBottom: dimens.padding1,
    marginTop: dimens.padding2,
    overflow: 'hidden' as const,
  },
} as const;

/** Shape drawables used as backgrounds. */
export const shapes = {
  /** drawable/grey_rectangle */
  greyRectangle: { backgroundColor: colors.lightGrey, borderRadius: 5 },
  /** drawable/grey_outline_rectangle */
  greyOutlineRectangle: { borderColor: colors.progressBarColor, borderWidth: 2, borderRadius: 5 },
  /** drawable/light_grey_outline_rectangle_filled */
  lightGreyOutlineFilled: { borderColor: colors.progressBarColor, borderWidth: 2, borderRadius: 5, backgroundColor: colors.lightGrey },
  /** drawable/nc_rectangle */
  ncRectangle: { backgroundColor: colors.ncBackground, borderRadius: 5 },
} as const;
