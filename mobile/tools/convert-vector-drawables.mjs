#!/usr/bin/env node
// Converts the legacy app's Android vector drawables (res/drawable/*.xml) into a TypeScript module of
// icon definitions rendered by @zed/shared's <Icon> with react-native-svg, so the React Native apps
// show exactly the legacy icons.
//
// Usage: node tools/convert-vector-drawables.mjs <legacy res folder> <output .ts file> [name ...]
// The legacy source is read only; only the drawing data (paths and colours) ends up in the output.
import fs from 'node:fs';
import path from 'node:path';

const [resDir, outFile, ...only] = process.argv.slice(2);
if (!resDir || !outFile) {
  console.error('Usage: node convert-vector-drawables.mjs <res folder> <out.ts> [names...]');
  process.exit(1);
}

const colors = {};
const colorsXml = path.join(resDir, 'values', 'colors.xml');
if (fs.existsSync(colorsXml)) {
  for (const m of fs.readFileSync(colorsXml, 'utf8').matchAll(/<color name="([^"]+)">([^<]+)<\/color>/g)) {
    colors[m[1]] = m[2].trim();
  }
}

const androidColors = { white: '#FFFFFF', black: '#000000', transparent: '#00000000' };

/** Android #RGB, #ARGB, #RRGGBB, #AARRGGBB to CSS #RRGGBB plus an opacity. */
function toCss(value) {
  if (!value) return undefined;
  let v = value.trim();
  if (v.startsWith('@color/')) v = colors[v.slice(7)] ?? '#000000';
  else if (v.startsWith('@android:color/')) v = androidColors[v.slice(15)] ?? '#000000';
  else if (v.startsWith('?')) v = '#000000'; // ?attr/colorControlNormal: tinted anyway
  if (!v.startsWith('#')) return undefined;
  let hex = v.slice(1);
  if (hex.length === 3) hex = 'FF' + hex.split('').map(c => c + c).join('');
  else if (hex.length === 4) hex = hex.split('').map(c => c + c).join('');
  else if (hex.length === 6) hex = 'FF' + hex;
  const a = parseInt(hex.slice(0, 2), 16) / 255;
  return { color: '#' + hex.slice(2).toUpperCase(), opacity: Math.round(a * 1000) / 1000 };
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/android:([a-zA-Z]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function dp(v) {
  return v ? parseFloat(v) : undefined;
}

function convert(name, xml) {
  const root = xml.match(/<vector[^>]*>/);
  if (!root) return null;
  const r = attrs(root[0]);
  const icon = {
    width: dp(r.width),
    height: dp(r.height),
    viewBox: [0, 0, parseFloat(r.viewportWidth), parseFloat(r.viewportHeight)],
  };
  const tint = toCss(r.tint);
  if (tint) icon.tint = tint.color;

  const paths = [];
  const clips = [];
  // Walk the elements in order, tracking group transforms (translate/scale/rotate around a pivot).
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)(group|path|clip-path)\b([^>]*?)(\/?)>/g)) {
    const [, closing, el, body, selfClosing] = m;
    if (el === 'group') {
      if (closing) {
        stack.pop();
      } else {
        const g = attrs(body);
        const t = [];
        const px = parseFloat(g.pivotX ?? '0');
        const py = parseFloat(g.pivotY ?? '0');
        if (g.translateX || g.translateY) t.push(`translate(${parseFloat(g.translateX ?? '0') + px} ${parseFloat(g.translateY ?? '0') + py})`);
        else if (px || py) t.push(`translate(${px} ${py})`);
        if (g.rotation) t.push(`rotate(${g.rotation})`);
        if (g.scaleX || g.scaleY) t.push(`scale(${g.scaleX ?? '1'} ${g.scaleY ?? '1'})`);
        if (px || py) t.push(`translate(${-px} ${-py})`);
        if (!selfClosing) stack.push(t.join(' '));
      }
      continue;
    }
    if (closing) continue;
    const a = attrs(body);
    const transform = stack.filter(Boolean).join(' ') || undefined;
    if (el === 'clip-path') {
      clips.push({ d: a.pathData, transform });
      continue;
    }
    const p = { d: a.pathData };
    if (transform) p.transform = transform;
    const fill = toCss(a.fillColor);
    if (fill) {
      p.fill = fill.color;
      const op = fill.opacity * (a.fillAlpha ? parseFloat(a.fillAlpha) : 1);
      if (op < 1) p.fillOpacity = Math.round(op * 1000) / 1000;
    }
    const stroke = toCss(a.strokeColor);
    if (stroke) {
      p.stroke = stroke.color;
      p.strokeWidth = a.strokeWidth ? parseFloat(a.strokeWidth) : 0;
      const op = stroke.opacity * (a.strokeAlpha ? parseFloat(a.strokeAlpha) : 1);
      if (op < 1) p.strokeOpacity = Math.round(op * 1000) / 1000;
      if (a.strokeLineCap) p.strokeLinecap = a.strokeLineCap;
      if (a.strokeLineJoin) p.strokeLinejoin = a.strokeLineJoin;
      if (a.strokeMiterLimit) p.strokeMiterlimit = parseFloat(a.strokeMiterLimit);
    }
    if (a.fillType === 'evenOdd') p.fillRule = 'evenodd';
    paths.push(p);
  }
  icon.paths = paths;
  if (clips.length) icon.clips = clips;
  return icon;
}

const drawableDir = path.join(resDir, 'drawable');
const files = fs.readdirSync(drawableDir).filter(f => f.endsWith('.xml'));
const result = {};
for (const f of files) {
  const name = f.slice(0, -4);
  if (only.length && !only.includes(name)) continue;
  const icon = convert(name, fs.readFileSync(path.join(drawableDir, f), 'utf8'));
  if (icon && icon.paths.length) result[name] = icon;
}

const header =
  '// Generated by mobile/tools/convert-vector-drawables.mjs from the legacy app\'s res/drawable vectors.\n' +
  '// Do not edit by hand: re-run the tool.\n' +
  "import type { IconDefinition } from '@zed/shared';\n\n";
const body = Object.entries(result)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
  .join('\n');
fs.writeFileSync(outFile, `${header}export const icons = {\n${body}\n} satisfies Record<string, IconDefinition>;\n\nexport type IconName = keyof typeof icons;\n`);
console.log(`Wrote ${Object.keys(result).length} icons to ${outFile}`);
