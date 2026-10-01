#!/usr/bin/env node
/**
 * Claude Code statusline - context and quota visibility.
 *
 * Runs on every render, so it must be fast and must never throw: a statusline that
 * crashes shows nothing, which is worse than showing a partial line. Every field in the
 * payload except `effort` and `rate_limits` can be absent or null, so every read goes
 * through pick() with a default.
 *
 * Why this exists: 88.5% of measured spend was context re-transmission, and there was no
 * on-screen signal for either context depth or remaining quota. See
 * ~/.claude/plans/last-week-i-got-snappy-rose.md.
 *
 * Debug: `node statusline.js --dump` writes the raw payload to payload-sample.json so
 * field names can be confirmed against reality instead of assumed.
 */
'use strict';

const DUMP = process.argv.includes('--dump');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let d = {};
  try { d = JSON.parse(raw) || {}; } catch { /* keep {} - print what we can */ }

  if (DUMP) {
    try {
      require('fs').writeFileSync(
        require('path').join(__dirname, 'payload-sample.json'),
        JSON.stringify(d, null, 2)
      );
    } catch { /* non-fatal */ }
  }

  try { process.stdout.write(render(d)); }
  catch { process.stdout.write('claude'); }
});

/** Safe nested read: pick(obj, 'a.b.c', fallback). */
function pick(o, path, dflt) {
  let cur = o;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(k in cur)) return dflt;
    cur = cur[k];
  }
  return cur == null ? dflt : cur;
}

const DIM = '\x1b[2m', RESET = '\x1b[0m';
const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', BOLD = '\x1b[1m';

/** Thresholds are deliberately tight: context is the thing that costs money. */
function ctxColour(pct) { return pct >= 70 ? RED : pct >= 40 ? YELLOW : GREEN; }
/** Quota: amber at half, red at three-quarters, so there is time to change behaviour. */
function quotaColour(pct) { return pct >= 75 ? RED : pct >= 50 ? YELLOW : GREEN; }

function render(d) {
  const parts = [];

  // Where am I - basename only; the full path is already in the terminal title.
  const dir = pick(d, 'workspace.current_dir', pick(d, 'cwd', ''));
  if (dir) parts.push(DIM + String(dir).replace(/[\/]+$/, '').split(/[\/]/).pop() + RESET);

  // Which model actually answered. Under `opusplan` this is the field that tells you
  // whether you are in the Opus planning half or the Sonnet execution half.
  const model = pick(d, 'model.display_name', pick(d, 'model.id', ''));
  const effort = pick(d, 'effort.level', '');
  if (model) parts.push(effort ? `${model}/${effort}` : String(model));
  if (pick(d, 'fast_mode', false)) parts.push(RED + 'FAST' + RESET);

  // Context depth - the /clear and /compact trigger.
  const used = pick(d, 'context_window.used_percentage', null);
  const tot = pick(d, 'context_window.total_input_tokens', null);
  if (used != null) {
    const p = Math.round(Number(used));
    const k = tot != null ? ` ${Math.round(Number(tot) / 1000)}k` : '';
    parts.push(`${ctxColour(p)}ctx ${p}%${k}${RESET}`);
  }

  // Cache read vs written this turn - the signal for whether this turn was a cheap warm read
  // or an expensive re-write. Per the header note above, re-transmission (write) is where
  // nearly all measured spend goes, so a write-heavy turn is flagged, a read-heavy one is not.
  // Field names confirmed 2026-09-14 from a real captured payload (`--dump`), not assumed:
  // context_window.current_usage.{cache_read_input_tokens,cache_creation_input_tokens}.
  const cacheRead = pick(d, 'context_window.current_usage.cache_read_input_tokens', null);
  const cacheWrite = pick(d, 'context_window.current_usage.cache_creation_input_tokens', null);
  if (cacheRead != null || cacheWrite != null) {
    const r = Math.round(Number(cacheRead || 0) / 1000);
    const w = Math.round(Number(cacheWrite || 0) / 1000);
    const total = r + w;
    const writeShare = total > 0 ? w / total : 0;
    const cacheColour = writeShare >= 0.5 ? RED : writeShare >= 0.2 ? YELLOW : GREEN;
    parts.push(`${cacheColour}rd${r}k/wr${w}k${RESET}`);
  }

  // Rolling quota windows - the numbers that hit zero and caused the lockout.
  // Confirmed 2026-08-24: `rate_limits` is Claude.ai Pro/Max-only (per docs) and stayed
  // absent through $4+ of this account's own session cost, so it will likely never
  // populate here. The Phase 5 budget-alert task is the real backstop, not this line.
  const d7 = pick(d, 'rate_limits.seven_day.used_percentage', null);
  if (d7 != null) {
    const p = Math.round(Number(d7));
    parts.push(`${quotaColour(p)}${BOLD}7d ${p}%${RESET}`);
  }
  const h5 = pick(d, 'rate_limits.five_hour.used_percentage', null);
  if (h5 != null) parts.push(`${quotaColour(Math.round(Number(h5)))}5h ${Math.round(Number(h5))}%${RESET}`);

  // Session spend to date. Resets on /clear, which makes the reset itself visible.
  const cost = pick(d, 'cost.total_cost_usd', null);
  if (cost != null) parts.push(DIM + '$' + Number(cost).toFixed(2) + RESET);

  return parts.length ? parts.join(DIM + ' | ' + RESET) : 'claude';
}
