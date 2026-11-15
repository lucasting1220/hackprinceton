#!/usr/bin/env node
// Checks XCTest performance metrics in an .xcresult against Debbie's budgets (CRAFT.md §8;
// research note 11b R17). Node built-ins only.
//
//   node tools/perf/check-budgets.mjs <result.xcresult> [budgets.json]
//
// budgets.json: [{ "id": "launch", "test": "DebbiePerfTests/testColdLaunch()", "metric": "Duration (AppLaunch)",
//                  "max": 1000, "unit": "ms", "gate": true, "note": "Simulator regression gate" }, ...]
// "metric" matches a metric's identifier or displayName (substring, case-insensitive).
// The median of the measurements is compared with "max". gate:false budgets are recorded, never fail.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [xcresult, budgetsPath = path.join(here, '..', '..', 'Tests', 'Perf', 'budgets.json')] = process.argv.slice(2);
if (!xcresult) { console.error('usage: check-budgets.mjs <result.xcresult> [budgets.json]'); process.exit(2); }

const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));
const raw = execFileSync('xcrun', ['xcresulttool', 'get', 'test-results', 'metrics', '--path', xcresult, '--compact'], { encoding: 'utf8' });
const tests = JSON.parse(raw);

const toUnit = (value, from, to) => {
  const f = (from || '').toLowerCase(); const t = (to || '').toLowerCase();
  if (f === t) return value;
  const scale = { s: 1, ms: 1e-3, 'µs': 1e-6, us: 1e-6, kb: 1, kib: 1, mb: 1024, mib: 1024 };
  if (f in scale && t in scale) return (value * scale[f]) / scale[t];
  return value;
};
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

let failures = 0;
const rows = [];
for (const b of budgets) {
  const test = tests.find((t) => t.testIdentifier === b.test || t.testIdentifier.includes(b.test));
  const metrics = test ? test.testRuns.flatMap((r) => r.metrics || []) : [];
  const needle = b.metric.toLowerCase();
  const metric = metrics.find((m) => (m.identifier || '').toLowerCase().includes(needle) || (m.displayName || '').toLowerCase().includes(needle));
  if (!metric || !metric.measurements?.length) {
    rows.push([b.id, 'NOT MEASURED', '—', `${b.max} ${b.unit}`, b.gate ? 'gate' : 'record']);
    if (b.gate) failures += 1;
    continue;
  }
  const value = toUnit(median(metric.measurements), metric.unitOfMeasurement, b.unit);
  const ok = value <= b.max;
  if (!ok && b.gate) failures += 1;
  rows.push([b.id, ok ? 'PASS' : (b.gate ? 'FAIL' : 'OVER (record only)'), `${value.toFixed(1)} ${b.unit} (median of ${metric.measurements.length})`, `${b.max} ${b.unit}`, b.gate ? 'gate' : 'record']);
}
console.log('| Budget | Result | Measured | Limit | Kind |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
process.exit(failures ? 1 : 0);
