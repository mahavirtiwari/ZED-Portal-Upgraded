/**
 * The redesigned ZED Site Assessment look (design: "ZED Site Assessment" screen mockups, 390 x 844, MSME ZED orange
 * theme). Tokens and building blocks follow the design's generator (C, hero_header, bottom_tabs, badge, level_badge,
 * conformance_choice, empty_state, ...) so every screen is drawn from the same parts.
 */
import React from 'react';
import { Dimensions, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance, type ScrollViewProps, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export const C = {
  primary: '#F9A63A',
  primaryDark: '#E08A1E',
  primaryLight: '#FEB244',
  accent: '#5BA53C',
  bg: '#F7F8FA',
  surface: '#FFFFFF',
  muted: '#F1F3F6',
  border: '#E3E6EB',
  divider: '#EDEFF2',
  tPrimary: '#1F2937',
  tSecondary: '#5B6472',
  tMuted: '#98A2B3',
  tInverse: '#FFFFFF',
  success: '#2E9E4B',
  successBg: '#E4F5E8',
  warning: '#D97706',
  warningBg: '#FEF3C7',
  danger: '#D93A3A',
  dangerBg: '#FDECEC',
  info: '#1B75BB',
  infoBg: '#E4F0FA',
  primaryBg: '#FDF0DC',
  heroOverlay: 'rgba(255,255,255,0.22)',
  heroSubText: 'rgba(255,255,255,0.92)',
} as const;

/** ZED certification levels: metal-tinted chips. ZED-X uses Gold's tint. */
export const LEVELS: Record<string, { label: string; fg: string; bg: string }> = {
  bronze: { label: 'ZED Bronze', fg: '#8A5A2B', bg: '#F6E7D6' },
  silver: { label: 'ZED Silver', fg: '#5B6472', bg: '#ECEFF3' },
  gold: { label: 'ZED Gold', fg: '#9A6B10', bg: '#FBEFCE' },
  zedx: { label: 'ZED-X', fg: '#9A6B10', bg: '#FBEFCE' },
};

export const levelOf = (certification: string | null | undefined) => LEVELS[(certification ?? '').trim().toLowerCase()] ?? null;

export const images = {
  zedLogo: require('../assets/images/zed_logo.png'),
  zedMark: require('../assets/images/zed_mark.png'),
};

// ------------------------------------------------------------------ icons (the design's stroke icons, 24 x 24)

export type IconName =
  | 'home' | 'clipboard' | 'document' | 'user' | 'bell' | 'search' | 'plus' | 'check' | 'info' | 'close' | 'chevron-right'
  | 'chevron-down' | 'chevron-left' | 'lock' | 'phone' | 'mail' | 'calendar' | 'map-pin' | 'camera' | 'paperclip' | 'shield'
  | 'logout' | 'settings' | 'help' | 'flag' | 'edit' | 'arrow-right' | 'back' | 'sync' | 'users' | 'image';

export function ZIcon({ name, size = 20, color = C.tPrimary, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const sp = { fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const p = (d: string, k: string) => <Path key={k} d={d} {...sp} />;
  const c = (cx: number, cy: number, r: number, k: string) => <Circle key={k} cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} />;
  const r = (x: number, y: number, w: number, h: number, k: string, rd = 2) => (
    <Rect key={k} x={x} y={y} width={w} height={h} rx={rd} ry={rd} fill="none" stroke={color} strokeWidth={strokeWidth} />
  );
  const l = (x1: number, y1: number, x2: number, y2: number, k: string) => (
    <Line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  );
  const parts: Record<IconName, React.ReactNode[]> = {
    home: [p('M3 11l9-8 9 8', 'a'), p('M5 10v10h14V10', 'b'), p('M9 20v-6h6v6', 'c')],
    clipboard: [r(6, 4, 12, 17, 'a'), r(9, 2, 6, 4, 'b', 1), l(9, 11, 15, 11, 'c'), l(9, 15, 15, 15, 'd')],
    document: [p('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'a'), p('M14 2v6h6', 'b'), l(9, 13, 15, 13, 'c'), l(9, 17, 13, 17, 'd')],
    user: [c(12, 8, 4, 'a'), p('M4 21c0-4 4-7 8-7s8 3 8 7', 'b')],
    bell: [p('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'a'), p('M10 21a2 2 0 0 0 4 0', 'b')],
    search: [c(11, 11, 7, 'a'), l(21, 21, 16.5, 16.5, 'b')],
    plus: [l(12, 5, 12, 19, 'a'), l(5, 12, 19, 12, 'b')],
    check: [p('M20 6L9 17l-5-5', 'a')],
    info: [c(12, 12, 9, 'a'), l(12, 11, 12, 16, 'b'), l(12, 8, 12, 8.2, 'c')],
    close: [l(18, 6, 6, 18, 'a'), l(6, 6, 18, 18, 'b')],
    'chevron-right': [p('M9 6l6 6-6 6', 'a')],
    'chevron-down': [p('M6 9l6 6 6-6', 'a')],
    'chevron-left': [p('M15 6l-6 6 6 6', 'a')],
    lock: [r(4, 11, 16, 10, 'a'), p('M8 11V7a4 4 0 0 1 8 0v4', 'b')],
    phone: [p('M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z', 'a')],
    mail: [r(3, 5, 18, 14, 'a'), p('M3 7l9 6 9-6', 'b')],
    calendar: [r(3, 5, 18, 16, 'a'), l(3, 10, 21, 10, 'b'), l(8, 3, 8, 7, 'c'), l(16, 3, 16, 7, 'd')],
    'map-pin': [p('M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13z', 'a'), c(12, 9, 2.5, 'b')],
    camera: [p('M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'a'), c(12, 13, 4, 'b')],
    paperclip: [p('M21 12.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8', 'a')],
    shield: [p('M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z', 'a')],
    logout: [p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'a'), p('M16 17l5-5-5-5', 'b'), l(21, 12, 9, 12, 'c')],
    settings: [
      c(12, 12, 3, 'a'),
      p('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51', 'b'),
    ],
    help: [c(12, 12, 9, 'a'), p('M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'b'), l(12, 17, 12, 17.01, 'c')],
    flag: [p('M4 22V4', 'a'), p('M4 4h12l-2 4 2 4H4', 'b')],
    edit: [p('M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6', 'a'), p('M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z', 'b')],
    'arrow-right': [l(5, 12, 19, 12, 'a'), p('M13 6l6 6-6 6', 'b')],
    back: [l(19, 12, 5, 12, 'a'), p('M11 6l-6 6 6 6', 'b')],
    sync: [p('M21 12a9 9 0 1 1-3-6.7L21 8', 'a'), p('M21 3v5h-5', 'b'), p('M3 12a9 9 0 0 0 15 6.7L3 16', 'c'), p('M3 21v-5h5', 'd')],
    users: [c(9, 8, 4, 'a'), p('M2 21c0-3.5 3-6 7-6s7 2.5 7 6', 'b'), c(17, 7, 3, 'c'), p('M22 19c0-2.8-2.2-5-5-5', 'd')],
    image: [r(3, 4, 18, 16, 'a', 2), c(8.5, 9.5, 1.5, 'b'), p('M21 16l-5-5-9 9', 'c')],
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {parts[name]}
    </Svg>
  );
}

// ------------------------------------------------------------------ frame, headers, tabs

/** The page: the design's light grey background, safe-area aware. */
/**
 * The on-screen keyboard's height while it is open, else 0. The app draws edge to edge (Android 15 and later), so the
 * window no longer shrinks for the keyboard (adjustResize): the pages make room for it themselves.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = React.useState(0);
  React.useEffect(() => {
    // From the keyboard's top edge to the bottom of the screen: the reported height leaves out the navigation bar.
    const show = Keyboard.addListener('keyboardDidShow', e =>
      setHeight(Math.max(e.endCoordinates.height, Dimensions.get('screen').height - e.endCoordinates.screenY)),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** Room left below the focused field when it is scrolled above the keyboard. */
const FIELD_MARGIN = 24;

/**
 * ScrollView of the pages: when the keyboard opens (the page has made room for it, see `Page`), the focused field of this
 * scroll view is scrolled into view. A field of another scroll view (a page lower in the stack) is left alone.
 */
export const ZScroll = React.forwardRef<ScrollViewInstance, ScrollViewProps>(function ZScroll({ onScroll, onLayout, ...props }, ref) {
  const inner = React.useRef<ScrollViewInstance>(null);
  const offset = React.useRef(0);
  const visible = React.useRef(0);
  React.useImperativeHandle(ref, () => inner.current as ScrollViewInstance);
  const pending = React.useRef(false);
  const reveal = React.useCallback(() => {
    if (!pending.current) return;
    pending.current = false;
    const input = TextInput.State.currentlyFocusedInput() as unknown as { measureLayout?: Function } | null;
    const content = (inner.current as unknown as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
    if (!input?.measureLayout || !content) return;
    input.measureLayout(
      content,
      (_x: number, y: number, _w: number, h: number) => {
        const bottom = y + h + FIELD_MARGIN;
        if (bottom > offset.current + visible.current) inner.current?.scrollTo({ y: bottom - visible.current, animated: true });
        else if (y < offset.current) inner.current?.scrollTo({ y: Math.max(0, y - FIELD_MARGIN), animated: true });
      },
      () => undefined,
    );
  }, []);
  React.useEffect(() => {
    // Once the page has made room for the keyboard (the next layout of this scroll view), else shortly after.
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      pending.current = true;
      setTimeout(reveal, 300);
    });
    return () => sub.remove();
  }, [reveal]);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      {...props}
      ref={inner}
      onScroll={e => {
        offset.current = e.nativeEvent.contentOffset.y;
        onScroll?.(e);
      }}
      onLayout={e => {
        visible.current = e.nativeEvent.layout.height;
        onLayout?.(e);
        reveal();
      }}
    />
  );
});

/** A page: its content (scroll views, the bottom bar) stays above the keyboard, the focused field scrolled into view. */
export function Page({ children, testID, style }: { children: React.ReactNode; testID?: string; style?: StyleProp<ViewStyle> }) {
  const keyboard = useKeyboardHeight();
  return (
    <View style={[s.page, style, keyboard ? { paddingBottom: keyboard } : null]} testID={testID}>
      {children}
    </View>
  );
}

/** ZED orange hero header (hero_header): back arrow, title, subtitle, and the ZED mark or a bell with a count. */
export function HeroHeader({
  title,
  subtitle,
  onBack,
  bell,
  onBell,
  right,
  children,
  testID,
}: {
  title: string;
  subtitle?: string | null;
  onBack?: () => void;
  /** Number of unread notifications (0 hides the dot); undefined shows the ZED mark. */
  bell?: number;
  onBell?: () => void;
  right?: React.ReactNode;
  children?: React.ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.hero, { paddingTop: insets.top + 14 }]} testID={testID}>
      <View style={s.heroRow}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} style={{ marginRight: 10 }} testID="header-back" accessibilityLabel="Back">
            <ZIcon name="back" size={26} color={C.tInverse} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={s.heroTitle} numberOfLines={1} testID="header-title">
            {title}
          </Text>
          {subtitle ? (
            <Text style={s.heroSub} numberOfLines={1} testID="header-subtitle">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ??
          (bell !== undefined ? (
            <Pressable style={s.bell} onPress={onBell} testID="header-bell" accessibilityLabel="Notifications">
              <ZIcon name="bell" size={26} color={C.tInverse} />
              {bell > 0 ? (
                <View style={s.bellDot}>
                  <Text style={s.bellDotText}>{bell > 9 ? '9+' : bell}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : (
            <ZedMark size={34} />
          ))}
      </View>
      {children}
    </View>
  );
}

/** White header with a large title (plain_header without back) for the tab pages. */
export function PlainHeader({ title, subtitle, right, testID }: { title: string; subtitle?: string | null; right?: React.ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.plain, { paddingTop: insets.top + 16 }]} testID={testID}>
      <View style={{ flex: 1 }}>
        <Text style={s.plainTitle} testID="header-title">
          {title}
        </Text>
        {subtitle ? <Text style={s.plainSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function ZedMark({ size = 34 }: { size?: number }) {
  return (
    <View style={[s.mark, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image source={images.zedMark} style={{ width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }} resizeMode="contain" />
    </View>
  );
}

export type TabKey = 'home' | 'assessments' | 'reports' | 'profile';
const TABS: { key: TabKey; icon: IconName; label: string }[] = [
  { key: 'home', icon: 'home', label: 'Home' },
  { key: 'assessments', icon: 'clipboard', label: 'Assessments' },
  { key: 'reports', icon: 'document', label: 'Reports' },
  { key: 'profile', icon: 'user', label: 'Profile' },
];

export function BottomTabs({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.tabs, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map(t => {
        const on = t.key === active;
        const color = on ? C.primary : C.tMuted;
        return (
          <Pressable key={t.key} style={s.tab} onPress={() => onChange(t.key)} testID={`tab-${t.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <ZIcon name={t.icon} size={22} color={color} />
            <Text style={[s.tabLabel, { color }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ cards, buttons, inputs

export function Card({ children, style, onPress, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string }) {
  if (onPress)
    return (
      <Pressable style={[s.card, style]} onPress={onPress} testID={testID}>
        {children}
      </Pressable>
    );
  return (
    <View style={[s.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'dangerOutline' | 'ghost';

export function ZButton({
  title,
  onPress,
  variant = 'primary',
  disabled,
  icon,
  small,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: IconName;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const v = BUTTONS[variant];
  return (
    <Pressable
      style={({ pressed }) => [
        s.button,
        small && s.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        disabled && s.buttonDisabled,
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      {icon ? <ZIcon name={icon} size={small ? 16 : 18} color={disabled ? C.tMuted : v.fg} /> : null}
      <Text style={[s.buttonText, small && { fontSize: 14 }, { color: disabled ? C.tMuted : v.fg }, icon ? { marginLeft: 8 } : null]}>{title}</Text>
    </Pressable>
  );
}

const BUTTONS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: C.primary, fg: C.tInverse, border: C.primary },
  secondary: { bg: C.accent, fg: C.tInverse, border: C.accent },
  outline: { bg: C.surface, fg: C.primaryDark, border: C.primary },
  danger: { bg: C.danger, fg: C.tInverse, border: C.danger },
  dangerOutline: { bg: C.surface, fg: C.danger, border: C.border },
  ghost: { bg: C.surface, fg: C.tPrimary, border: C.border },
};

export function Field({
  label,
  icon,
  right,
  error,
  testID,
  style,
  ...input
}: TextInputProps & { label?: string; icon?: IconName; right?: React.ReactNode; error?: string | null; testID?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginBottom: 14 }, style]}>
      {label ? <Text style={s.fieldLabel}>{label.toUpperCase()}</Text> : null}
      <View style={[s.field, input.multiline ? s.fieldTop : null, error ? { borderColor: C.danger } : null, input.editable === false && { backgroundColor: C.muted }]}>
        {icon ? (
          <View style={input.multiline ? s.fieldIconTop : null}>
            <ZIcon name={icon} size={18} color={C.tMuted} />
          </View>
        ) : null}
        <TextInput placeholderTextColor={C.tMuted} {...input} style={[s.fieldInput, icon ? { marginLeft: 10 } : null, input.multiline ? s.fieldMulti : null]} testID={testID} />
        {right}
      </View>
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------------ badges, chips, labels

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: C.muted, fg: C.tSecondary },
  info: { bg: C.infoBg, fg: C.info },
  success: { bg: C.successBg, fg: C.success },
  warning: { bg: C.warningBg, fg: C.warning },
  danger: { bg: C.dangerBg, fg: C.danger },
  primary: { bg: C.primaryBg, fg: C.primaryDark },
};

export function Badge({ label, tone = 'neutral', small, testID }: { label: string; tone?: Tone; small?: boolean; testID?: string }) {
  const t = TONES[tone];
  return (
    <View style={[s.badge, small && s.badgeSmall, { backgroundColor: t.bg }]} testID={testID}>
      <Text style={[s.badgeText, small && { fontSize: 10 }, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function LevelBadge({ certification, small }: { certification: string | null | undefined; small?: boolean }) {
  const lv = levelOf(certification);
  if (!lv) return null;
  return (
    <View style={[s.badge, small && s.badgeSmall, { backgroundColor: lv.bg }]} testID="level-badge">
      <Text style={[s.badgeText, small && { fontSize: 10 }, { color: lv.fg }]}>{lv.label}</Text>
    </View>
  );
}

export function Chip({ label, active, onPress, testID }: { label: string; active?: boolean; onPress?: () => void; testID?: string }) {
  return (
    <Pressable style={[s.chip, active && { backgroundColor: C.primary }]} onPress={onPress} testID={testID}>
      <Text style={[s.chipText, active && { color: C.tInverse }]}>{label}</Text>
    </Pressable>
  );
}

export function SectionLabel({ label, brand, right, style }: { label: string; brand?: boolean; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.sectionRow, style]}>
      <Text style={[s.sectionLabel, brand && { color: C.primaryDark }]}>{label.toUpperCase()}</Text>
      {right}
    </View>
  );
}

export function ProgressBar({ value, color = C.primary, height = 8 }: { value: number; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: C.muted, overflow: 'hidden' }}>
      <View style={{ width: `${v * 100}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

export function Avatar({ name, size = 44, color = C.primary }: { name: string; size?: number; color?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]!.toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: C.tInverse, fontWeight: '700', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

/** Centred empty-state block: tinted icon well, headline, guidance and an optional call to action. */
export function EmptyState({ icon, headline, lines, cta, onCta, testID }: { icon: IconName; headline: string; lines: string[]; cta?: string; onCta?: () => void; testID?: string }) {
  return (
    <View style={s.empty} testID={testID}>
      <View style={s.emptyWell}>
        <ZIcon name={icon} size={36} color={C.primary} />
      </View>
      <Text style={s.emptyHeadline}>{headline}</Text>
      {lines.map((l, i) => (
        <Text key={i} style={s.emptyLine}>
          {l}
        </Text>
      ))}
      {cta ? <ZButton title={cta} onPress={onCta} style={{ marginTop: 16, alignSelf: 'center', minWidth: 200 }} testID={testID ? `${testID}-cta` : undefined} /> : null}
    </View>
  );
}

/** Info / warning strip (tinted, with an icon). */
export function Strip({ text, tone = 'primary', icon = 'info', title }: { text: string; tone?: Tone; icon?: IconName; title?: string }) {
  const t = TONES[tone];
  return (
    <View style={[s.strip, { backgroundColor: t.bg }]}>
      <ZIcon name={icon} size={16} color={t.fg} />
      <View style={{ flex: 1, marginLeft: 8 }}>
        {title ? <Text style={[s.stripTitle, { color: C.tPrimary }]}>{title}</Text> : null}
        <Text style={[s.stripText, { color: title ? C.tSecondary : t.fg }]}>{text}</Text>
      </View>
    </View>
  );
}

/** A row of a card list: icon well, title, subtitle, a badge or lock line, chevron. */
export function ListRow({
  icon,
  title,
  subtitle,
  badge,
  locked,
  onPress,
  last,
  testID,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string | null;
  badge?: React.ReactNode;
  locked?: string | null;
  onPress?: () => void;
  last?: boolean;
  testID?: string;
}) {
  const dim = !!locked;
  return (
    <Pressable style={[s.row, !last && s.rowDivider]} onPress={onPress} testID={testID}>
      {icon ? (
        <View style={[s.rowWell, dim && { backgroundColor: C.muted }]}>
          <ZIcon name={icon} size={20} color={dim ? C.tMuted : C.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, dim && { color: C.tMuted }]}>{title}</Text>
        {subtitle ? <Text style={s.rowSub}>{subtitle}</Text> : null}
        {locked ? (
          <View style={s.lockLine}>
            <ZIcon name="lock" size={12} color={C.tMuted} />
            <Text style={s.lockText}>{locked}</Text>
          </View>
        ) : badge ? (
          <View style={{ flexDirection: 'row', marginTop: 4 }}>{badge}</View>
        ) : null}
      </View>
      <ZIcon name="chevron-right" size={18} color={C.tMuted} />
    </Pressable>
  );
}

/** The "0/500" counter under a comments box. */
export const CharCounter = ({ used, limit }: { used: number; limit: number }) => <Text style={s.counter}>{`${used}/${limit}`}</Text>;

/** Yes / No conformance choice (conformance_choice): two radio cards, green / red when selected. */
export function ConformanceChoice({
  value,
  onChange,
  options = ['Yes', 'No'],
  disabled,
  testIDPrefix = 'conf',
}: {
  value: string | null;
  onChange: (v: string) => void;
  options?: string[];
  disabled?: boolean;
  testIDPrefix?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {options.map(o => {
        const on = value === o;
        const tone = o === 'Yes' ? { fg: C.success, bg: C.successBg } : o === 'No' ? { fg: C.danger, bg: C.dangerBg } : { fg: C.warning, bg: C.warningBg };
        return (
          <Pressable
            key={o}
            style={[s.choice, { borderColor: on ? tone.fg : C.border, borderWidth: on ? 2 : 1, backgroundColor: on ? tone.bg : C.surface }]}
            onPress={disabled ? undefined : () => onChange(o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            testID={`${testIDPrefix}-${o.toLowerCase()}`}
          >
            <View style={[s.radio, { borderColor: on ? tone.fg : C.border }]}>{on ? <View style={[s.radioDot, { backgroundColor: tone.fg }]} /> : null}</View>
            <Text style={[s.choiceText, { color: on ? tone.fg : C.tPrimary, fontWeight: on ? '700' : '500' }]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Dashed "nothing captured yet" tile. */
export function DashedTile({ label, icon = 'camera', onPress, size = 96, testID }: { label: string; icon?: IconName; onPress?: () => void; size?: number; testID?: string }) {
  return (
    <Pressable style={[s.dashed, { width: size, height: size }]} onPress={onPress} testID={testID}>
      <ZIcon name={icon} size={22} color={C.tMuted} />
      <Text style={s.dashedText}>{label}</Text>
    </Pressable>
  );
}

/** A centred modal sheet over a dim backdrop (team popup, punch-out, add evidence). */
export function Sheet({ children, onClose, title, testID }: { children: React.ReactNode; onClose?: () => void; title?: string; testID?: string }) {
  const keyboard = useKeyboardHeight();
  return (
    <View style={[s.backdrop, keyboard ? { paddingBottom: keyboard } : null]} testID={testID}>
      <View style={s.sheet}>
        {title || onClose ? (
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{title ?? ''}</Text>
            {onClose ? (
              <Pressable onPress={onClose} hitSlop={10} testID={testID ? `${testID}-close` : undefined} accessibilityLabel="Close">
                <ZIcon name="close" size={20} color={C.tSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}

export const z = StyleSheet.create({
  screenPad: { padding: 16, paddingBottom: 32 },
  h1: { fontSize: 22, fontWeight: '700', color: C.tPrimary },
  h2: { fontSize: 18, fontWeight: '700', color: C.tPrimary },
  title: { fontSize: 16, fontWeight: '700', color: C.tPrimary },
  body: { fontSize: 14, color: C.tPrimary },
  sub: { fontSize: 13, color: C.tSecondary },
  muted: { fontSize: 12, color: C.tMuted },
  idText: { fontSize: 12, fontWeight: '700', color: C.tMuted, letterSpacing: 0.5 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
});

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  hero: { backgroundColor: C.primary, paddingHorizontal: 16, paddingBottom: 18 },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroTitle: { fontSize: 20, fontWeight: '700', color: C.tInverse },
  heroSub: { fontSize: 13, color: C.heroSubText, marginTop: 2 },
  bell: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.heroOverlay, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  bellDotText: { color: C.tInverse, fontSize: 10, fontWeight: '700' },
  plain: { backgroundColor: C.surface, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', borderBottomColor: C.border, borderBottomWidth: 1 },
  plainTitle: { fontSize: 22, fontWeight: '700', color: C.tPrimary },
  plainSub: { fontSize: 12, color: C.tMuted, marginTop: 4 },
  mark: { backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: C.surface, borderTopColor: C.border, borderTopWidth: 1, paddingTop: 10 },
  tab: { flex: 1, alignItems: 'center' },
  tabLabel: { fontSize: 11, fontWeight: '500', marginTop: 4 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 12, elevation: 1, shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  button: { minHeight: 48, borderRadius: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonSmall: { minHeight: 40, paddingHorizontal: 12 },
  buttonDisabled: { backgroundColor: C.muted, borderColor: C.muted },
  buttonText: { fontSize: 15, fontWeight: '600', letterSpacing: 0.3 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: C.tSecondary, marginBottom: 6 },
  field: { flexDirection: 'row', alignItems: 'center', borderColor: C.border, borderWidth: 1, borderRadius: 10, backgroundColor: C.surface, paddingHorizontal: 12, minHeight: 48 },
  fieldInput: { flex: 1, fontSize: 15, color: C.tPrimary, paddingVertical: 10 },
  fieldMulti: { minHeight: 96, textAlignVertical: 'top' },
  fieldTop: { alignItems: 'flex-start' },
  fieldIconTop: { marginTop: 13 },
  fieldError: { color: C.danger, fontSize: 12, marginTop: 4 },
  badge: { borderRadius: 11, paddingHorizontal: 10, height: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  badgeSmall: { height: 18, paddingHorizontal: 8, borderRadius: 9 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  chip: { height: 28, borderRadius: 14, paddingHorizontal: 14, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  chipText: { fontSize: 12, fontWeight: '600', color: C.tSecondary },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: C.tSecondary, letterSpacing: 0.5 },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 24 },
  emptyWell: { width: 88, height: 88, borderRadius: 44, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  emptyHeadline: { fontSize: 16, fontWeight: '700', color: C.tPrimary, marginTop: 18, textAlign: 'center' },
  emptyLine: { fontSize: 12, color: C.tMuted, marginTop: 6, textAlign: 'center' },
  strip: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 10, padding: 12, marginBottom: 12 },
  stripTitle: { fontSize: 13, fontWeight: '700' },
  stripText: { fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowDivider: { borderBottomColor: C.divider, borderBottomWidth: 1 },
  rowWell: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: C.tPrimary },
  rowSub: { fontSize: 12, color: C.tSecondary, marginTop: 2 },
  lockLine: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  lockText: { fontSize: 11, color: C.tMuted, marginLeft: 4 },
  counter: { fontSize: 11, color: C.tMuted, textAlign: 'right', marginTop: 4 },
  choice: { flex: 1, minHeight: 56, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  choiceText: { fontSize: 16 },
  dashed: { borderRadius: 12, borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  dashedText: { fontSize: 11, color: C.tMuted, marginTop: 6, textAlign: 'center' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.surface, borderRadius: 16, padding: 18 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.tPrimary },
});
