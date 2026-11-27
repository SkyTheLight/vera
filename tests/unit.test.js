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
  const assistantPath = path.join(__dirname, '..', 'assistant.js');
  if (fs.existsSync(assistantPath)) {
    const assistantCode = fs.readFileSync(assistantPath, 'utf8');
    vm.runInContext(assistantCode, sandbox, { filename: 'assistant.js' });
  }
  const trackingPath = path.join(__dirname, '..', 'tracking.js');
  if (fs.existsSync(trackingPath)) {
    const trackingCode = fs.readFileSync(trackingPath, 'utf8');
    vm.runInContext(trackingCode, sandbox, { filename: 'tracking.js' });
  }

  return { sandbox, elements, listeners, storage, location };
}

test('seed data loads and reservations include deliveryMethod', () => {
  const { sandbox } = loadApp();
  assert.ok(sandbox.VERA_STATE);
  assert.ok(sandbox.VERA_STATE.reservations.length >= 10);
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
  // v1 is 3500/day in seed data
  const start = '2026-12-01T08:00:00.000Z';
  const endSameDay = '2026-12-01T18:00:00.000Z';
  const oneDay = computeFee('v1', start, endSameDay);
  assert.equal(oneDay.days, 1);
  assert.equal(oneDay.total, 3500);

  const endTwoDays = '2026-12-03T08:00:00.000Z';
  const twoDays = computeFee('v1', start, endTwoDays);
  assert.equal(twoDays.days, 2);
  assert.equal(twoDays.total, 7000);
});

test('overtime calculation: contract tiers, add-ons, and full-day rule', () => {
  const { sandbox } = loadApp();
  const { computeOvertime, getOvertimeSettings } = sandbox.App;
  const settings = getOvertimeSettings();
  assert.equal(settings.tiers[1], 500);
  assert.equal(settings.tiers[2], 800);
  assert.equal(settings.tiers[3], 1000);
  assert.equal(settings.perHourAfterThird, 500);
  assert.equal(settings.fullDayAfterHours, 6);
  assert.equal(settings.cleaningFee, 200);

  const end = '2026-12-01T18:00:00.000Z';
  assert.equal(computeOvertime('v1', end, end).fee, 0); // on time
  assert.equal(computeOvertime('v1', end, '2026-12-01T17:00:00.000Z').fee, 0); // early
  assert.equal(computeOvertime('v1', end, '2026-12-01T18:30:00.000Z').fee, 500); // 1h rounded up
  assert.equal(computeOvertime('v1', end, '2026-12-01T20:00:00.000Z').fee, 800); // 2h
  assert.equal(computeOvertime('v1', end, '2026-12-01T21:00:00.000Z').fee, 1000); // 3h
  assert.equal(computeOvertime('v1', end, '2026-12-01T22:00:00.000Z').fee, 1500); // 4h
  assert.equal(computeOvertime('v1', end, '2026-12-02T00:00:00.000Z').fee, 2500); // 6h
  const over6 = computeOvertime('v1', end, '2026-12-02T00:01:00.000Z'); // 6h01m
  assert.equal(over6.fullDayApplied, true);
  assert.equal(over6.fee, 3500); // v1 ratePerDay

  const addons = computeOvertime('v1', end, '2026-12-01T19:00:00.000Z', { cleaning: true, refuelingFee: 350 });
  assert.equal(addons.baseFee, 500);
  assert.equal(addons.cleaningFee, 200);
  assert.equal(addons.refuelingFee, 350);
  assert.equal(addons.fee, 1050);
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


test('computeOvertime handles legacy records/settings safely', () => {
  const { sandbox } = loadApp({ settings: {} });
  const { computeOvertime } = sandbox.App;
  assert.equal(computeOvertime('v1', '2026-05-01T10:00:00.000Z', '2026-05-01T11:30:00.000Z').fee, 800);
  assert.equal(computeOvertime('v1', '2026-05-01T10:00:00.000Z', '2026-05-01T16:01:00.000Z').fee, 3500);
});


test('assistant responds to FAQs from real data', () => {
  const { sandbox } = loadApp();
  sandbox.VERA_STATE.role = 'customer';
  sandbox.VERA_STATE.currentCustomerId = 'c1';
  const resp = sandbox.App.Assistant.respond('What do I need to rent?');
  assert.match(resp.text, /Restriction Code A or A1/i);
  assert.match(resp.text, /P5,000 refundable deposit/);
});

test('assistant availability tool uses existing conflict logic', () => {
  const { sandbox } = loadApp();
  sandbox.VERA_STATE.role = 'customer';
  const v = sandbox.VERA_STATE.vehicles.find(x => x.status === 'maintenance') || sandbox.VERA_STATE.vehicles[0];
  const res = sandbox.App.Assistant.tools.checkAvailability({ vehicleId: v.id, startISO: '2026-12-01T00:00:00.000Z', endISO: '2026-12-02T00:00:00.000Z' });
  assert.ok(Array.isArray(res));
  const row = res.find(r => r.vehicle.id === v.id);
  assert.ok(row);
  if (['maintenance','malfunction'].includes(v.status)) assert.equal(row.available, false);
});

test('assistant quote tool uses computeFee', () => {
  const { sandbox } = loadApp();
  sandbox.VERA_STATE.role = 'customer';
  const q = sandbox.App.Assistant.tools.computeQuote({ vehicleId: 'v1', startISO: '2026-12-01T00:00:00.000Z', endISO: '2026-12-03T00:00:00.000Z' });
  const fee = sandbox.App.computeFee('v1', '2026-12-01T00:00:00.000Z', '2026-12-03T00:00:00.000Z');
  assert.deepEqual(q, fee);
});

test('assistant createReservation validates and creates pending reservation', () => {
  const { sandbox } = loadApp();
  sandbox.VERA_STATE.role = 'customer';
  sandbox.VERA_STATE.currentCustomerId = 'c1';
  const before = sandbox.VERA_STATE.reservations.length;
  const bad = sandbox.App.Assistant.tools.createReservation({ vehicleId: 'v1', startISO: '2026-12-03T00:00:00.000Z', endISO: '2026-12-01T00:00:00.000Z', deliveryMethod: 'Guest Pickup & Guest Return', trackingConsentAccepted: true });
  assert.equal(bad.ok, false);
  const ok = sandbox.App.Assistant.tools.createReservation({ vehicleId: 'v1', startISO: '2027-12-01T00:00:00.000Z', endISO: '2027-12-03T00:00:00.000Z', deliveryMethod: 'Guest Pickup & Guest Return', trackingConsentAccepted: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.reservation.status, 'pending');
  assert.equal(sandbox.VERA_STATE.reservations.length, before + 1);
  const log = sandbox.VERA_STATE.activityLogs.find(l => l.entityId === ok.reservation.id && String(l.actorName).includes('AI Assistant'));
  assert.ok(log, 'AI activity log expected');
});

test('assistant refuses non-customer role', () => {
  const { sandbox } = loadApp();
  sandbox.VERA_STATE.role = 'admin';
  const resp = sandbox.App.Assistant.respond('check availability');
  assert.match(resp.text, /customer accounts only/i);
});


test('tracking addPing validates lat/lng and reservation match', () => {
  const { sandbox } = loadApp();
  const ongoing = sandbox.VERA_STATE.reservations.find(r => r.status === 'ongoing');
  assert.ok(ongoing, 'expected ongoing reservation in seed');
  const badLat = sandbox.App.addPing({ vehicleId: ongoing.vehicleId, reservationId: ongoing.id, lat: 999, lng: 121.1, recordedAt: new Date().toISOString(), source: 'simulator' });
  assert.equal(badLat.ok, false);
  const mismatch = sandbox.App.addPing({ vehicleId: 'v1', reservationId: ongoing.id, lat: 14.59, lng: 121.1, recordedAt: new Date().toISOString(), source: 'simulator' });
  assert.equal(mismatch.ok, false);
  const ok = sandbox.App.addPing({ vehicleId: ongoing.vehicleId, reservationId: ongoing.id, lat: 14.5889, lng: 121.0970, recordedAt: new Date().toISOString(), source: 'simulator' });
  assert.equal(ok.ok, true);
  assert.equal(ok.ping.source, 'simulator');
});

test('tracking getTrackedVehicles returns only ongoing reservations and detects overdue', () => {
  const { sandbox } = loadApp();
  const rows = sandbox.App.getTrackedVehicles('all', new Date('2026-01-01T00:00:00Z'));
  assert.ok(rows.every(r => r.reservation.status === 'ongoing'));
  // force overdue
  const ongoing = sandbox.VERA_STATE.reservations.find(r => r.status === 'ongoing');
  const oldEnd = ongoing.end;
  ongoing.end = '2000-01-01T00:00:00.000Z';
  assert.equal(sandbox.App.isOverdue(ongoing, new Date('2000-01-02T00:00:00Z')), true);
  const overdueRows = sandbox.App.getTrackedVehicles('overdue', new Date('2000-01-02T00:00:00Z'));
  assert.ok(overdueRows.some(r => r.reservation.id === ongoing.id));
  ongoing.end = oldEnd;
});

test('tracking isNoSignal is true when ping missing or older than 15 minutes', () => {
  const { sandbox } = loadApp();
  const ongoing = sandbox.VERA_STATE.reservations.find(r => r.status === 'ongoing');
  sandbox.VERA_STATE.locationPings = [];
  assert.equal(sandbox.App.isNoSignal(ongoing.vehicleId, ongoing.id, new Date('2026-12-01T12:00:00Z')), true);
  sandbox.App.addPing({ vehicleId: ongoing.vehicleId, reservationId: ongoing.id, lat: 14.5889, lng: 121.0970, recordedAt: '2026-12-01T11:50:00.000Z', source: 'simulator' });
  assert.equal(sandbox.App.isNoSignal(ongoing.vehicleId, ongoing.id, new Date('2026-12-01T12:00:00Z')), false);
  assert.equal(sandbox.App.isNoSignal(ongoing.vehicleId, ongoing.id, new Date('2026-12-01T12:06:00Z')), true);
});

test('tracking addPing rejects non-ongoing reservation and completed rental clears pings', () => {
  const { sandbox } = loadApp();
  const pending = sandbox.VERA_STATE.reservations.find(r => r.status === 'pending');
  assert.ok(pending, 'expected pending reservation');
  const res = sandbox.App.addPing({ vehicleId: pending.vehicleId, reservationId: pending.id, lat: 14.5889, lng: 121.0970, recordedAt: new Date().toISOString(), source: 'simulator' });
  assert.ok(res && res.ok === false, 'non-ongoing ping should be rejected');
  const ongoing = sandbox.VERA_STATE.reservations.find(r => r.status === 'ongoing');
  sandbox.App.addPing({ vehicleId: ongoing.vehicleId, reservationId: ongoing.id, lat: 14.5889, lng: 121.0970, recordedAt: new Date().toISOString(), source: 'simulator' });
  assert.ok(sandbox.VERA_STATE.locationPings.some(p => p.reservationId === ongoing.id));
  sandbox.App.Tracking.clearPingsForReservation(ongoing.id);
  assert.equal(sandbox.VERA_STATE.locationPings.some(p => p.reservationId === ongoing.id), false);
});
