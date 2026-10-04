// Sinh design token cho admin web (CSS cho Tailwind v4 + shadcn/ui) và mobile (Dart cho Flutter)
// từ một nguồn duy nhất: docs/design-system/tokens/tokens.json.
//
//   node scripts/design-tokens/build.mts           ghi file sinh ra
//   node scripts/design-tokens/build.mts --check   chỉ kiểm tra (token hợp lệ + file sinh ra đã cập nhật)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TOKENS_PATH = join(ROOT_DIR, 'docs/design-system/tokens/tokens.json');
export const CSS_OUTPUT_PATH = join(ROOT_DIR, 'docs/design-system/tokens/generated/tokens.css');
export const DART_OUTPUT_PATH = join(
  ROOT_DIR,
  'docs/design-system/tokens/generated/app_tokens.dart',
);

type Theme = 'light' | 'dark';
interface FontSize {
  size: number;
  lineHeight: number;
}
interface TextStyle {
  fontSize: string;
  fontWeight: string;
  flutter: string;
}
interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
}
export interface Tokens {
  palette: Record<string, Record<string, string>>;
  color: Record<Theme, Record<string, string>>;
  contrast: { pairs: [string, string, number][] };
  typography: {
    fontFamily: { sans: string[]; mono: string[] };
    fontWeight: Record<string, number>;
    fontSize: Record<string, FontSize>;
    textStyle: Record<string, TextStyle>;
  };
  spacing: Record<string, number>;
  radius: Record<string, number>;
  shadow: Record<string, ShadowLayer[]>;
  breakpoint: { web: Record<string, number>; flutter: Record<string, number> };
  layout: Record<string, number>;
  motion: { duration: Record<string, number>; easing: Record<string, number[]> };
  zIndex: Record<string, number>;
  icon: { size: Record<string, number>; strokeWidth: number };
}

const HEX_PATTERN = /^#[0-9A-F]{6}$/;
const THEMES: Theme[] = ['light', 'dark'];
const HEADER_NOTE =
  'GENERATED — không sửa tay. Nguồn: docs/design-system/tokens/tokens.json. Chạy: npm run tokens:build';

export function loadTokens(path = TOKENS_PATH): Tokens {
  return JSON.parse(readFileSync(path, 'utf8')) as Tokens;
}

/** Trả về hex (#RRGGBB) của một giá trị màu: hex trực tiếp hoặc tham chiếu `<palette>.<step>`. */
export function resolveColor(tokens: Tokens, value: string): string {
  if (value.startsWith('#')) {
    return value.toUpperCase();
  }
  const [group, step] = value.split('.');
  const hex = group !== undefined && step !== undefined ? tokens.palette[group]?.[step] : undefined;
  if (hex === undefined) {
    throw new Error(`Không tìm thấy màu "${value}" trong palette`);
  }
  return hex.toUpperCase();
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channelToLinear(parseInt(hex.slice(i, i + 2), 16))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tỉ lệ tương phản WCAG giữa hai màu hex. */
export function contrastRatio(hexA: string, hexB: string): number {
  const [lighter, darker] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Kiểm tra token, trả về danh sách lỗi (rỗng nếu hợp lệ). */
export function validateTokens(tokens: Tokens): string[] {
  const errors: string[] = [];

  for (const [group, steps] of Object.entries(tokens.palette)) {
    for (const [step, hex] of Object.entries(steps)) {
      if (!HEX_PATTERN.test(hex.toUpperCase())) {
        errors.push(`palette.${group}.${step}: "${hex}" không phải hex #RRGGBB`);
      }
    }
  }

  const lightKeys = Object.keys(tokens.color.light).sort().join(',');
  const darkKeys = Object.keys(tokens.color.dark).sort().join(',');
  if (lightKeys !== darkKeys) {
    errors.push('color.light và color.dark phải có cùng danh sách màu');
  }

  for (const theme of THEMES) {
    for (const [name, value] of Object.entries(tokens.color[theme])) {
      try {
        resolveColor(tokens, value);
      } catch (error) {
        errors.push(`color.${theme}.${name}: ${(error as Error).message}`);
      }
    }
    for (const [fg, bg, min] of tokens.contrast.pairs) {
      const fgValue = tokens.color[theme][fg];
      const bgValue = tokens.color[theme][bg];
      if (fgValue === undefined || bgValue === undefined) {
        errors.push(`contrast: không có màu "${fg}" hoặc "${bg}" trong theme ${theme}`);
        continue;
      }
      try {
        const ratio = contrastRatio(resolveColor(tokens, fgValue), resolveColor(tokens, bgValue));
        if (ratio < min) {
          errors.push(`contrast ${theme}: ${fg} trên ${bg} = ${ratio.toFixed(2)}, cần >= ${min}`);
        }
      } catch {
        // Lỗi tham chiếu đã được báo ở trên.
      }
    }
  }

  for (const [name, style] of Object.entries(tokens.typography.textStyle)) {
    if (tokens.typography.fontSize[style.fontSize] === undefined) {
      errors.push(`typography.textStyle.${name}: không có fontSize "${style.fontSize}"`);
    }
    if (tokens.typography.fontWeight[style.fontWeight] === undefined) {
      errors.push(`typography.textStyle.${name}: không có fontWeight "${style.fontWeight}"`);
    }
  }

  for (const [name, easing] of Object.entries(tokens.motion.easing)) {
    if (easing.length !== 4) {
      errors.push(`motion.easing.${name}: cần đúng 4 số cubic-bezier`);
    }
  }

  return errors;
}

// ---------- CSS (Tailwind v4 + shadcn/ui) ----------

/** cardForeground -> card-foreground, chart1 -> chart-1 */
export function toKebabCase(name: string): string {
  return name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
}

const rem = (px: number): string => `${px / 16}rem`;

function hexToRgbChannels(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
}

function cssShadow(tokens: Tokens, layers: ShadowLayer[]): string {
  return layers
    .map((l) => {
      const rgb = hexToRgbChannels(resolveColor(tokens, l.color));
      return `${l.x}px ${l.y}px ${l.blur}px ${l.spread}px rgb(${rgb} / ${l.opacity})`;
    })
    .join(', ');
}

function cssFontStack(fonts: string[]): string {
  return fonts.map((f) => (/[\s-]/.test(f) && !f.startsWith('-') ? `"${f}"` : f)).join(', ');
}

export function renderCss(tokens: Tokens): string {
  const lines: string[] = [`/* ${HEADER_NOTE} */`, '', '@custom-variant dark (&:is(.dark *));', ''];

  for (const theme of THEMES) {
    lines.push(theme === 'light' ? ':root {' : '.dark {');
    if (theme === 'light') {
      lines.push(`  --radius: ${rem(tokens.radius['lg'] ?? 8)};`);
    }
    for (const [name, value] of Object.entries(tokens.color[theme])) {
      lines.push(`  --${toKebabCase(name)}: ${resolveColor(tokens, value)};`);
    }
    if (theme === 'light') {
      for (const [name, ms] of Object.entries(tokens.motion.duration)) {
        lines.push(`  --duration-${name}: ${ms}ms;`);
      }
      for (const [name, px] of Object.entries(tokens.layout)) {
        lines.push(`  --${toKebabCase(name)}: ${rem(px)};`);
      }
      for (const [name, z] of Object.entries(tokens.zIndex)) {
        lines.push(`  --z-${name}: ${z};`);
      }
      for (const [name, px] of Object.entries(tokens.icon.size)) {
        lines.push(`  --icon-${name}: ${rem(px)};`);
      }
      lines.push(`  --icon-stroke-width: ${tokens.icon.strokeWidth};`);
    }
    lines.push('}', '');
  }

  lines.push('@theme inline {');
  for (const name of Object.keys(tokens.color.light)) {
    const kebab = toKebabCase(name);
    lines.push(`  --color-${kebab}: var(--${kebab});`);
  }
  lines.push(`  --font-sans: ${cssFontStack(tokens.typography.fontFamily.sans)};`);
  lines.push(`  --font-mono: ${cssFontStack(tokens.typography.fontFamily.mono)};`);
  for (const [name, fs] of Object.entries(tokens.typography.fontSize)) {
    lines.push(`  --text-${name}: ${rem(fs.size)};`);
    lines.push(`  --text-${name}--line-height: ${rem(fs.lineHeight)};`);
  }
  lines.push('  --spacing: 0.25rem;');
  for (const [name, px] of Object.entries(tokens.radius)) {
    if (name !== 'full') {
      lines.push(`  --radius-${name}: ${rem(px)};`);
    }
  }
  for (const [name, layers] of Object.entries(tokens.shadow)) {
    lines.push(`  --shadow-${name}: ${cssShadow(tokens, layers)};`);
  }
  for (const [name, px] of Object.entries(tokens.breakpoint.web)) {
    lines.push(`  --breakpoint-${name}: ${rem(px)};`);
  }
  for (const [name, [x1, y1, x2, y2]] of Object.entries(tokens.motion.easing) as [
    string,
    number[],
  ][]) {
    lines.push(`  --ease-${name}: cubic-bezier(${x1}, ${y1}, ${x2}, ${y2});`);
  }
  lines.push('}', '');

  return lines.join('\n');
}

// ---------- Dart (Flutter) ----------

const dartColor = (hex: string): string => `Color(0xFF${hex.slice(1)})`;
const dartNumber = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** "2xl" -> "xxl" để thành tên hợp lệ trong Dart. */
function dartName(key: string): string {
  const match = /^(\d)xl$/.exec(key);
  return match?.[1] !== undefined ? `${'x'.repeat(Number(match[1]))}l` : key;
}

function dartShadowColor(tokens: Tokens, layer: ShadowLayer): string {
  const alpha = Math.round(layer.opacity * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
  return `Color(0x${alpha}${resolveColor(tokens, layer.color).slice(1)})`;
}

function dartConstClass(name: string, doc: string, fields: string[]): string[] {
  return [
    `/// ${doc}`,
    `abstract final class ${name} {`,
    ...fields.map((f) => `  static const ${f}`),
    '}',
    '',
  ];
}

/** Ánh xạ token màu sang ColorScheme Material 3. Màu không có trong ColorScheme (success, warning, info, sidebar, chart) dùng qua AppColorTokens. */
const COLOR_SCHEME_MAP: [string, string][] = [
  ['primary', 'primary'],
  ['onPrimary', 'primaryForeground'],
  ['primaryContainer', 'accent'],
  ['onPrimaryContainer', 'accentForeground'],
  ['secondary', 'secondary'],
  ['onSecondary', 'secondaryForeground'],
  ['secondaryContainer', 'accent'],
  ['onSecondaryContainer', 'accentForeground'],
  ['error', 'destructive'],
  ['onError', 'destructiveForeground'],
  ['surface', 'background'],
  ['onSurface', 'foreground'],
  ['onSurfaceVariant', 'mutedForeground'],
  ['surfaceContainerLowest', 'background'],
  ['surfaceContainerLow', 'card'],
  ['surfaceContainer', 'card'],
  ['surfaceContainerHigh', 'muted'],
  ['surfaceContainerHighest', 'muted'],
  ['outline', 'input'],
  ['outlineVariant', 'border'],
];

export function renderDart(tokens: Tokens): string {
  const colorNames = Object.keys(tokens.color.light);
  const lines: string[] = [
    `// ${HEADER_NOTE}`,
    '// ignore_for_file: lines_longer_than_80_chars',
    '',
    "import 'package:flutter/material.dart';",
    '',
    '/// Màu theo vai trò (giống tên biến CSS của shadcn/ui). Dùng `AppColorTokens.light` / `.dark`.',
    'class AppColorTokens {',
    '  const AppColorTokens({',
    ...colorNames.map((n) => `    required this.${n},`),
    '  });',
    '',
    ...colorNames.map((n) => `  final Color ${n};`),
    '',
  ];

  for (const theme of THEMES) {
    lines.push(`  static const ${theme} = AppColorTokens(`);
    for (const [name, value] of Object.entries(tokens.color[theme])) {
      lines.push(`    ${name}: ${dartColor(resolveColor(tokens, value))},`);
    }
    lines.push('  );', '');
  }

  lines.push(
    '  ColorScheme toColorScheme(Brightness brightness) => ColorScheme(',
    '        brightness: brightness,',
    ...COLOR_SCHEME_MAP.map(([scheme, token]) => `        ${scheme}: ${token},`),
    '        shadow: Colors.black,',
    '        scrim: Colors.black,',
    '      );',
    '}',
    '',
  );

  const { typography } = tokens;
  lines.push(
    '/// Font và kiểu chữ. `textTheme` ánh xạ sang TextTheme Material 3.',
    'abstract final class AppTypography {',
    `  static const fontFamily = '${typography.fontFamily.sans[0] ?? ''}';`,
    `  static const fontFamilyFallback = <String>[${typography.fontFamily.sans
      .slice(1)
      .map((f) => `'${f}'`)
      .join(', ')}];`,
    '',
  );
  for (const [name, style] of Object.entries(typography.textStyle)) {
    const fs = typography.fontSize[style.fontSize] ?? { size: 16, lineHeight: 24 };
    const weight = typography.fontWeight[style.fontWeight] ?? 400;
    lines.push(
      `  static const ${name} = TextStyle(`,
      '    fontFamily: fontFamily,',
      '    fontFamilyFallback: fontFamilyFallback,',
      `    fontSize: ${dartNumber(fs.size)},`,
      `    height: ${Number((fs.lineHeight / fs.size).toFixed(4))},`,
      `    fontWeight: FontWeight.w${weight},`,
      '  );',
    );
  }
  lines.push(
    '',
    '  static const textTheme = TextTheme(',
    ...Object.entries(typography.textStyle).map(
      ([name, style]) => `    ${style.flutter}: ${name},`,
    ),
    '  );',
    '}',
    '',
  );

  lines.push(
    ...dartConstClass(
      'AppSpacing',
      'Khoảng cách (px logic), tên theo giá trị: s16 = 16. Tương ứng Tailwind: s16 = p-4.',
      Object.values(tokens.spacing)
        .sort((a, b) => a - b)
        .map((px) => `s${px} = ${dartNumber(px)};`),
    ),
    ...dartConstClass(
      'AppRadius',
      'Bo góc (px logic).',
      Object.entries(tokens.radius).map(([n, px]) => `${dartName(n)} = ${dartNumber(px)};`),
    ),
    '/// Đổ bóng, tương ứng shadow-sm/md/lg/xl của Tailwind.',
    'abstract final class AppShadows {',
  );
  for (const [name, layers] of Object.entries(tokens.shadow)) {
    lines.push(`  static const ${name} = <BoxShadow>[`);
    for (const l of layers) {
      lines.push(
        `    BoxShadow(color: ${dartShadowColor(tokens, l)}, offset: Offset(${dartNumber(l.x)}, ${dartNumber(l.y)}), blurRadius: ${dartNumber(l.blur)}, spreadRadius: ${dartNumber(l.spread)}),`,
      );
    }
    lines.push('  ];');
  }
  lines.push(
    '}',
    '',
    ...dartConstClass(
      'AppBreakpoints',
      'Mốc chiều rộng cửa sổ theo window size class Material 3 (compact < medium).',
      Object.entries(tokens.breakpoint.flutter).map(([n, px]) => `${n} = ${dartNumber(px)};`),
    ),
    ...dartConstClass(
      'AppLayout',
      'Kích thước bố cục (px logic).',
      Object.entries(tokens.layout).map(([n, px]) => `${n} = ${dartNumber(px)};`),
    ),
    ...dartConstClass(
      'AppDurations',
      'Thời lượng chuyển động.',
      Object.entries(tokens.motion.duration).map(
        ([n, ms]) => `${n} = Duration(milliseconds: ${ms});`,
      ),
    ),
    ...dartConstClass(
      'AppEasing',
      'Đường cong chuyển động (cubic-bezier).',
      Object.entries(tokens.motion.easing).map(
        ([n, c]) => `${n} = Cubic(${c.map(dartNumber).join(', ')});`,
      ),
    ),
    ...dartConstClass('AppIconSize', 'Kích thước icon.', [
      ...Object.entries(tokens.icon.size).map(([n, px]) => `${n} = ${dartNumber(px)};`),
      `strokeWidth = ${dartNumber(tokens.icon.strokeWidth)};`,
    ]),
  );

  return lines.join('\n');
}

// ---------- CLI ----------

function main(): void {
  const check = process.argv.includes('--check');
  const tokens = loadTokens();
  const errors = validateTokens(tokens);
  if (errors.length > 0) {
    console.error(`Design token không hợp lệ:\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }

  const outputs: [string, string][] = [
    [CSS_OUTPUT_PATH, renderCss(tokens)],
    [DART_OUTPUT_PATH, renderDart(tokens)],
  ];

  if (check) {
    const stale = outputs.filter(([path, content]) => {
      try {
        return readFileSync(path, 'utf8') !== content;
      } catch {
        return true;
      }
    });
    if (stale.length > 0) {
      console.error(
        `File token chưa cập nhật, chạy "npm run tokens:build":\n- ${stale.map(([p]) => relative(ROOT_DIR, p)).join('\n- ')}`,
      );
      process.exit(1);
    }
    return;
  }

  for (const [path, content] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.warn(`Đã ghi ${relative(ROOT_DIR, path)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
