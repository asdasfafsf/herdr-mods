// Synthetic presentation only. Never initialize a reader or select/confirm/use a
// credit, even with a mock. Only the disclosure and popup-entry handlers run.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHIIKAWA_THEME } from '../mods/theme-chiikawa/palette.js';

const source = readFileSync('mods/usage-bar/main.js', 'utf8');
const handlers = new Map();
function builder(kind = 'div', id) {
  const node = { kind, ops: id === undefined ? [] : [['id', [id]]] };
  const proxy = new Proxy(node, { get(target, key) {
    if (key === 'toJSON') return () => node;
    if (key === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key in target) return target[key];
    return (...args) => {
      const id = node.ops.find(([name]) => name === 'id')?.[1][0];
      // Explicit allowlist: action buttons and Refresh have no callable handler here.
      if ((key === 'on_change' && id === 'reset-credits-toggle') ||
          (key === 'on_key_down' && id === 'reset-credits-control') ||
          (key === 'on_click' && id === 'usage-pill')) handlers.set(id, args[0]);
      if (key === 'hover' || key === 'focus') args = [args[0](builder(`${key}-style`))];
      node.ops.push([key, args.map(value => typeof value === 'function' ? '[handler]' : value)]);
      return proxy;
    };
  }});
  return proxy;
}
const component = kind => ({ new: id => builder(kind, id) });
const forbidden = () => { throw new Error('Presentation checks cannot call host actions'); };
let properties = { mode: 'detail' }, overlay, palette, viewport = { width: 1440, height: 1000 };
const Type = new Function('View', 'div', 'image', 'svg', 'v_flex', 'h_flex',
  'Accordion', 'AccordionItem', 'AccordionHeader', 'AccordionTrigger', 'AccordionPanel',
  'props', 'theme', 'openOverlay', 'closeOverlay', 'agoText', 'button', 'exec', 'appHome', 'window',
  source.replace(/^import .*;\n/gm, '').replace('export default class UsageBar', 'return class UsageBar'))(
  class {}, () => builder(), () => builder('image'), () => builder('svg'),
  () => builder('column'), () => builder('row'), component('accordion'), component('accordion-item'),
  { new: trigger => builder('accordion-header').child(trigger) }, component('accordion-trigger'), component('accordion-panel'),
  () => properties, () => palette, value => { overlay = value; }, forbidden, time => `age ${time}`,
  // Do not retain or invoke credit-selection or confirmation callbacks.
  (id, label, _fn, _t, options = {}) => builder('button', id).child(label).disabled(Boolean(options.disabled)),
  forbidden, forbidden, { viewport_size: () => viewport });

const fixture = JSON.parse(readFileSync('docs/porting/fixtures/usage.json', 'utf8'));
const credit = { id: 'one', title: 'Bonus reset', status: 'available', grantedAt: 1794500000,
  expiresAt: 1894500000, description: 'A plan reset' };
const summary = { availableCount: 2, credits: [credit], updated: 100 };
const usageWith = summary => ({ ...structuredClone(fixture), codex: { ...structuredClone(fixture.codex), resetCredits: summary } });
const cases = [
  ['unavailable', null, 'Unavailable', "Reset credit information isn't available. Try Refresh."],
  ['invalid', { availableCount: -1 }, 'Unavailable', "Reset credit information isn't available. Try Refresh."],
  ['zero', { availableCount: 0, credits: [], updated: 100 }, '0 available', 'No reset credits available.'],
  ['count-only', { availableCount: 2, credits: null, updated: 100 }, '2 available', "Individual credit details aren't available."],
  ['partial', summary, '2 available', 'Showing 1 of 2 available credits.'],
  ['no-expiration', { ...summary, availableCount: 1, credits: [{ ...credit, expiresAt: null }] }, '1 available', 'No expiration'],
  ['expired', { ...summary, availableCount: 0, credits: [{ ...credit, expiresAt: 100 }] }, '0 available', 'Expired'],
  ['long-list', { ...summary, availableCount: 12, credits: Array.from({ length: 12 }, (_, i) => ({
    ...credit, id: `long-${i}`, title: `Bonus credit ${i + 1} with a longer title that should wrap`,
    description: 'This longer description stays readable inside the expanded panel without relying on hover text.',
  })) }, '12 available', 'Bonus credit 12'],
];

// Light/dark fixtures check token plumbing, not a copy of the host's palettes.
const palettes = {
  light: { foreground: '#222222', muted: '#555555', dim: '#777777', hover: '#eeeeee', selected: '#dddddd',
    accent: '#315b90', border: '#cccccc', working: '#876523', blocked: '#a83232', popover: '#ffffff', chrome: '#f4f4f4' },
  dark: { foreground: '#eeeeee', muted: '#bbbbbb', dim: '#999999', hover: '#333333', selected: '#444444',
    accent: '#8cb4e8', border: '#555555', working: '#e5bd65', blocked: '#ed8888', popover: '#222222', chrome: '#181818' },
  chiikawa: CHIIKAWA_THEME.colors,
};
const tree = view => { handlers.clear(); return JSON.parse(JSON.stringify(view.render({}))); };
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...Object.values(node).flatMap(nodes)];
const op = (node, name) => node?.ops?.find(([key]) => key === name)?.[1];
const byId = (root, id) => nodes(root).find(node => op(node, 'id')?.[0] === id);
const display = (root, label) => nodes(root).find(node => op(node, 'child')?.[0] === label);
const assertCollapsed = root => {
  const text = JSON.stringify(root);
  assert.ok(text.includes('Show details'));
  for (const hidden of ['reset-credits-details', 'reset-use-', 'Bonus reset', 'A plan reset', 'Granted ', 'Expires ', 'Expired ', 'As of ', 'No reset credits', 'Individual credit details', 'Showing ']) {
    assert.ok(!text.includes(hidden), `Collapsed panel leaked: ${hidden}`);
  }
  assert.deepEqual(op(nodes(root).find(node => node.kind === 'accordion-item'), 'open'), [false]);
};
let notifications = 0;
const cx = { notify() { notifications++; } };
for (const [themeName, colors] of Object.entries(palettes)) {
  palette = colors;
  properties = { mode: 'detail' };
  for (const [name, value, label, detail] of cases) {
    const view = new Type(); // Deliberately skip init: no reads, timers or host calls.
    view.resetCreditsFocus = { focus() {} };
    view.usage = usageWith(value);
    const original = JSON.stringify(view.usage);
    let root = tree(view);
    const collapsed = root;
    assertCollapsed(root);
    assert.ok(display(root, label), `${themeName}/${name}: ${label}`);
    const trigger = byId(root, 'reset-credits-toggle');
    const control = byId(root, 'reset-credits-control');
    assert.equal(trigger.kind, 'accordion-trigger');
    for (const unsupported of ['accessibility_label', 'hover', 'focus', 'track_focus']) assert.equal(op(trigger, unsupported), undefined);
    assert.deepEqual(op(control, 'accessibility_label'), [`Reset credits: ${label}. Collapsed. Show details`]);
    assert.deepEqual(op(control, 'bg'), [colors.hover]);
    assert.deepEqual(op(control, 'border_color'), [colors.border]);
    assert.ok(op(control, 'track_focus'));
    assert.deepEqual(op(control, 'tab_stop'), [true]);
    assert.ok(byId(root, 'reset-credits-heading'));
    assert.ok(byId(root, 'reset-credits-region'));
    assert.deepEqual(op(display(root, label), 'text_color'), [value?.availableCount > 0 ? colors.accent : colors.muted]);

    handlers.get('reset-credits-toggle')(true, cx);
    root = tree(view);
    assert.ok(JSON.stringify(root).includes(detail), `${themeName}/${name}: expanded detail`);
    assert.ok(display(root, 'Hide details'));
    for (const id of ['reset-credits-details', 'usage-detail-scroll', 'usage-close', 'usage-refresh']) assert.ok(byId(root, id));
    const scroll = byId(root, 'usage-detail-scroll');
    assert.deepEqual(op(scroll, 'min_h'), [0]);
    assert.ok(op(scroll, 'overflow_y_scroll'));
    assert.ok(op(scroll, 'flex_1'));
    assert.ok(op(byId(root, 'reset-credits-details'), 'flex_none'));
    if (name === 'long-list') {
      assert.equal(nodes(scroll).filter(node => op(node, 'id')?.[0]?.startsWith('reset-credit-long-')).length, 12);
      for (const item of value.credits) {
        for (const text of [item.title, item.description]) {
          assert.ok(op(display(root, text), 'whitespace_normal'));
          assert.equal(op(display(root, text), 'truncate'), undefined);
        }
        assert.ok(op(byId(root, `reset-credit-${item.id}`), 'flex_none'));
      }
    }
    if (name === 'partial') {
      for (const text of ['Bonus reset', 'A plan reset']) assert.ok(op(display(root, text), 'whitespace_normal'));
      assert.ok(JSON.stringify(root).includes('Expires'));
    }
    // Updating data in place preserves the local disclosure state.
    view.usage = usageWith(value);
    assert.ok(byId(tree(view), 'reset-credits-details'));
    handlers.get('reset-credits-toggle')(false, cx);
    const folded = tree(view);
    assertCollapsed(folded);
    assert.deepEqual(byId(folded, 'reset-credits'), byId(collapsed, 'reset-credits'), 'Folding restores the original summary size and tree');
    assert.equal(JSON.stringify(view.usage), original, 'Disclosure never changes usage data');
    const reopened = new Type();
    reopened.usage = usageWith(value);
    assertCollapsed(tree(reopened));
  }
}
assert.equal(notifications, Object.keys(palettes).length * cases.length * 2);

// Only disclosure keys are dispatched, directly to the supported plain wrapper.
// This verifies script behavior, not native focus traversal or screen-reader output.
const keyboardView = new Type();
keyboardView.usage = usageWith(summary);
let focuses = 0, stopped = 0;
keyboardView.resetCreditsFocus = { focus() { focuses++; } };
const keyContext = { notify() {}, stop_propagation() { stopped++; } };
const key = event => { tree(keyboardView); handlers.get('reset-credits-control')(event, keyContext); };
key({ key: 'enter' });
assert.equal(keyboardView.resetCreditsExpanded, true);
key({ key: 'enter', is_held: true });
assert.equal(keyboardView.resetCreditsExpanded, true);
key({ key: 'space' });
assert.equal(keyboardView.resetCreditsExpanded, false);
key({ key: 'enter', modifiers: { platform: true } });
key({ key: 'escape' });
assert.equal(keyboardView.resetCreditsExpanded, false);
assert.equal(stopped, 3);
tree(keyboardView);
handlers.get('reset-credits-toggle')(true, keyContext);
assert.equal(focuses, 1, 'Pointer disclosure requests focus on the wrapper');

// Collapsed rendering must not inspect individual details, even when cached.
properties = { mode: 'detail' };
const view = new Type();
view.usage = usageWith({ availableCount: 123, updated: 100 });
Object.defineProperty(view.usage.codex.resetCredits, 'credits', { get: forbidden });
assertCollapsed(tree(view));

properties = {};
for (const width of [360, 480, 720, 1200]) for (const [value, marker, label] of [
  [null, '↺ —', 'Unavailable'], [{ availableCount: 0 }, '↺ 0', '0 available'], [summary, '↺ 2', '2 available'],
]) {
  view.width = width;
  view.usage = usageWith(value);
  const root = tree(view);
  assert.ok(display(root, marker), `${width}: ${marker}`);
  assert.ok(JSON.stringify(root).includes(`Reset credits: ${label}`));
  if (value === summary) {
    assert.ok(op(byId(root, 'usage-reset-count'), 'tooltip')[0].includes('(as of age 100)'), 'Count tooltip uses the credit timestamp');
    assert.ok(op(byId(root, 'usage-codex'), 'tooltip')[0].includes('Reset credits: 2 available (as of age 100)'));
    assert.ok(op(byId(root, 'usage-codex'), 'tooltip')[0].includes(`\nas of age ${fixture.codex.updated}`), 'Usage keeps its own newer timestamp');
  }
  assert.ok(byId(root, 'usage-refresh'));
  assert.deepEqual(op(byId(root, 'usage-pill'), 'max_w'), [width - 116]);
  assert.deepEqual(op(byId(root, 'usage-limits'), 'min_w'), [0]);
  assert.ok(op(byId(root, 'usage-limits'), 'overflow_x_scroll'));
  assert.ok(op(byId(root, 'usage-reset-count'), 'flex_none'));
  assert.equal(byId(byId(root, 'usage-limits'), 'usage-reset-count'), undefined, 'Count stays outside the scrolling limits');
  assert.ok(op(byId(root, 'usage-refresh'), 'flex_none'));
  handlers.get('usage-pill')();
  assert.equal(overlay.props.mode, 'detail');
  assert.equal(overlay.width, 480);
  assert.equal(overlay.height, 680, 'Popup leaves room for details, independent of the credit list');
}
view.usage = usageWith(cases.find(([name]) => name === 'long-list')[1]);
tree(view);
handlers.get('usage-pill')();
assert.equal(overlay.height, 680, 'A long credit list does not enlarge the popup');
console.log('usage rendering: collapsed/open/close/reopen, unknown/zero/count-only/partial/expiry/long list, semantic palettes and 360–1200px descriptions passed');

// Pure layout descriptions: no reader, Refresh, reset selection or execution.
const longUsage = usageWith(cases.find(([name]) => name === 'long-list')[1]);
for (const provider of Object.values(longUsage)) {
  provider.plan = 'An extended plan name with additional provider-specific allowance details';
  provider.error = 'A long read-only diagnostic describing why this provider could not return a fresh reading.';
  provider.windows = Array.from({ length: 8 }, (_, i) => ({
    name: `Allowance ${i + 1} with a long provider-specific name that needs multiple lines`,
    used: i % 2 ? 100 : 99.5, resets: i % 2 ? 100 : 1893956000,
  }));
}
for (const colors of Object.values(palettes)) for (const [width, height] of [
  [240, 320], [320, 480], [480, 640], [800, 600], [1440, 1000],
]) {
  palette = colors;
  viewport = { width, height };
  for (const usage of [{}, { codex: structuredClone(fixture.codex) }, usageWith(summary), longUsage]) {
    const layoutView = new Type();
    layoutView.usage = usage;
    properties = {};
    if (Object.keys(usage).length) {
      tree(layoutView);
      handlers.get('usage-pill')();
      assert.equal(overlay.width, Math.min(480, width - 32));
      assert.ok(overlay.height <= height - 32);
      if (height === 1000) assert.equal(overlay.height, usage === longUsage ? 800 : usage.codex && !usage.claude ? 620 : 680);
    }
    properties = { mode: 'detail' };
    for (const expanded of [false, true]) {
      layoutView.resetCreditsExpanded = expanded;
      const root = tree(layoutView), scroll = byId(root, 'usage-detail-scroll');
      assert.deepEqual(op(root, 'min_w'), [0]);
      assert.deepEqual(op(root, 'min_h'), [0]);
      assert.deepEqual(op(root, 'w'), [Math.min(480, width - 32)]);
      assert.ok(op(root, 'h')[0] <= height - 32);
      assert.ok(op(root, 'max_w_full') && op(root, 'max_h_full'), 'Root also fits its host overlay');
      if (Object.keys(usage).length) assert.deepEqual([op(root, 'w')[0], op(root, 'h')[0]], [overlay.width, overlay.height]);
      assert.ok(byId(root, 'usage-close') && byId(root, 'usage-refresh'));
      assert.equal(byId(scroll, 'usage-close'), undefined);
      assert.equal(byId(scroll, 'usage-refresh'), undefined);
      for (const node of nodes(root).filter(node => typeof op(node, 'child')?.[0] === 'string')) {
        const label = op(node, 'child')[0];
        if (/Allowance |extended plan|Couldn't ask|resets in|reset at|Granted |Expires |Expired |longer title|longer description|No usage/.test(label)) {
          assert.ok(op(node, 'whitespace_normal'), `Text should wrap: ${label}`);
          assert.equal(op(node, 'truncate'), undefined);
        }
        if (label === '100%' || label === 'reset since') assert.ok(op(node, 'flex_none'), 'Provider figures must not shrink');
      }
      if (usage.codex) {
        const control = byId(root, 'reset-credits-control');
        assert.equal(op(control, 'h'), undefined, 'Disclosure can grow when its labels wrap');
        assert.ok(op(control, 'flex_wrap'));
      }
      if (!expanded && usage.codex) assertCollapsed(root);
    }
  }
}
viewport = { width: 1440, height: 1000 };
console.log('usage layout: 3 palettes × 5 viewports × 4 data sets × collapsed/expanded, long provider text, fixed actions and 620–800px sizing passed');

// Native eager-element checks only: temporary modules and synthetic data, never
// installed. No layout, account calls, reset selection/redemption or real sessions.
if (process.argv.includes('--native')) {
  const directory = mkdtempSync(join(tmpdir(), 'herdr-usage-view-'));
  try {
    for (const file of ['ui', 'state', 'agent-status']) writeFileSync(join(directory, `${file}.js`),
      readFileSync(`lib/${file}.js`, 'utf8').replaceAll('from "herdr"', 'from "./synthetic-herdr.js"'));
    writeFileSync(join(directory, 'usage.js'), source.replaceAll('from "herdr"', 'from "./synthetic-herdr.js"'));
    let checks = 0;
    const check = label => {
      const result = spawnSync('herdr-app', ['check', directory], { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, `${label}: ${result.stdout}${result.stderr}${result.error ?? ''}`);
      checks++;
    };
    for (const [themeName, colors] of Object.entries(palettes)) {
      writeFileSync(join(directory, 'synthetic-herdr.js'), `
export const theme=()=>(${JSON.stringify(colors)}),props=()=>({mode:'detail'}),shared=()=>null;
const forbidden=()=>{throw Error('Presentation checks cannot call host actions')};
export const exec=forbidden,appHome=forbidden,openOverlay=forbidden,closeOverlay=forbidden,setShared=forbidden;
`);
      for (const [name, value] of cases.filter(([name]) => name !== 'invalid')) for (const expanded of [false, true]) {
        writeFileSync(join(directory, 'main.js'), `
import Usage from './usage.js';
export default class Probe extends Usage {
  init(_props,cx){this.usage=${JSON.stringify(usageWith(value))};this.resetCreditsExpanded=${expanded};this.resetCreditsFocus=cx.focus_handle();}
}
`);
        check(`${themeName}/${name}/${expanded}`);
      }
      for (const expanded of [false, true]) {
        writeFileSync(join(directory, 'main.js'), `
import Usage from './usage.js';
export default class Probe extends Usage {
  init(_props,cx){this.usage=${JSON.stringify(longUsage)};this.resetCreditsExpanded=${expanded};this.resetCreditsFocus=cx.focus_handle();}
}
`);
        check(`${themeName}/long-provider-text/${expanded}`);
      }
      // Use the same native view at each width without opening a real popup.
      writeFileSync(join(directory, 'synthetic-herdr.js'), readFileSync(join(directory, 'synthetic-herdr.js'), 'utf8').replace("mode:'detail'", "mode:'bar'"));
      for (const width of [360, 480, 720, 1200]) {
        writeFileSync(join(directory, 'main.js'), `
import Usage from './usage.js';
export default class Probe extends Usage {
  init(){this.usage=${JSON.stringify(usageWith(summary))};this.width=${width};}
}
`);
        check(`${themeName}/bar/${width}`);
      }
    }
    console.log(`native usage: ${checks} synthetic descriptions passed (no layout or screenshot verification)`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
