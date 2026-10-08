import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/app/css/native.css', import.meta.url), 'utf8');

test('the Create rail never shrinks its tray (its cards spilled out and the last one sat on the rounded edge) and ends with a spacer', () => {
  assert.match(css, /\.cs-rail > \* \{ flex:none; \}/);
  assert.match(css, /\.cs-rail::after \{ content:""; flex:none; height:\d+px; \}/);
});

test('the Create sliders are a plain black line with a small round knob: no filled meter, no gold knob', () => {
  const block = css.slice(css.indexOf('/* Create: the sliders are a plain black line')).replace(/\/\*[^]*?\*\//g, '');
  assert.match(block, /::-webkit-slider-runnable-track[^}]*height:2px[^}]*background:#1f1b16/);
  assert.match(block, /::-webkit-slider-thumb[^}]*border-radius:50%[^}]*background:#fffdf9/);
  assert.doesNotMatch(block, /sliderKnob|sliderTrack|gold/i);
});
