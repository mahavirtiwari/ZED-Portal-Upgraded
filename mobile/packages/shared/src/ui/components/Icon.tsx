import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** An Android vector drawable converted by mobile/tools/convert-vector-drawables.mjs. */
export type IconDefinition = {
  width?: number;
  height?: number;
  viewBox: number[];
  tint?: string;
  paths: Array<{
    d: string;
    fill?: string;
    fillOpacity?: number;
    stroke?: string;
    strokeWidth?: number;
    strokeOpacity?: number;
    strokeLinecap?: string;
    strokeLinejoin?: string;
    strokeMiterlimit?: number;
    fillRule?: string;
    transform?: string;
  }>;
  clips?: Array<{ d: string; transform?: string }>;
};

type Props = {
  icon: IconDefinition;
  /** dp; defaults to the drawable's own size. */
  size?: number;
  width?: number;
  height?: number;
  /** Overrides the drawable's tint (android:tint / app:tint). */
  tint?: string;
  style?: StyleProp<ViewStyle>;
};

export function Icon({ icon, size, width, height, tint, style }: Props) {
  const w = width ?? size ?? icon.width ?? 24;
  const h = height ?? size ?? icon.height ?? 24;
  const color = tint ?? icon.tint;
  const clipId = icon.clips?.length ? 'clip' : undefined;
  return (
    <Svg width={w} height={h} viewBox={icon.viewBox.join(' ')} style={style}>
      {clipId ? (
        <Defs>
          <ClipPath id={clipId}>
            {icon.clips!.map((c, i) => (
              <Path key={i} d={c.d} transform={c.transform} />
            ))}
          </ClipPath>
        </Defs>
      ) : null}
      <G clipPath={clipId ? `url(#${clipId})` : undefined}>
        {icon.paths.map((p, i) => (
          <Path
            key={i}
            d={p.d}
            fill={color && p.fill ? color : p.fill ?? 'none'}
            fillOpacity={p.fillOpacity}
            stroke={color && p.stroke ? color : p.stroke}
            strokeWidth={p.strokeWidth}
            strokeOpacity={p.strokeOpacity}
            strokeLinecap={p.strokeLinecap as never}
            strokeLinejoin={p.strokeLinejoin as never}
            strokeMiterlimit={p.strokeMiterlimit}
            fillRule={p.fillRule as never}
            transform={p.transform}
          />
        ))}
      </G>
    </Svg>
  );
}

/** A linear gradient filling its parent (header_gradient, my_certifications_background, ...). */
export function GradientFill({
  from,
  to,
  angle = 90,
  radius = 0,
  style,
}: {
  from: string;
  to: string;
  /** Android shape angle: 0 = left to right, 90 = bottom to top. */
  angle?: 0 | 90 | 180 | 270 | 'diagonal';
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const coords =
    angle === 0
      ? { x1: '0', y1: '0', x2: '1', y2: '0' }
      : angle === 90
      ? { x1: '0', y1: '1', x2: '0', y2: '0' }
      : angle === 180
      ? { x1: '1', y1: '0', x2: '0', y2: '0' }
      : angle === 270
      ? { x1: '0', y1: '0', x2: '0', y2: '1' }
      : { x1: '0.3', y1: '0', x2: '0.7', y2: '1' };
  return (
    <Svg style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, style]} width="100%" height="100%">
      <Defs>
        <LinearGradient id="g" {...coords}>
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={radius} ry={radius} fill="url(#g)" />
    </Svg>
  );
}
