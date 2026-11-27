// V.E.R.A. Assistant (rule-based v1, LLM-replaceable respond() contract)
(function () {
  'use strict';

  const App = window.App = window.App || {};
  const state = window.VERA_STATE;
  if (!state || !App) return;

  const DEFAULT_CHIPS = [
    'Check availability',
    'How do I book?',
    'What do I need to rent?',
    'Upload my payment'
  ];

  const chat = {
    open: false,
    messages: [],
    typing: false,
    flow: null, // { name, step, data }
    initialized: false
  };

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.error('Assistant error', e); return typeof fallback === 'function' ? fallback(e) : fallback; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtPeso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH'); }
  function fmtDateShort(iso) { return iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }) : '-'; }

  function currentCustomer() {
    return App.currentCustomer ? App.currentCustomer() : (state.customers || []).find(c => c.id === state.currentCustomerId) || state.customers?.[0];
  }
  function isCustomerRole() { return state.role === 'customer'; }
  function customerReservations() {
    const c = currentCustomer();
    if (!c) return [];
    return (state.reservations || []).filter(r => r.customerId === c.id || (!r.customerId && r.customerEmail === c.email));
  }

  // ---------- Allow-listed tools (assistant may only act through these) ----------
  const tools = {
    getRates(vehicleOrCategory) {
      const vehicles = (state.vehicles || []).slice();
      const q = norm(vehicleOrCategory || '');
      let list = vehicles;
      const cat = parseCategory(q);
      if (cat) list = vehicles.filter(v => String(v.displacement) === String(cat));
      else if (q) list = vehicles.filter(v => norm(`${v.name} ${v.brand} ${v.model} ${v.displacement}cc`).includes(q));
      return list.map(v => ({ id: v.id, name: v.name, brand: v.brand, displacement: v.displacement, ratePerDay: v.ratePerDay, status: v.status }));
    },
    getRequirements() {
      return {
        license: 'LTO driver\'s license with Restriction Code A or A1 for big bikes',
        id: 'Valid government-issued ID',
        deposit: 'P5,000 refundable deposit',
        payment: 'GCash proof upload for reservation payment'
      };
    },
    getDeliveryOptions() { return [...(App.DELIVERY_METHODS || [])]; },
    getOvertimeRules() {
      const s = App.getOvertimeSettings ? App.getOvertimeSettings() : (state.settings?.overtime || {});
      return s;
    },
    checkAvailability({ vehicleId, category, startISO, endISO }) {
      const cat = category ? String(category) : null;
      const vehicles = (state.vehicles || []).filter(v => !cat || String(v.displacement) === cat);
      const out = [];
      for (const v of vehicles) {
        if (vehicleId && v.id !== vehicleId) continue;
        if (['maintenance', 'malfunction'].includes(v.status)) {
          out.push({ vehicle: v, available: false, reason: `Marked as ${v.status}` });
          continue;
        }
        const conflict = App.hasConflict(v.id, startISO, endISO);
        out.push({ vehicle: v, available: !conflict.conflict, reason: conflict.conflict ? (conflict.reason || 'Date conflict') : 'Available' });
      }
      return out;
    },
    computeQuote({ vehicleId, startISO, endISO }) {
      return App.computeFee(vehicleId, startISO, endISO);
    },
    createReservation({ vehicleId, startISO, endISO, deliveryMethod }) {
      return createReservationThroughExistingFlow({ vehicleId, startISO, endISO, deliveryMethod });
    },
    navigateTo(route) {
      if (typeof route !== 'string' || !route.startsWith('#/')) return { ok: false, reason: 'Invalid route' };
      location.hash = route;
      return { ok: true };
    },
    highlight(target) {
      return highlightTarget(target);
    }
  };

  // ---------- Intent parsing / helpers ----------
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function parseCategory(s) {
    const m = norm(s).match(/\b(400|600|1000)\s*cc\b|\b(400|600|1000)\b/);
    return m ? (m[1] || m[2]) : null;
  }
  function findVehicle(text) {
    const n = norm(text);
    const cat = parseCategory(n);
    const vehicles = state.vehicles || [];
    let best = null;
    for (const v of vehicles) {
      const names = [v.id, v.name, v.brand, v.model, `${v.brand} ${v.model}`, `${v.name} ${v.year}`].map(norm);
      if (names.some(x => x && n.includes(x))) { best = v; break; }
    }
    if (!best && cat) {
      const inCat = vehicles.filter(v => String(v.displacement) === String(cat) && !['maintenance','malfunction'].includes(v.status));
      if (inCat.length === 1) best = inCat[0];
    }
    return { vehicle: best, category: cat };
  }
  function parseDateInput(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    // Accept YYYY-MM-DD or YYYY-MM-DDTHH:MM (assume Manila local, append +08:00 on ISO creation later)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
    if (m) {
      const [_, y, mo, d, hh='08', mm='00'] = m;
      const isoLocal = `${y}-${mo}-${d}T${hh}:${mm}`;
      const dt = new Date(isoLocal + '+08:00');
      if (Number.isFinite(dt.getTime())) return { iso: dt.toISOString(), local: isoLocal };
    }
    const dt2 = new Date(s);
    if (Number.isFinite(dt2.getTime())) return { iso: dt2.toISOString(), local: s };
    return null;
  }
  function extractDates(text) {
    // find yyyy-mm-dd or yyyy-mm-dd hh:mm pairs
    const re = /(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:?\d{2})?)/g;
    const matches = [...String(text || '').matchAll(re)].map(m => parseDateInput(m[1])).filter(Boolean);
    return matches;
  }
  function validateBookingInput({ vehicle, startISO, endISO, deliveryMethod, trackingConsentAccepted }) {
    if (!vehicle) return { ok: false, reason: 'Please select a vehicle.' };
    if (!startISO || !endISO) return { ok: false, reason: 'Please provide both start and end dates.' };
    const start = new Date(startISO), end = new Date(endISO);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return { ok: false, reason: 'Invalid date format.' };
    if (end <= start) return { ok: false, reason: 'End date/time must be after start date/time.' };
    if (start.getTime() < Date.now() - 60000) return { ok: false, reason: 'Start date/time cannot be in the past.' };
    if (!['maintenance','malfunction'].includes(vehicle.status) ? false : true) return { ok: false, reason: `Vehicle is currently marked as ${vehicle.status}.` };
    const conflict = App.hasConflict(vehicle.id, startISO, endISO);
    if (conflict.conflict) return { ok: false, reason: conflict.reason || 'Selected dates overlap an existing booking.' };
    if (!App.DELIVERY_METHODS.includes(deliveryMethod)) return { ok: false, reason: 'Please select a valid delivery method.' };
    return { ok: true };
  }

  function createReservationThroughExistingFlow({ vehicleId, startISO, endISO, deliveryMethod, trackingConsentAccepted }) {
    if (!isCustomerRole()) return { ok: false, reason: 'Assistant booking is available for customers only.' };
    const c = currentCustomer();
    if (!c) return { ok: false, reason: 'No customer account selected.' };
    const vehicle = App.getVehicle(vehicleId);
    const validation = validateBookingInput({ vehicle, startISO, endISO, deliveryMethod, trackingConsentAccepted: trackingConsentAccepted !== false });
    if (!validation.ok) return validation;
    // reuse existing business rules by calling same calculation/validation primitives and creating same record shape as submitReservation
    const { total } = App.computeFee(vehicleId, startISO, endISO);
    const r = {
      id: App.uid ? App.uid('r') : ('r' + Math.random().toString(36).slice(2,8)),
      vehicleId,
      customerId: c.id,
      customerName: c.name,
      customerEmail: c.email,
      start: startISO,
      end: endISO,
      actualReturn: null,
      status: 'pending',
      totalFee: total,
      overtimeFee: 0,
      createdAt: new Date().toISOString(),
      approvedBy: null,
      rejectReason: '',
      adminNotes: '',
      deliveryMethod
    };
    state.reservations.unshift(r);
    if (App.notify) App.notify('admin', 'New reservation request', `${c.name} requested ${vehicle?.name || 'a vehicle'}.`, '#/admin/reservations');
    if (App.logActivity) App.logActivity({
      module: 'Reservations',
      action: 'Created',
      entityId: r.id,
      description: `AI-assisted reservation for ${vehicle?.name || vehicleId}`,
      link: `#/admin/reservation/${r.id}`,
      actorName: `AI Assistant (for ${c.name})`,
      changes: [
        { field: 'status', previousValue: null, newValue: 'pending' },
        { field: 'deliveryMethod', previousValue: null, newValue: deliveryMethod },
        { field: 'totalFee', previousValue: null, newValue: total }
      ]
    }, 'assistant', c.id);
    if (App.captureActivity) { try { App.captureActivity(state.role, c.id); } catch(e) { console.error(e); } }
    if (App.render) { try { App.render(); } catch(e) { if (typeof process === 'undefined') console.error('Assistant render skipped', e); } }
    return { ok: true, reservation: r };
  }

  // ---------- Respond (rule-based v1; isolated for future LLM replacement) ----------
  function AssistantRespond(userText, context = {}) {
    const text = String(userText || '').trim();
    const n = norm(text);
    if (!isCustomerRole()) {
      return { text: 'The V.E.R.A. Assistant is available for customer accounts only.', chips: [] };
    }

    // Flow continuation
    if (chat.flow) {
      return handleFlow(text, n, context);
    }

    if (/\b(hi|hello|hey|good\s*(morning|afternoon|evening)|help)\b/.test(n) && n.length < 40) {
      return { text: 'I can help with vehicle rates, requirements, availability, booking, and finding the right buttons in V.E.R.A.', chips: DEFAULT_CHIPS };
    }
    if (/\b(require|need|required|license|licen[cs]e|id|deposit)\b/.test(n)) return answerRequirements();
    if (/\b(rate|price|cost|how much|per day)\b/.test(n)) return answerRates(text);
    if (/\b(overtime|late)\b/.test(n)) return answerOvertime();
    if (/\b(delivery|pickup|pick up|drop off|return method|collection)\b/.test(n)) return answerDelivery();
    if (/\b(cancel|cancellation)\b/.test(n)) return answerCancellation();
    if (/\b(gcash|maya|bank\s*transfer|cash|payment\s*method|pay\s*method|mode\s*of\s*payment)\b/.test(n)) return answerPaymentMethods(text);
    if (/\b(pay|payment|proof|upload|receipt)\b/.test(n)) return answerPayment();
    if (/\b(available|availability|check availability)\b/.test(n) || (parseCategory(n) && /\b(avail|have|book|rent)\b/.test(n))) return startAvailabilityFlow(text);
    if (/\b(book|reserve|reservation|rent)\b/.test(n)) return startBookingFlow(text);
    if (/\b(my reservation|reservations|booking status|status)\b/.test(n)) return answerMyReservations();
    if (/\b(contact|support|admin|help desk|phone|email)\b/.test(n)) return { text: 'For prototype support, use the in-app reservation/admin flow. If you need admin action (refund, adjustment, manual confirmation), submit your request/reservation and the admin can review it in the dashboard.', chips: ['My reservations', 'Upload my payment'] };
    if (/\b(location|map|track|gps)\b/.test(n)) return { text: 'GPS tracking is used for ongoing rentals with your consent. Customers can see tracking consent on reservation details; live map monitoring is an admin feature in this prototype.', chips: ['How do I book?', 'What do I need to rent?'] };
    if (/\b(refund|deposit)\b/.test(n)) return { text: 'Deposit is P5,000 refundable (prototype rule text). Refunds/adjustments are handled by admin and recorded in the admin Payments & Refunds flow; there is no automated customer refund checkout in-app.', chips: ['Payment methods?', 'My reservations'] };

    return {
      text: "I can help with: checking availability, explaining rates/requirements, guiding booking, and helping you upload payment. I can't answer that specific question yet.",
      chips: DEFAULT_CHIPS
    };
  }

  function answerRequirements() {
    const r = tools.getRequirements();
    return {
      text: `To rent, you'll need: ${r.license}; ${r.id}; and a ${r.deposit}. Payment is proof-upload only in this prototype (GCash/Other) after admin approval; Maya/bank transfer/cash are not dedicated in-app checkout methods.`,
      chips: ['Check availability', 'How do I book?', 'Upload my payment']
    };
  }
  function answerRates(text) {
    const { vehicle, category } = findVehicle(text);
    let list = tools.getRates(text);
    if (vehicle) list = tools.getRates(vehicle.name).filter(v => v.id === vehicle.id);
    if (!list.length) list = tools.getRates();
    const top = list.slice(0, 6);
    const lines = top.map(v => `${v.brand} ${v.name} ${v.displacement}cc - ${fmtPeso(v.ratePerDay)}/day (${v.status})`);
    return {
      text: `Rates (per day, from live data):\n${lines.join('\n')}${list.length > top.length ? `\n…and ${list.length-top.length} more.` : ''}`,
      chips: ['Check availability', 'How do I book?']
    };
  }
  function answerOvertime() {
    const s = tools.getOvertimeRules();
    const t = s.tiers || {1:500,2:800,3:1000};
    return {
      text: `Overtime rules (from settings): 1h=P${t[1]||500}, 2h=P${t[2]||800}, 3h=P${t[3]||1000}, 4h+=P${t[3]||1000}+P${s.perHourAfterThird||500}/hour after 3rd; more than ${s.fullDayAfterHours||6} hours late = one full-day rate. Cleaning fee P${s.cleaningFee||200}; refueling fee is admin-entered. Hours are rounded up.`,
      chips: ['Check availability', 'How do I book?']
    };
  }
  function answerDelivery() {
    return { text: `Delivery/pickup options: ${tools.getDeliveryOptions().join('; ')}.`, chips: ['Check availability', 'How do I book?'] };
  }
  function answerCancellation() {
    return { text: 'Cancellation/payment steps: submit a reservation request, wait for admin approval, then upload GCash payment proof. If your request is still pending, you can cancel it from My Reservations. Refund/adjustment cases are handled by admin per prototype flow.', chips: ['Upload my payment', 'Check availability'], actions: [{ type:'navigate', route:'#/customer/reservations', label:'Go to My Reservations' }] };
  }
  function answerPaymentMethods(text) {
    const n = norm(text);
    const pending = customerReservations().find(r => r.status === 'approved' && !((state.payments||[]).find(p=>p.reservationId===r.id && (p.paymentType||'rental')==='rental')));
    const action = pending ? [{ type:'navigate', route:`#/customer/reservation/${pending.id}/pay`, label:'Upload payment proof' }] : [{ type:'navigate', route:'#/customer/reservations', label:'Open My Reservations' }];
    const base = [
      'Payment methods (prototype):',
      '- In-app proof upload: GCash or Other (you upload a screenshot/photo as proof; payment happens outside the app).',
      '- GCash: supported for proof upload. Maya / bank transfer: no dedicated in-app method yet; you can pay externally and upload proof as "Other" if admin allows.',
      '- Cash: not supported as an in-app payment flow. Any cash arrangement is outside the prototype and must be confirmed by admin.',
      '- Admin refunds/records may list GCash, Bank transfer, or Cash internally, but customer checkout is proof-upload only.'
    ].join('\n');
    const direct = /\b(maya)\b/.test(n) ? 'Maya: not a dedicated in-app option yet in this prototype. Use external payment and submit proof as "Other" only if your admin confirms it.\n\n' :
                   /\b(bank\s*transfer)\b/.test(n) ? 'Bank transfer: not a dedicated customer in-app checkout option yet in this prototype. You may pay externally and submit proof as "Other" only if admin confirms.\n\n' :
                   /\bcash\b/.test(n) ? 'Cash: no in-app cash payment flow in this prototype. Cash handling is outside the system and must be confirmed by admin.\n\n' : '';
    return { text: direct + base, chips: ['Upload my payment', 'How do I book?', 'Check availability'], actions: action };
  }

  function answerPayment() {
    const pending = customerReservations().find(r => r.status === 'approved' && !((state.payments||[]).find(p=>p.reservationId===r.id && (p.paymentType||'rental')==='rental')));
    const action = pending ? [{ type:'navigate', route:`#/customer/reservation/${pending.id}/pay`, label:'Upload payment proof' }, { type:'highlight', target:'upload-payment-proof', label:'Highlight upload button' }] : [{ type:'navigate', route:'#/customer/reservations', label:'Open My Reservations' }];
    return { text: pending ? `You have an approved reservation (${pending.id.toUpperCase()}) awaiting payment proof. Open it and upload your GCash/Other proof.` : 'To upload payment: open an approved reservation in My Reservations, then tap "Upload payment proof" and submit your GCash/Other proof image. In-app checkout is proof-upload only (prototype).', chips: ['Payment methods?', ...DEFAULT_CHIPS.slice(0,4)], actions: action };
  }
  function answerMyReservations() {
    const mine = customerReservations().slice(0,5);
    if (!mine.length) return { text: 'You have no reservations yet.', chips: ['Check availability', 'How do I book?'] };
    const lines = mine.map(r => `${r.id.toUpperCase()} - ${(App.getVehicle(r.vehicleId)?.name||r.vehicleId)} - ${r.status} - ${fmtDateShort(r.start)} to ${fmtDateShort(r.end)}`);
    return { text: `Your recent reservations:\n${lines.join('\n')}`, chips: DEFAULT_CHIPS, actions:[{type:'navigate',route:'#/customer/reservations',label:'Open My Reservations'}] };
  }

  function startAvailabilityFlow(text) {
    const { vehicle, category } = findVehicle(text);
    const dates = extractDates(text);
    chat.flow = { name:'availability', step: (!vehicle && !category) ? 'vehicle' : (dates.length < 2 ? 'dates' : 'ready'), data:{ vehicleId: vehicle?.id || null, category: category || null, startISO: dates[0]?.iso || null, endISO: dates[1]?.iso || null } };
    return handleFlow(text, norm(text), {});
  }
  function startBookingFlow(text) {
    const { vehicle } = findVehicle(text);
    const dates = extractDates(text);
    chat.flow = { name:'booking', step: !vehicle ? 'vehicle' : (dates.length<2 ? 'dates' : 'delivery'), data:{ vehicleId: vehicle?.id || null, startISO: dates[0]?.iso || null, endISO: dates[1]?.iso || null, deliveryMethod: null } };
    return handleFlow(text, norm(text), {});
  }

  function handleFlow(text, n, context) {
    const f = chat.flow;
    if (!f) return AssistantRespond(text, context);
    if (/\b(cancel|stop|never mind|nevermind)\b/.test(n)) { chat.flow = null; return { text: 'Okay, I cancelled that flow.', chips: DEFAULT_CHIPS }; }

    if (f.name === 'availability') return availabilityFlow(text, n);
    if (f.name === 'booking') return bookingFlow(text, n);
    chat.flow = null;
    return { text: 'I lost that conversation state. How can I help?', chips: DEFAULT_CHIPS };
  }

  function availabilityFlow(text, n) {
    const f = chat.flow;
    if (f.step === 'vehicle') {
      const { vehicle, category } = findVehicle(text);
      if (!vehicle && !category) return { text: 'Which vehicle or category? You can say "400cc", "600cc", "1000cc", or a model like "ZX-6R".', chips: ['400cc', '600cc', '1000cc'] };
      f.data.vehicleId = vehicle?.id || null; f.data.category = category || (vehicle ? String(vehicle.displacement) : null);
      f.step = 'dates';
      return { text: 'What dates/times? Please enter start and end as `YYYY-MM-DD HH:MM` to `YYYY-MM-DD HH:MM` (or two dates).', chips: ['2026-12-01 08:00 to 2026-12-03 18:00'] };
    }
    if (f.step === 'dates') {
      const dates = extractDates(text);
      if (dates.length < 2) return { text: 'Please provide both start and end date/time (e.g., `2026-12-01 08:00` to `2026-12-03 18:00`).', chips: [] };
      const start = new Date(dates[0].iso), end = new Date(dates[1].iso);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return { text: 'Invalid dates. Make sure end is after start.', chips: [] };
      if (start.getTime() < Date.now() - 60000) return { text: 'Start date/time cannot be in the past.', chips: [] };
      f.data.startISO = dates[0].iso; f.data.endISO = dates[1].iso; f.step = 'ready';
    }
    if (f.step === 'ready') {
      const res = tools.checkAvailability({ vehicleId: f.data.vehicleId, category: f.data.category, startISO: f.data.startISO, endISO: f.data.endISO });
      const available = res.filter(r => r.available);
      chat.flow = null;
      if (!available.length) {
        const reasons = res.slice(0,4).map(r => `${r.vehicle.name} ${r.vehicle.displacement}cc: ${r.reason}`).join('\n');
        return { text: `No available vehicles found for ${fmtDateShort(f.data.startISO)} to ${fmtDateShort(f.data.endISO)}.\n${reasons}`, chips: ['Check availability', 'How do I book?'] };
      }
      const lines = available.slice(0,6).map(r => {
        const q = tools.computeQuote({ vehicleId: r.vehicle.id, startISO: f.data.startISO, endISO: f.data.endISO });
        return `${r.vehicle.brand} ${r.vehicle.name} ${r.vehicle.displacement}cc - ${fmtPeso(r.vehicle.ratePerDay)}/day, est. ${fmtPeso(q.total)} for ${q.days} day(s)`;
      });
      return { text: `Available for ${fmtDateShort(f.data.startISO)} to ${fmtDateShort(f.data.endISO)}:\n${lines.join('\n')}`, chips: ['How do I book?', 'What do I need to rent?'] };
    }
    return { text: 'I can check availability by vehicle/category and dates.', chips: DEFAULT_CHIPS };
  }

  function bookingFlow(text, n) {
    const f = chat.flow;
    if (f.step === 'vehicle') {
      const { vehicle } = findVehicle(text);
      if (!vehicle) return { text: 'Which vehicle would you like to book? Please name a specific model (e.g., "ZX-6R").', chips: (state.vehicles||[]).filter(v=>!['maintenance','malfunction'].includes(v.status)).slice(0,4).map(v=>v.name) };
      f.data.vehicleId = vehicle.id; f.step = 'dates';
      return { text: `Selected ${vehicle.brand} ${vehicle.name}. What start and end date/time? (YYYY-MM-DD HH:MM to YYYY-MM-DD HH:MM)`, chips: [] };
    }
    if (f.step === 'dates') {
      const dates = extractDates(text);
      if (dates.length < 2) return { text: 'Please provide start and end date/time.', chips: [] };
      f.data.startISO = dates[0].iso; f.data.endISO = dates[1].iso; f.step = 'delivery';
      return { text: 'Which delivery method?', chips: tools.getDeliveryOptions() };
    }
    if (f.step === 'delivery') {
      const dm = tools.getDeliveryOptions().find(o => norm(o) === n) || tools.getDeliveryOptions().find(o => n.includes(norm(o)));
      if (!dm) return { text: 'Please choose one of the valid delivery methods.', chips: tools.getDeliveryOptions() };
      f.data.deliveryMethod = dm; f.step = 'consent';
      return { text: 'GPS tracking consent is required during the rental period. Do you agree to GPS tracking during your rental period?', chips: ['I agree to GPS tracking', 'Cancel'] };
      const v = App.getVehicle(f.data.vehicleId);
      const q = tools.computeQuote({ vehicleId: f.data.vehicleId, startISO: f.data.startISO, endISO: f.data.endISO });
      if (!q.days) return { text: 'I could not compute that quote. Please check the dates.', chips: DEFAULT_CHIPS };
      return { text: `Booking summary:\nVehicle: ${v?.brand} ${v?.name}\nStart: ${fmtDateShort(f.data.startISO)}\nEnd: ${fmtDateShort(f.data.endISO)}\nDelivery: ${dm}\nEstimated rental: ${fmtPeso(q.total)} for ${q.days} day(s) (from computeFee).\n\nTap "Confirm booking" to submit this as a pending request.`, chips: ['Confirm booking', 'Cancel'] };
    }
    if (f.step === 'consent') {
      if (/\b(i agree|agree|yes)\b/.test(n) && !/\bcancel\b/.test(n)) { f.data.trackingConsentAccepted = true; f.step = 'confirm';
        const v = App.getVehicle(f.data.vehicleId);
        const q = tools.computeQuote({ vehicleId: f.data.vehicleId, startISO: f.data.startISO, endISO: f.data.endISO });
        if (!q.days) return { text: 'I could not compute that quote. Please check the dates.', chips: DEFAULT_CHIPS };
        return { text: `Booking summary:\nVehicle: ${v?.brand} ${v?.name}\nStart: ${fmtDateShort(f.data.startISO)}\nEnd: ${fmtDateShort(f.data.endISO)}\nDelivery: ${f.data.deliveryMethod}\nGPS tracking consent: Accepted\nEstimated rental: ${fmtPeso(q.total)} for ${q.days} day(s) (from computeFee).\n\nTap "Confirm booking" to submit this as a pending request.`, chips: ['Confirm booking', 'Cancel'] }; }
      if (/\bcancel\b/.test(n)) { chat.flow = null; return { text: 'Booking cancelled. Nothing was submitted.', chips: DEFAULT_CHIPS }; }
      return { text: 'Please confirm you agree to GPS tracking during the rental period, or tap Cancel.', chips: ['I agree to GPS tracking', 'Cancel'] }; }
    if (f.step === 'confirm') {
      if (/^confirm booking$/.test(n) || /^confirm$/.test(n)) {
        const result = tools.createReservation({ ...f.data, trackingConsentAccepted: !!f.data.trackingConsentAccepted });
        chat.flow = null;
        if (!result.ok) return { text: `I couldn't create the reservation: ${result.reason}`, chips: DEFAULT_CHIPS };
        return { text: `Reservation ${result.reservation.id.toUpperCase()} submitted as pending for admin approval.`, chips: ['Upload my payment', 'My reservations'], actions:[{type:'navigate',route:'#/customer/reservations',label:'Go to My Reservations'}] };
      }
      if (/\bcancel\b/.test(n)) { chat.flow = null; return { text: 'Booking cancelled. Nothing was submitted.', chips: DEFAULT_CHIPS }; }
      return { text: 'Please tap "Confirm booking" to submit, or "Cancel".', chips: ['Confirm booking', 'Cancel'] };
    }
    chat.flow = null;
    return { text: 'Booking flow reset. How can I help?', chips: DEFAULT_CHIPS };
  }

  // ---------- UI ----------
  function ensureUI() {
    if (document.getElementById('veraAssistantBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'veraAssistantBtn';
    btn.className = 'assistant-fab hidden';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open V.E.R.A. Assistant');
    btn.innerHTML = '<span aria-hidden="true">💬</span>';
    btn.onclick = () => toggle(true);

    const panel = document.createElement('div');
    panel.id = 'veraAssistantPanel';
    panel.className = 'assistant-panel hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'V.E.R.A. Assistant');
    panel.innerHTML = `
      <div class="assistant-header">
        <div><div class="assistant-title">V.E.R.A. Assistant</div><div class="assistant-sub">Rule-based v1 • customer help</div></div>
        <button type="button" class="icon-btn" id="veraAssistantClose" aria-label="Close assistant">&times;</button>
      </div>
      <div class="assistant-messages" id="veraAssistantMessages" aria-live="polite"></div>
      <div class="assistant-chips" id="veraAssistantChips"></div>
      <form class="assistant-input-row" id="veraAssistantForm">
        <input id="veraAssistantInput" class="input assistant-input" type="text" autocomplete="off" placeholder="Ask about availability, booking, rates..." aria-label="Message V.E.R.A. Assistant">
        <button class="btn btn-primary" type="submit">Send</button>
      </form>`;

    document.body.appendChild(btn);
    document.body.appendChild(panel);
    document.getElementById('veraAssistantClose').onclick = () => toggle(false);
    document.getElementById('veraAssistantForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('veraAssistantInput');
      const val = input.value.trim();
      if (!val) return;
      input.value = '';
      submitUserMessage(val);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && chat.open) toggle(false);
    });
  }

  function toggle(open) {
    chat.open = !!open;
    const panel = document.getElementById('veraAssistantPanel');
    const btn = document.getElementById('veraAssistantBtn');
    if (panel) panel.classList.toggle('hidden', !chat.open);
    if (btn) btn.setAttribute('aria-expanded', String(chat.open));
    if (chat.open) {
      if (!chat.messages.length) {
        chat.messages.push({ role:'assistant', text:'Hi! I\'m the V.E.R.A. Assistant (prototype). I can help with rates, requirements, availability, booking, delivery options, overtime rules, payment methods/proof upload, and where to click.', chips: DEFAULT_CHIPS });
      }
      renderChat();
      setTimeout(()=>document.getElementById('veraAssistantInput')?.focus(), 50);
    }
  }

  function addMessage(role, text, chips, actions) {
    chat.messages.push({ role, text, chips: chips || null, actions: actions || null });
    renderChat();
  }

  function renderChat() {
    const box = document.getElementById('veraAssistantMessages');
    const chipsBox = document.getElementById('veraAssistantChips');
    if (!box || !chipsBox) return;
    box.innerHTML = chat.messages.map(m => {
      const cls = m.role === 'user' ? 'assistant-msg user' : 'assistant-msg bot';
      return `<div class="${cls}"><div class="assistant-bubble">${esc(m.text).replace(/\n/g,'<br>')}</div>${m.actions?.length ? `<div class="assistant-actions">${m.actions.map((a,i)=>`<button type="button" class="btn btn-sm" data-action-index="${i}" data-msg-role="${m.role}" onclick="App.Assistant.handleAction(this)">${esc(a.label||a.type)}</button>`).join('')}</div>` : ''}</div>`;
    }).join('') + (chat.typing ? `<div class="assistant-msg bot"><div class="assistant-bubble assistant-typing">Typing…</div></div>` : '');
    const last = [...chat.messages].reverse().find(m => m.role === 'assistant' && m.chips?.length);
    const chips = last?.chips || DEFAULT_CHIPS;
    chipsBox.innerHTML = chips.map(c => `<button type="button" class="assistant-chip" onclick="App.Assistant.quickReply(this)">${esc(c)}</button>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  function submitUserMessage(text) {
    if (!isCustomerRole()) return;
    addMessage('user', text);
    chat.typing = true; renderChat();
    setTimeout(() => {
      const resp = safe(() => AssistantRespond(text, { role: state.role, customerId: state.currentCustomerId }), () => ({ text: 'Something went wrong in the assistant. The normal app still works—please use the regular UI.', chips: DEFAULT_CHIPS }));
      chat.typing = false;
      addMessage('assistant', resp.text || 'I can help with availability, rates, requirements, booking, delivery, overtime, and payment methods/proof upload.', resp.chips || DEFAULT_CHIPS, resp.actions || []);
    }, 250);
  }

  function quickReply(btn) {
    const text = btn.textContent || '';
    if (text) submitUserMessage(text);
  }

  function handleAction(btn) {
    // find action from last assistant message containing actions with same label - simple approach
    const label = btn.textContent;
    const msg = [...chat.messages].reverse().find(m => m.actions?.some(a => (a.label||a.type) === label));
    const action = msg?.actions?.find(a => (a.label||a.type) === label);
    if (!action) return;
    safe(() => {
      if (action.type === 'navigate') tools.navigateTo(action.route);
      if (action.type === 'highlight') tools.highlight(action.target);
    });
  }

  function highlightTarget(target) {
    if (!target) return { ok: false };
    let tries = 0;
    const maxTries = 20; // ~4s at 200ms
    const timer = setInterval(() => {
      tries++;
      const el = document.querySelector(`[data-ai-target="${CSS.escape(target)}"]`);
      if (el) {
        clearInterval(timer);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('assistant-highlight');
        setTimeout(() => el.classList.remove('assistant-highlight'), 4000);
      } else if (tries >= maxTries) {
        clearInterval(timer);
      }
    }, 200);
    return { ok: true };
  }

  function syncVisibility() {
    ensureUI();
    const btn = document.getElementById('veraAssistantBtn');
    const panel = document.getElementById('veraAssistantPanel');
    const show = isCustomerRole();
    if (btn) btn.classList.toggle('hidden', !show);
    if (panel && !show) { panel.classList.add('hidden'); chat.open = false; }
  }

  // wrap render/route to keep UI synced; never break normal UI
  const origRender = App.render;
  if (typeof origRender === 'function') {
    App.render = function () { const r = origRender.apply(this, arguments); safe(syncVisibility); return r; };
  }
  window.addEventListener('hashchange', () => safe(syncVisibility));
  window.addEventListener('load', () => safe(syncVisibility));

  // Public API
  App.Assistant = {
    respond: AssistantRespond,
    tools,
    _state: chat,
    quickReply,
    handleAction,
    toggle,
    syncVisibility
  };
  window.Assistant = App.Assistant;

  safe(syncVisibility);
})();
