const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeEl() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    className: '',
    style: {},
    dataset: {},
    children: [],
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){},
    getAttribute(){ return null; },
    removeAttribute(){},
    appendChild(child){ this.children.push(child); return child; },
    remove(){},
    focus(){},
    scrollIntoView(){},
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    addEventListener(){},
    removeEventListener(){},
    click(){},
    closest(){ return null; },
    contains(){ return false; }
  };
}

function loadApp() {
  const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const dataCode = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');

  const elements = {
    app: makeEl(),
    'modal-root': makeEl(),
    'toast-container': makeEl()
  };

  const listeners = { window: {}, document: {} };
  const storage = new Map();

  const document = {
    addEventListener(type, fn){ (listeners.document[type] ||= []).push(fn); },
    removeEventListener(){},
    getElementById(id){ return elements[id] || (elements[id] = makeEl()); },
    querySelector(sel){
      if (sel === '#app') return elements.app;
      if (sel === '#modal-root') return elements['modal-root'];
      if (sel === '#toast-container') return elements['toast-container'];
      return null;
    },
    querySelectorAll(){ return []; },
    createElement(){ return makeEl(); },
    body: makeEl()
  };

  const localStorage = {
    getItem(k){ return storage.has(k) ? storage.get(k) : null; },
    setItem(k,v){ storage.set(k, String(v)); },
    removeItem(k){ storage.delete(k); },
    clear(){ storage.clear(); }
  };

  const location = { hash: '#/', href: 'http://localhost/', reload(){ this.reloaded = true; } };

  const sandbox = {
    console,
    setTimeout(fn){ if (typeof fn === 'function') fn(); return 0; },
    clearTimeout(){},
    Intl,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    URL,
    Blob: global.Blob,
    navigator: { userAgent: 'node' },
    document,
    localStorage,
    location,
    getComputedStyle(){ return {}; },
    confirm(){ return true; },
    alert(){},
    prompt(){ return null; }
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (type, fn) => { (listeners.window[type] ||= []).push(fn); };
  sandbox.window.removeEventListener = () => {};
  sandbox.window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });

  vm.createContext(sandbox);
  vm.runInContext(dataCode, sandbox, { filename: 'data.js' });
  vm.runInContext(appCode, sandbox, { filename: 'app.js' });

  return { sandbox, elements, listeners, storage, location };
}

test('seed data loads and reservations include deliveryMethod', () => {
  const { sandbox } = loadApp();
  assert.ok(sandbox.VERA_STATE);
  assert.equal(sandbox.VERA_STATE.reservations.length, 10);
  for (const r of sandbox.VERA_STATE.reservations) {
    assert.ok(typeof r.deliveryMethod === 'string' && r.deliveryMethod.length > 0, `reservation ${r.id} missing deliveryMethod`);
  }
});

test('all four delivery method combinations exist in seed data', () => {
  const { sandbox } = loadApp();
  const set = new Set(sandbox.VERA_STATE.reservations.map(r => r.deliveryMethod));
  const expected = [
    'Guest Pickup & Guest Return',
    'Guest Pickup & Host Collection',
    'Host Delivery & Guest Return',
    'Host Delivery & Host Collection'
  ];
  for (const m of expected) assert.ok(set.has(m), `missing combination: ${m}`);
});

test('DELIVERY_METHODS exposes exactly the four supported combinations', () => {
  const { sandbox } = loadApp();
  assert.deepStrictEqual([...sandbox.App.DELIVERY_METHODS], [
    'Guest Pickup & Guest Return',
    'Guest Pickup & Host Collection',
    'Host Delivery & Guest Return',
    'Host Delivery & Host Collection'
  ]);
});

test('getDeliveryMethod returns Not specified for missing/empty and preserves known values', () => {
  const { sandbox } = loadApp();
  const { getDeliveryMethod } = sandbox.App;
  assert.equal(getDeliveryMethod(null), 'Not specified');
  assert.equal(getDeliveryMethod({}), 'Not specified');
  assert.equal(getDeliveryMethod({ deliveryMethod: '' }), 'Not specified');
  assert.equal(getDeliveryMethod({ deliveryMethod: undefined }), 'Not specified');
  assert.equal(getDeliveryMethod({ deliveryMethod: 'Guest Pickup & Guest Return' }), 'Guest Pickup & Guest Return');
  assert.equal(getDeliveryMethod({ deliveryMethod: 'Host Delivery & Host Collection' }), 'Host Delivery & Host Collection');
});

test('fee calculation: days = ceil duration, min 1 day', () => {
  const { sandbox } = loadApp();
  const { computeFee } = sandbox.App;
  // v1 is 1800/day
  const start = '2026-12-01T08:00:00.000Z';
  const endSameDay = '2026-12-01T18:00:00.000Z';
  const oneDay = computeFee('v1', start, endSameDay);
  assert.equal(oneDay.days, 1);
  assert.equal(oneDay.total, 1800);

  const endTwoDays = '2026-12-03T08:00:00.000Z';
  const twoDays = computeFee('v1', start, endTwoDays);
  assert.equal(twoDays.days, 2);
  assert.equal(twoDays.total, 3600);
});

test('overtime calculation: ceil hours late * hourly rate', () => {
  const { sandbox } = loadApp();
  const { computeOvertime } = sandbox.App;
  // v1 hourly 150
  const end = '2026-12-01T18:00:00.000Z';
  const onTime = computeOvertime('v1', end, '2026-12-01T17:00:00.000Z');
  assert.equal(onTime.hours, 0);
  assert.equal(onTime.fee, 0);

  const late1h = computeOvertime('v1', end, '2026-12-01T18:30:00.000Z');
  assert.equal(late1h.hours, 1);
  assert.equal(late1h.fee, 150);

  const late2h = computeOvertime('v1', end, '2026-12-01T20:00:00.000Z');
  assert.equal(late2h.hours, 2);
  assert.equal(late2h.fee, 300);
});

test('overlap detection and blocking rules', () => {
  const { sandbox } = loadApp();
  const { overlaps, hasConflict } = sandbox.App;
  assert.equal(overlaps('2026-01-01T08:00:00Z','2026-01-03T08:00:00Z','2026-01-02T08:00:00Z','2026-01-04T08:00:00Z'), true);
  assert.equal(overlaps('2026-01-01T08:00:00Z','2026-01-02T08:00:00Z','2026-01-02T08:00:00Z','2026-01-03T08:00:00Z'), false);

  // v5 is maintenance in seed -> blocked
  const blocked = hasConflict('v5', '2026-12-01T08:00:00.000Z', '2026-12-02T08:00:00.000Z');
  assert.equal(blocked.conflict, true);
  assert.match(blocked.reason, /maintenance/i);

  // v7 malfunction -> blocked
  const blocked2 = hasConflict('v7', '2026-12-01T08:00:00.000Z', '2026-12-02T08:00:00.000Z');
  assert.equal(blocked2.conflict, true);
});

test('delivery method validation rejects missing/invalid values (submit logic contract)', () => {
  const { sandbox } = loadApp();
  const valid = new Set(sandbox.App.DELIVERY_METHODS);
  assert.equal(valid.has(''), false);
  assert.equal(valid.has('INVALID'), false);
  assert.equal(valid.has('Guest Pickup & Guest Return'), true);
  assert.equal(valid.has('Guest Pickup & Host Collection'), true);
  assert.equal(valid.has('Host Delivery & Guest Return'), true);
  assert.equal(valid.has('Host Delivery & Host Collection'), true);
});

test('reservation records support deliveryMethod field and legacy records remain safe', () => {
  const { sandbox } = loadApp();
  const legacy = { id: 'rlegacy', status: 'approved' };
  assert.equal(sandbox.App.getDeliveryMethod(legacy), 'Not specified');
  // ensure adding a reservation-like object without deliveryMethod does not throw in helper
  assert.doesNotThrow(() => sandbox.App.getDeliveryMethod(legacy));
});
