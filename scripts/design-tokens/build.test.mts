import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  CSS_OUTPUT_PATH,
  DART_OUTPUT_PATH,
  contrastRatio,
  loadTokens,
  renderCss,
  renderDart,
  resolveColor,
  toKebabCase,
  validateTokens,
} from './build.mts';

describe('design tokens', () => {
  const tokens = loadTokens();

  it('tokens.json hợp lệ (màu, cặp tương phản WCAG AA, kiểu chữ)', () => {
    assert.deepEqual(validateTokens(tokens), []);
  });

  it('tính tỉ lệ tương phản đúng chuẩn WCAG', () => {
    assert.equal(contrastRatio('#FFFFFF', '#000000').toFixed(1), '21.0');
    assert.equal(contrastRatio('#777777', '#FFFFFF').toFixed(2), '4.48');
  });

  it('phát hiện cặp màu không đủ tương phản', () => {
    const broken = structuredClone(tokens);
    broken.color.light.mutedForeground = 'neutral.300';
    assert.ok(validateTokens(broken).some((e) => e.includes('mutedForeground trên muted')));
  });

  it('phát hiện tham chiếu màu không tồn tại và light/dark lệch nhau', () => {
    const broken = structuredClone(tokens);
    broken.color.dark.primary = 'brand.999';
    broken.color.dark.extra = '#FFFFFF';
    const errors = validateTokens(broken);
    assert.ok(errors.some((e) => e.includes('brand.999')));
    assert.ok(errors.some((e) => e.includes('cùng danh sách màu')));
  });

  it('resolveColor nhận hex và tham chiếu palette', () => {
    assert.equal(resolveColor(tokens, '#abcdef'), '#ABCDEF');
    assert.equal(resolveColor(tokens, 'base.white'), '#FFFFFF');
    assert.throws(() => resolveColor(tokens, 'nope.1'));
  });

  it('đổi tên biến sang kebab-case giống shadcn/ui', () => {
    assert.equal(toKebabCase('cardForeground'), 'card-foreground');
    assert.equal(toKebabCase('sidebarPrimaryForeground'), 'sidebar-primary-foreground');
    assert.equal(toKebabCase('chart1'), 'chart-1');
  });

  it('CSS có đủ biến shadcn/ui cho cả light và dark', () => {
    const css = renderCss(tokens);
    for (const name of [
      'background',
      'primary-foreground',
      'destructive',
      'ring',
      'sidebar-border',
      'chart-5',
    ]) {
      assert.match(css, new RegExp(`--${name}: #`));
      assert.match(css, new RegExp(`--color-${name}: var\\(--${name}\\);`));
    }
    assert.match(css, /^\.dark \{$/m);
  });

  it('Dart có màu light/dark và TextTheme', () => {
    const dart = renderDart(tokens);
    assert.match(dart, /static const light = AppColorTokens\(/);
    assert.match(dart, /static const dark = AppColorTokens\(/);
    assert.match(dart, /primary: Color\(0xFF1D4ED8\),/);
    assert.match(dart, /bodyLarge: body,/);
    assert.match(dart, /static const xxl = 16\.0;/);
  });

  it('file sinh ra đã cập nhật theo tokens.json', () => {
    assert.equal(readFileSync(CSS_OUTPUT_PATH, 'utf8'), renderCss(tokens));
    assert.equal(readFileSync(DART_OUTPUT_PATH, 'utf8'), renderDart(tokens));
  });
});
