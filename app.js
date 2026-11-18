// V.E.R.A. App (vanilla JS, hash router, in-memory state)
(function () {
  'use strict';

  const state = window.VERA_STATE;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtPHP = (n) => '₱' + Number(n || 0).toLocaleString('en-PH');
  const fmtDate = (iso, opts = {}) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: opts.time ? 'short' : undefined, ...opts });
  };
  const fmtDateShort = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtDateTimeInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const o = {}; p.forEach(x => o[x.type] = x.value);
    return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;
  };
  const toManilaDateKey = (iso) => {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const obj = {}; parts.forEach(p => obj[p.type] = p.value);
    return `${obj.year}-${obj.month}-${obj.day}`;
  };
  const todayKey = () => toManilaDateKey(new Date().toISOString());
  const uid = (p) => p + Math.random().toString(36).slice(2, 8);

  const DELIVERY_METHODS = [
    'Guest Pickup & Guest Return',
    'Guest Pickup & Host Collection',
    'Host Delivery & Guest Return',
    'Host Delivery & Host Collection'
  ];
  function getDeliveryMethod(r) {
    if (!r || r.deliveryMethod == null || r.deliveryMethod === '') return 'Not specified';
    return DELIVERY_METHODS.includes(r.deliveryMethod) ? r.deliveryMethod : String(r.deliveryMethod);
  }

  // ---------- Domain ----------
  function getVehicle(id) { return state.vehicles.find(v => v.id === id); }
  function getReservation(id) { return state.reservations.find(r => r.id === id); }
  function getPaymentByReservation(rid) { return state.payments.find(p => p.reservationId === rid); }
  function getCustomer(id) { return state.customers.find(c => c.id === id); }
  function currentCustomer() { return getCustomer(state.currentCustomerId) || state.customers[0]; }
  function reservationsForVehicle(vehicleId) { return state.reservations.filter(r => r.vehicleId === vehicleId); }
  function overlaps(aStart, aEnd, bStart, bEnd) { return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart); }
  function hasConflict(vehicleId, start, end, excludeId) {
    const v = getVehicle(vehicleId);
    if (!v) return { conflict: true, reason: 'Vehicle not found.' };
    if (v.status === 'maintenance' || v.status === 'malfunction') return { conflict: true, reason: `Vehicle is currently marked as ${v.status}.` };
    const blocking = reservationsForVehicle(vehicleId).filter(r => (r.status === 'approved' || r.status === 'ongoing') && r.id !== excludeId);
    for (const r of blocking) {
      if (overlaps(start, end, r.start, r.end)) return { conflict: true, reason: `Overlaps with ${r.customerName} (${fmtDateShort(r.start)}–${fmtDateShort(r.end)}).`, conflictRes: r };
    }
    return { conflict: false };
  }
  function computeFee(vehicleId, start, end) {
    const v = getVehicle(vehicleId);
    if (!v || !start || !end) return { days: 0, total: 0 };
    const ms = new Date(end) - new Date(start);
    const days = Math.max(1, Math.ceil(ms / 86400000));
    return { days, total: days * v.ratePerDay };
  }
  function computeOvertime(vehicleId, scheduledEnd, actualReturn) {
    const v = getVehicle(vehicleId);
    if (!v || !actualReturn) return { hours: 0, fee: 0 };
    const ms = new Date(actualReturn) - new Date(scheduledEnd);
    if (ms <= 0) return { hours: 0, fee: 0 };
    const hours = Math.ceil(ms / 3600000);
    return { hours, fee: hours * v.ratePerHour };
  }
  function notify(role, title, body, link) {
    state.notifications.unshift({ id: uid('n'), role, title, body, isRead: false, createdAt: new Date().toISOString(), link: link || (role === 'admin' ? '#/admin/dashboard' : '#/customer/notifications') });
  }
  function toast(msg, type = 'info') {
    const c = $('#toastContainer'); if (!c) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 180); }, 2800);
  }
  function statusBadge(status) {
    const labels = { pending:'Pending', approved:'Approved', ongoing:'Ongoing', completed:'Completed', cancelled:'Cancelled', rejected:'Rejected', available:'Available', rented:'Rented', maintenance:'Maintenance', malfunction:'Malfunction', verified:'Verified', open:'Open', resolved:'Resolved' };
    const s = status || 'neutral';
    return `<span class="status status-${esc(s)}">${esc(labels[s] || s)}</span>`;
  }
  function timelineHTML(status) {
    const flow = ['pending','approved','ongoing','completed'];
    const terminalBad = status === 'cancelled' || status === 'rejected';
    const idx = flow.indexOf(status);
    let html = '<div class="timeline">';
    flow.forEach((s, i) => {
      let cls = '';
      if (!terminalBad) { if (idx > i) cls = 'done'; else if (idx === i) cls = 'active'; }
      else if (s === 'pending') cls = 'done';
      html += `<span class="timeline-step ${cls}"><span class="timeline-dot"></span>${s}</span>`;
      if (i < flow.length - 1) html += '<span class="timeline-line"></span>';
    });
    if (terminalBad) html += `<span class="timeline-line"></span><span class="timeline-step bad"><span class="timeline-dot"></span>${esc(status)}</span>`;
    html += '</div>';
    return html;
  }
  function vehicleMark(v, lg) {
    if (!v) return '';
    const cls = lg ? 'vehicle-mark lg' : 'vehicle-mark';
    return `<div class="${cls}" aria-label="${esc(v.type)}"><span class="vm-type">${esc(v.type === 'motorcycle' ? 'Motorcycle' : 'Car')}</span><span class="vm-plate">${esc(v.plateNumber || '')}</span></div>`;
  }

  // ---------- Router ----------
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    return h.split('/').filter(Boolean);
  }
  function navigate(hash) { location.hash = hash; }
  function goHome(e) { if (e) e.preventDefault(); navigate(state.role === 'admin' ? '#/admin/dashboard' : (state.role === 'customer' ? '#/customer/vehicles' : '#/')); }
  function route() {
    const parts = parseHash();
    state.ui.notifOpen = false;
    renderChrome();
    if (!state.role) { renderLanding(); return; }
    const [area, page, param, sub] = parts;
    if (area !== state.role) { navigate(state.role === 'admin' ? '#/admin/dashboard' : '#/customer/vehicles'); return; }
    if (state.role === 'customer') routeCustomer(page, param, sub); else routeAdmin(page, param, sub);
  }
  function routeCustomer(page, param, sub) {
    switch (page) {
      case 'vehicles': renderCustomerVehicles(); break;
      case 'vehicle': renderCustomerVehicleDetail(param); break;
      case 'reservations': renderCustomerReservations(); break;
      case 'reservation': sub === 'pay' ? renderCustomerPayment(param) : renderCustomerReservationDetail(param); break;
      case 'notifications': renderCustomerNotifications(); break;
      case 'history': renderCustomerHistory(); break;
      default: renderCustomerVehicles();
    }
  }
  function routeAdmin(page, param, sub) {
    switch (page) {
      case 'dashboard': renderAdminDashboard(); break;
      case 'vehicles': renderAdminVehicles(); break;
      case 'reservations': renderAdminReservations(); break;
      case 'reservation': renderAdminReservationDetail(param); break;
      case 'payments': renderAdminPayments(); break;
      case 'maintenance': renderAdminMaintenance(); break;
      case 'reports': renderAdminReports(); break;
      case 'customers': renderAdminCustomers(); break;
      default: renderAdminDashboard();
    }
  }

  // ---------- Chrome ----------
  function navItems() {
    if (state.role === 'admin') return [
      { href: '#/admin/dashboard', label: 'Dashboard' },
      { href: '#/admin/vehicles', label: 'Vehicles' },
      { href: '#/admin/reservations', label: 'Reservations' },
      { href: '#/admin/payments', label: 'Payments' },
      { href: '#/admin/maintenance', label: 'Maintenance' },
      { href: '#/admin/reports', label: 'Reports' },
      { href: '#/admin/customers', label: 'Customers' },
    ];
    return [
      { href: '#/customer/vehicles', label: 'Vehicles' },
      { href: '#/customer/reservations', label: 'Reservations' },
      { href: '#/customer/notifications', label: 'Notifications' },
      { href: '#/customer/history', label: 'Account' },
    ];
  }
  function renderChrome() {
    const topbar = $('#topbar'), sidebar = $('#sidebar'), bottomNav = $('#bottomNav');
    if (!state.role) {
      topbar.classList.add('hidden'); sidebar.classList.add('hidden'); bottomNav.classList.add('hidden');
      return;
    }
    topbar.classList.remove('hidden');
    sidebar.classList.remove('hidden');
    bottomNav.classList.remove('hidden');

    $('#roleBtnCustomer').classList.toggle('active', state.role === 'customer');
    $('#roleBtnAdmin').classList.toggle('active', state.role === 'admin');

    const items = navItems();
    const hash = location.hash || '#/';
    $('#sidebarNav').innerHTML = items.map(it => `<a href="${it.href}" class="nav-link ${hash.startsWith(it.href) ? 'active' : ''}"><span class="nav-dot"></span><span>${esc(it.label)}</span></a>`).join('');
    $('#bottomNavInner').innerHTML = items.map(it => `<a href="${it.href}" class="${hash.startsWith(it.href) ? 'active' : ''}"><span class="bn-dot"></span><span>${esc(it.label)}</span></a>`).join('');

    const roleNotifs = state.notifications.filter(n => n.role === state.role).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    const unread = roleNotifs.filter(n => !n.isRead).length;
    const badge = $('#notifBadge');
    if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); } else badge.classList.add('hidden');
    $('#notifViewAll').href = state.role === 'admin' ? '#/admin/reservations' : '#/customer/notifications';
    $('#notifList').innerHTML = roleNotifs.length ? roleNotifs.slice(0, 6).map(n => `
      <a href="${esc(n.link)}" class="notif-item ${n.isRead ? '' : 'unread'}" onclick="App.markNotifRead('${n.id}'); App.closeNotifications()">
        <div class="notif-item-title">${esc(n.title)}</div>
        <div class="notif-item-body">${esc(n.body)}</div>
        <div class="notif-item-time">${fmtDate(n.createdAt, { time: true })}</div>
      </a>`).join('') : `<div class="notif-item"><div class="notif-item-body">No notifications.</div></div>`;
    $('#notifDropdown').classList.toggle('hidden', !state.ui.notifOpen);
  }
  function mount(html) { const root = $('#appRoot'); if (root) root.innerHTML = html; window.scrollTo({ top: 0 }); }

  // ---------- Modals ----------
  function openModal(html) { $('#modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)App.closeModal()">${html}</div>`; }
  function closeModal() { $('#modalRoot').innerHTML = ''; }
  function openConfirm({ title, body, confirmLabel = 'Confirm', danger = false, onConfirm }) {
    window.App._confirm = onConfirm;
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${esc(title)}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancel</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" onclick="App._confirm && App._confirm();">${esc(confirmLabel)}</button></div></div>`);
  }

  // ---------- Landing ----------
  function renderLanding() {
    mount(`
      <div class="auth-wrap">
        <div class="auth-main">
          <div class="auth-box">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
              <span class="brand-mark" style="width:32px;height:32px;">V</span>
              <div><div style="font-weight:600;font-size:16px;">V.E.R.A.</div><div class="muted small">Vehicle Enterprise Rental Assistant</div></div>
            </div>
            <h1 style="font-size:22px;font-weight:600;margin-bottom:6px;">Sign in to continue</h1>
            <p class="muted small" style="margin-bottom:20px;">Select a view to access the rental management workspace.</p>
            <div class="panel">
              <div class="panel-body">
                <div class="stack">
                  <div>
                    <div class="field-label" style="margin-bottom:6px;">Customer view</div>
                    <p class="small muted" style="margin-bottom:8px;">Browse vehicles, check availability, and manage your reservations.</p>
                    <button class="btn btn-primary btn-block" onclick="App.loginAs('customer')">Continue as Customer</button>
                  </div>
                  <div class="divider"></div>
                  <div>
                    <div class="field-label" style="margin-bottom:6px;">Administrator view</div>
                    <p class="small muted" style="margin-bottom:8px;">Review requests, verify payments, and manage fleet operations.</p>
                    <button class="btn btn-block" onclick="App.loginAs('admin')">Continue as Administrator</button>
                  </div>
                </div>
              </div>
            </div>
            <p class="faint small" style="margin-top:14px;">Signed-in state is stored locally on this device for convenience.</p>
          </div>
        </div>
        <div class="auth-aside">
          <h2>Rental operations in one place</h2>
          <p>Manage vehicle availability, reservations, payments, and maintenance records with clear status tracking.</p>
          <ul>
            <li>Availability checks to prevent overlapping bookings</li>
            <li>Reservation workflow from request to completion</li>
            <li>Manual payment verification with proof records</li>
            <li>Maintenance and incident tracking per vehicle</li>
            <li>Rental history and basic operational reports</li>
          </ul>
        </div>
      </div>
    `);
  }

  // ---------- Customer: Vehicles ----------
  function renderCustomerVehicles() {
    const q = (state.ui.q || '').toLowerCase();
    const type = state.ui.typeFilter || 'all';
    const status = state.ui.statusFilter || 'all';
    const list = state.vehicles.filter(v => {
      if (type !== 'all' && v.type !== type) return false;
      if (status !== 'all' && v.status !== status) return false;
      if (q && !(v.name + ' ' + v.brand + ' ' + v.model + ' ' + v.plateNumber).toLowerCase().includes(q)) return false;
      return true;
    });
    mount(`
      <div class="page-header">
        <div><h1 class="page-title">Vehicles</h1><p class="page-desc">Browse available cars and motorcycles, then check dates and request a reservation.</p></div>
      </div>
      <div class="toolbar">
        <input class="input grow" placeholder="Search by name, brand, or plate number" value="${esc(state.ui.q || '')}" oninput="App.setUI('q', this.value); App.render()">
        <select class="select" onchange="App.setUI('typeFilter', this.value); App.render()">
          <option value="all" ${type==='all'?'selected':''}>All types</option>
          <option value="car" ${type==='car'?'selected':''}>Cars</option>
          <option value="motorcycle" ${type==='motorcycle'?'selected':''}>Motorcycles</option>
        </select>
        <select class="select" onchange="App.setUI('statusFilter', this.value); App.render()">
          <option value="all" ${status==='all'?'selected':''}>All statuses</option>
          <option value="available" ${status==='available'?'selected':''}>Available</option>
          <option value="rented" ${status==='rented'?'selected':''}>Rented</option>
          <option value="maintenance" ${status==='maintenance'?'selected':''}>Maintenance</option>
          <option value="malfunction" ${status==='malfunction'?'selected':''}>Malfunction</option>
        </select>
      </div>
      <div class="panel">
        <div class="panel-body flush">
          ${list.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Vehicle</th><th>Type</th><th>Plate</th><th>Rate</th><th>Status</th><th></th></tr></thead>
            <tbody>${list.map(v => {
              const unavailable = v.status === 'maintenance' || v.status === 'malfunction';
              return `<tr>
                <td><div style="display:flex;align-items:center;gap:10px;">${vehicleMark(v)}<div><div class="cell-main">${esc(v.name)}</div><div class="cell-sub">${esc(v.brand)} ${esc(v.model)} · ${v.year} · ${esc(v.transmission)}</div></div></div></td>
                <td class="muted" style="text-transform:capitalize">${esc(v.type)}</td>
                <td class="mono">${esc(v.plateNumber)}</td>
                <td><div class="cell-main">${fmtPHP(v.ratePerDay)} <span class="muted small">/ day</span></div><div class="cell-sub">${fmtPHP(v.ratePerHour)} / hour</div></td>
                <td>${statusBadge(v.status)}</td>
                <td class="text-right">${unavailable ? `<span class="small muted">Unavailable</span>` : `<a class="btn btn-sm" href="#/customer/vehicle/${v.id}">View details</a>`}</td>
              </tr>`;
            }).join('')}</tbody></table></div>` : `<div class="empty"><div class="empty-title">No vehicles found</div><div>Try adjusting your search or filters.</div></div>`}
        </div>
      </div>
    `);
  }

  function buildCalendarHTML(vehicleId) {
    const base = new Date(); base.setDate(1);
    const year = base.getFullYear(), month = base.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const booked = new Set();
    reservationsForVehicle(vehicleId).filter(r => r.status === 'approved' || r.status === 'ongoing').forEach(r => {
      let d = new Date(r.start); const end = new Date(r.end);
      d.setHours(0,0,0,0); const e = new Date(end); e.setHours(0,0,0,0);
      while (d <= e) { booked.add(toManilaDateKey(d.toISOString())); d.setDate(d.getDate() + 1); }
    });
    const tk = todayKey();
    const monthName = base.toLocaleString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
    let cells = '';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => cells += `<div class="cal-cell cal-head">${d}</div>`);
    for (let i = 0; i < firstDay; i++) cells += `<div class="cal-cell cal-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isBooked = booked.has(key), isToday = key === tk;
      cells += `<div class="cal-cell ${isBooked ? 'cal-booked' : 'cal-free'} ${isToday ? 'cal-today' : ''}" title="${isBooked ? 'Booked' : 'Available'}">${d}</div>`;
    }
    return `<div class="calendar"><div class="cal-header"><div class="cal-month">${esc(monthName)}</div><div class="cal-legend"><span><span class="cal-swatch free"></span>Available</span><span><span class="cal-swatch booked"></span>Booked</span></div></div><div class="cal-grid">${cells}</div></div>`;
  }

  function renderCustomerVehicleDetail(id) {
    const v = getVehicle(id);
    if (!v) return mount(`<div class="empty"><div class="empty-title">Vehicle not found</div><div><a href="#/customer/vehicles">Return to vehicles</a></div></div>`);
    const blocked = v.status === 'maintenance' || v.status === 'malfunction';
    const bookedRanges = reservationsForVehicle(id).filter(r => r.status === 'approved' || r.status === 'ongoing').sort((a,b)=>new Date(a.start)-new Date(b.start));
    mount(`
      <div style="margin-bottom:12px;"><a href="#/customer/vehicles" class="btn btn-ghost btn-sm">&larr; Back to vehicles</a></div>
      <div class="page-header">
        <div><h1 class="page-title">${esc(v.name)}</h1><p class="page-desc">${esc(v.brand)} ${esc(v.model)} · ${v.year} · ${esc(v.color)}</p></div>
        <div>${statusBadge(v.status)}</div>
      </div>
      <div class="grid-3">
        <div class="stack">
          <div class="panel"><div class="panel-body">${vehicleMark(v, true)}
            <div class="kv mt-3">
              <div class="k">Plate number</div><div class="v mono">${esc(v.plateNumber)}</div>
              <div class="k">Type</div><div class="v" style="text-transform:capitalize">${esc(v.type)}</div>
              <div class="k">Seats</div><div class="v">${v.seats}</div>
              <div class="k">Transmission</div><div class="v">${esc(v.transmission)}</div>
              <div class="k">Daily rate</div><div class="v">${fmtPHP(v.ratePerDay)}</div>
              <div class="k">Hourly rate</div><div class="v">${fmtPHP(v.ratePerHour)}</div>
            </div>
          </div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Availability</div></div><div class="panel-body">
            ${buildCalendarHTML(v.id)}
            <div class="small muted mt-2">${bookedRanges.length ? `<strong>Booked periods:</strong> ${bookedRanges.map(r=>`${fmtDateShort(r.start)}–${fmtDateShort(r.end)}`).join('; ')}` : 'No approved or ongoing bookings this month.'}</div>
          </div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Booking rule: overlap prevention</div></div><div class="panel-body">
            <p class="small muted mb-2">A request is blocked when its date range overlaps an approved or ongoing rental for the same vehicle.</p>
            <div class="overlap-diagram">
              <div class="range-bar"><div class="range-seg range-a">Existing</div><div class="range-seg range-b">Request</div><div class="range-seg range-overlap"></div></div>
              <div class="overlap-legend"><span>Existing rental</span><span style="color:var(--danger);font-weight:500;">Overlap blocked</span><span>New request</span></div>
            </div>
            <div class="callout small mt-2"><span class="mono">newStart &lt; existingEnd &amp;&amp; newEnd &gt; existingStart</span><span class="muted"> (checked against approved/ongoing reservations)</span></div>
          </div></div>
        </div>
        <div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Request reservation</div></div><div class="panel-body">
            ${blocked ? `<div class="callout danger">This vehicle is currently <strong>${esc(v.status)}</strong> and cannot accept reservation requests.</div>` : `
            <form id="reqForm" onsubmit="App.submitReservation(event,'${v.id}')" class="stack">
              <div class="field"><label class="field-label" for="start">Start date and time</label><input id="start" class="input" required type="datetime-local" name="start" onchange="App.updateFeePreview('${v.id}')"></div>
              <div class="field"><label class="field-label" for="end">End date and time</label><input id="end" class="input" required type="datetime-local" name="end" onchange="App.updateFeePreview('${v.id}')"></div>
              <div class="field"><label class="field-label" for="deliveryMethod">Delivery method</label>
                <select id="deliveryMethod" name="deliveryMethod" class="select" required>
                  <option value="">Select pickup and return option</option>
                  ${DELIVERY_METHODS.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
                </select>
                <div class="field-hint">Choose how the vehicle will be picked up and returned for this reservation.</div>
              </div>
              <div id="feePreview" class="callout info small">Select start and end dates to calculate the estimated fee.</div>
              <div id="conflictMsg"></div>
              <button class="btn btn-primary btn-block" type="submit">Submit reservation request</button>
              <p class="small muted">Requests are submitted as <strong>Pending</strong> until reviewed by the administrator.</p>
            </form>`}
          </div></div>
        </div>
      </div>
    `);
  }

  // ---------- Customer: Reservations ----------
  function renderCustomerReservations() {
    const cust = currentCustomer();
    const tab = state.ui.resTab || 'all';
    const mine = state.reservations.filter(r => r.customerId === cust.id || r.customerEmail === cust.email).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    const list = tab === 'all' ? mine : mine.filter(r => r.status === tab);
    const tabs = [['all','All'],['pending','Pending'],['approved','Approved'],['ongoing','Ongoing'],['completed','Completed'],['cancelled','Cancelled']];
    mount(`
      <div class="page-header"><div><h1 class="page-title">My reservations</h1><p class="page-desc">Track request status, upload payment proof, and review rental details.</p></div></div>
      <div class="tabs">${tabs.map(([k,l])=>`<button class="tab ${tab===k?'active':''}" onclick="App.setUI('resTab','${k}'); App.render()">${l}</button>`).join('')}</div>
      ${list.length ? `<div class="stack">${list.map(r => {
        const v = getVehicle(r.vehicleId); const p = getPaymentByReservation(r.id);
        return `<div class="list-row">
          <div class="list-row-main">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">${vehicleMark(v)}<div><div class="list-row-title"><a href="#/customer/reservation/${r.id}">${esc(v ? v.name : r.vehicleId)}</a></div><div class="list-row-meta">${fmtDateShort(r.start)} to ${fmtDateShort(r.end)} · ${fmtPHP(r.totalFee + (r.overtimeFee||0))}${r.overtimeFee ? ' (incl. overtime)' : ''}</div><div class="list-row-meta">Delivery: ${esc(getDeliveryMethod(r))}</div></div></div>
            ${timelineHTML(r.status)}
            ${p && r.status === 'approved' ? `<div class="small muted mt-2">Payment: ${statusBadge(p.status)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            ${statusBadge(r.status)}
            <div class="list-row-actions">
              <a href="#/customer/reservation/${r.id}" class="btn btn-sm">Details</a>
              ${r.status==='pending' ? `<button class="btn btn-sm btn-danger" onclick="App.confirmCancelReservation('${r.id}')">Cancel</button>` : ''}
              ${r.status==='approved' && !p ? `<a href="#/customer/reservation/${r.id}/pay" class="btn btn-sm btn-primary">Upload payment</a>` : ''}
            </div>
          </div>
        </div>`;
      }).join('')}</div>` : `<div class="empty"><div class="empty-title">No reservations</div><div>Reservations in this status will appear here.</div></div>`}
    `);
  }

  function renderCustomerReservationDetail(id) {
    const r = getReservation(id);
    if (!r) return mount(`<div class="empty"><div class="empty-title">Reservation not found</div><div><a href="#/customer/reservations">Back to reservations</a></div></div>`);
    const v = getVehicle(r.vehicleId); const p = getPaymentByReservation(r.id);
    mount(`
      <div style="margin-bottom:12px;"><a href="#/customer/reservations" class="btn btn-ghost btn-sm">&larr; Back to reservations</a></div>
      <div class="page-header"><div><h1 class="page-title">Reservation ${esc(r.id.toUpperCase())}</h1><p class="page-desc">${esc(v ? v.name : 'Vehicle')}</p></div><div>${statusBadge(r.status)}</div></div>
      <div class="grid-3">
        <div class="stack">
          <div class="panel"><div class="panel-header"><div class="panel-title">Status</div></div><div class="panel-body">${timelineHTML(r.status)}</div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Details</div></div><div class="panel-body">
            <div class="kv">
              <div class="k">Vehicle</div><div class="v">${esc(v ? v.name : '—')}</div>
              <div class="k">Plate number</div><div class="v mono">${esc(v ? v.plateNumber : '—')}</div>
              <div class="k">Start</div><div class="v">${fmtDate(r.start, { time: true })}</div>
              <div class="k">End</div><div class="v">${fmtDate(r.end, { time: true })}</div>
              <div class="k">Delivery method</div><div class="v">${esc(getDeliveryMethod(r))}</div>
              <div class="k">Total fee</div><div class="v">${fmtPHP(r.totalFee)}</div>
              <div class="k">Overtime fee</div><div class="v">${fmtPHP(r.overtimeFee || 0)}</div>
              <div class="k">Requested</div><div class="v">${fmtDate(r.createdAt, { time: true })}</div>
            </div>
            ${r.actualReturn ? `<div class="callout info mt-3 small"><strong>Actual return:</strong> ${fmtDate(r.actualReturn, { time: true })}</div>` : ''}
            ${r.rejectReason ? `<div class="callout danger mt-3 small"><strong>Reason provided:</strong> ${esc(r.rejectReason)}</div>` : ''}
            ${r.cancelReason ? `<div class="callout mt-3 small"><strong>Cancellation reason:</strong> ${esc(r.cancelReason)}</div>` : ''}
          </div></div>
        </div>
        <div class="stack">
          <div class="panel"><div class="panel-header"><div class="panel-title">Payment</div></div><div class="panel-body">
            ${p ? `<div class="kv mb-2"><div class="k">Status</div><div class="v">${statusBadge(p.status)}</div><div class="k">Method</div><div class="v">${esc(p.method)}</div><div class="k">Amount</div><div class="v">${fmtPHP(p.amount)}</div><div class="k">Submitted</div><div class="v">${fmtDate(p.submittedAt, { time: true })}</div></div>
              <div class="proof-preview">${p.proofDataUrl ? `<img src="${p.proofDataUrl}" alt="Payment proof">` : `<span class="muted small">Proof on file (${esc(p.proofEmoji || 'document')})</span>`}</div>
              ${p.rejectReason ? `<div class="callout danger small mt-2">Reason: ${esc(p.rejectReason)}</div>` : ''}`
            : (r.status === 'approved' ? `<p class="small muted mb-3">No payment proof has been submitted for this approved reservation.</p><a href="#/customer/reservation/${r.id}/pay" class="btn btn-primary btn-block">Upload payment proof</a>` : `<p class="small muted">Payment proof can be uploaded once the reservation is approved.</p>`)}
          </div></div>
          ${r.status === 'pending' ? `<div class="panel"><div class="panel-header"><div class="panel-title">Cancel request</div></div><div class="panel-body">
            <form onsubmit="App.submitCancelReservation(event,'${r.id}')">
              <div class="field"><label class="field-label" for="cancelReason">Reason (optional)</label><textarea id="cancelReason" name="reason" class="textarea" rows="3" placeholder="e.g. Schedule changed"></textarea></div>
              <div class="form-actions"><button type="submit" class="btn btn-danger">Cancel reservation</button></div>
            </form>
          </div></div>` : ''}
        </div>
      </div>
    `);
  }

  function renderCustomerPayment(id) {
    const r = getReservation(id);
    if (!r) return mount(`<div class="empty"><div class="empty-title">Reservation not found</div></div>`);
    if (r.status !== 'approved') return mount(`<div class="empty"><div class="empty-title">Payment upload unavailable</div><div>Payment proof can only be submitted for approved reservations. <a href="#/customer/reservation/${r.id}">Back to reservation</a></div></div>`);
    const v = getVehicle(r.vehicleId);
    mount(`
      <div style="margin-bottom:12px;"><a href="#/customer/reservation/${r.id}" class="btn btn-ghost btn-sm">&larr; Back to reservation</a></div>
      <div class="page-header"><div><h1 class="page-title">Upload payment proof</h1><p class="page-desc">Submit proof for administrator verification. Payment is completed outside the system.</p></div></div>
      <div class="grid-2">
        <div class="panel"><div class="panel-header"><div class="panel-title">Reservation summary</div></div><div class="panel-body">
          <div class="kv">
            <div class="k">Vehicle</div><div class="v">${esc(v ? v.name : '—')}</div>
            <div class="k">Period</div><div class="v">${fmtDateShort(r.start)} to ${fmtDateShort(r.end)}</div>
            <div class="k">Amount due</div><div class="v">${fmtPHP(r.totalFee)}</div>
          </div>
        </div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Payment details</div></div><div class="panel-body">
          <form onsubmit="App.submitPayment(event,'${r.id}')" class="stack">
            <div class="field"><label class="field-label" for="method">Payment method</label><select id="method" name="method" class="select"><option value="GCash">GCash</option><option value="Other">Other</option></select></div>
            <div class="field"><label class="field-label" for="amount">Amount (PHP)</label><input id="amount" name="amount" type="number" min="1" class="input" value="${r.totalFee}" required><div class="field-hint">Pre-filled with the reservation total. Adjust if needed.</div></div>
            <div class="field"><label class="field-label" for="proof">Proof image</label><input id="proof" name="proof" type="file" accept="image/*" class="input" onchange="App.previewProof(this)" required><div class="field-hint">Upload a screenshot or photo of the payment confirmation.</div>
              <div id="proofPreview" class="proof-preview"><span class="muted small">No image selected</span></div></div>
            <div class="callout info small">After submission, the payment status will be set to <strong>Pending confirmation</strong> until verified by the administrator.</div>
            <div class="form-actions"><a href="#/customer/reservation/${r.id}" class="btn">Cancel</a><button type="submit" class="btn btn-primary">Submit proof</button></div>
          </form>
        </div></div>
      </div>
    `);
  }

  function renderCustomerNotifications() {
    const list = state.notifications.filter(n => n.role === 'customer').sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    mount(`
      <div class="page-header"><div><h1 class="page-title">Notifications</h1><p class="page-desc">Updates about your reservations and payments.</p></div><div><button class="btn" onclick="App.markAllRead()">Mark all as read</button></div></div>
      ${list.length ? `<div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Status</th><th>Notification</th><th>Date</th><th></th></tr></thead><tbody>${list.map(n=>`
        <tr><td>${n.isRead ? '<span class="small muted">Read</span>' : '<span class="status status-pending">Unread</span>'}</td><td><div class="cell-main">${esc(n.title)}</div><div class="cell-sub">${esc(n.body)}</div></td><td class="small muted nowrap">${fmtDate(n.createdAt,{time:true})}</td><td class="text-right"><a class="btn btn-sm" href="${esc(n.link)}" onclick="App.markNotifRead('${n.id}')">Open</a></td></tr>`).join('')}</tbody></table></div></div>`
      : `<div class="empty"><div class="empty-title">No notifications</div><div>You're up to date.</div></div>`}
    `);
  }

  function renderCustomerHistory() {
    const cust = currentCustomer();
    const allMine = state.reservations.filter(r => r.customerId === cust.id || r.customerEmail === cust.email).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    const completed = allMine.filter(r => r.status === 'completed');
    const spent = completed.reduce((s,r)=> s + r.totalFee + (r.overtimeFee||0), 0);
    mount(`
      <div class="page-header"><div><h1 class="page-title">Account</h1><p class="page-desc">Your profile information and rental history.</p></div></div>
      <div class="grid-3">
        <div class="stack">
          <div class="panel"><div class="panel-header"><div class="panel-title">Profile</div></div><div class="panel-body">
            <div class="kv"><div class="k">Name</div><div class="v">${esc(cust.name)}</div><div class="k">Email</div><div class="v">${esc(cust.email)}</div><div class="k">Phone</div><div class="v">${esc(cust.phone)}</div><div class="k">Joined</div><div class="v">${fmtDateShort(cust.joinedAt)}</div></div>
          </div></div>
          <div class="metrics" style="grid-template-columns:1fr 1fr;">
            <div class="metric"><div class="metric-label">Completed rentals</div><div class="metric-value">${completed.length}</div></div>
            <div class="metric"><div class="metric-label">Total spent</div><div class="metric-value sm">${fmtPHP(spent)}</div></div>
          </div>
        </div>
        <div style="grid-column: span 2;">
          <div class="panel"><div class="panel-header"><div class="panel-title">Rental history</div></div><div class="panel-body flush">
            ${allMine.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Vehicle</th><th>Period</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${allMine.map(r=>{ const v=getVehicle(r.vehicleId); return `<tr><td><div class="cell-main">${esc(v?v.name:r.vehicleId)}</div><div class="cell-sub">${esc(v?v.plateNumber:'')}</div></td><td class="small">${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}</td><td>${fmtPHP(r.totalFee+(r.overtimeFee||0))}</td><td>${statusBadge(r.status)}</td><td class="text-right"><a class="btn btn-sm btn-ghost" href="#/customer/reservation/${r.id}">View</a></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty"><div class="empty-title">No rental history</div><div>Completed and past rentals will appear here.</div></div>`}
          </div></div>
        </div>
      </div>
    `);
  }

  // ---------- Admin: Dashboard ----------
  function renderAdminDashboard() {
    const pending = state.reservations.filter(r=>r.status==='pending').length;
    const active = state.reservations.filter(r=>r.status==='ongoing').length;
    const available = state.vehicles.filter(v=>v.status==='available').length;
    const month = new Date().getMonth(), year = new Date().getFullYear();
    const earnings = state.reservations.filter(r => r.status==='completed').filter(r=>{const d=new Date(r.actualReturn||r.end); return d.getMonth()===month && d.getFullYear()===year;}).reduce((s,r)=> s + r.totalFee + (r.overtimeFee||0), 0);
    const todayStr = todayKey();
    const todays = state.reservations.filter(r => (r.status==='approved'||r.status==='ongoing') && toManilaDateKey(r.start) <= todayStr && toManilaDateKey(r.end) >= todayStr);
    const perVehicle = state.vehicles.map(v => ({ v, val: state.reservations.filter(r=>r.vehicleId===v.id && r.status==='completed').reduce((s,r)=>s+r.totalFee+(r.overtimeFee||0),0)})).filter(x=>x.val>0).sort((a,b)=>b.val-a.val).slice(0,6);
    const max = Math.max(1, ...perVehicle.map(x=>x.val));
    mount(`
      <div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-desc">Operational overview for reservations, fleet status, and earnings.</p></div></div>
      <div class="metrics mb-3">
        <div class="metric"><div class="metric-label">Pending requests</div><div class="metric-value">${pending}</div></div>
        <div class="metric"><div class="metric-label">Active rentals</div><div class="metric-value">${active}</div></div>
        <div class="metric"><div class="metric-label">Available vehicles</div><div class="metric-value">${available}</div></div>
        <div class="metric"><div class="metric-label">Earnings (this month)</div><div class="metric-value sm">${fmtPHP(earnings)}</div></div>
      </div>
      <div class="grid-3">
        <div style="grid-column: span 2;" class="stack">
          <div class="panel"><div class="panel-header"><div class="panel-title">Today's schedule</div><a href="#/admin/reservations" class="btn btn-sm btn-ghost">View reservations</a></div>
            <div class="panel-body flush">${todays.length ? `<table class="table"><thead><tr><th>Customer</th><th>Vehicle</th><th>Period</th><th>Status</th></tr></thead><tbody>${todays.map(r=>{const v=getVehicle(r.vehicleId); return `<tr class="row-click" onclick="location.hash='#/admin/reservation/${r.id}'"><td class="cell-main">${esc(r.customerName)}</td><td>${esc(v?v.name:'')}</td><td class="small">${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}</td><td>${statusBadge(r.status)}</td></tr>`;}).join('')}</tbody></table>` : `<div class="empty">No rentals scheduled for today.</div>`}</div>
          </div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Earnings by vehicle</div><span class="small muted">Completed rentals</span></div><div class="panel-body">
            ${perVehicle.length ? perVehicle.map(x=>`<div class="bar-row"><div class="bar-label"><span>${esc(x.v.name)}</span><span>${fmtPHP(x.val)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(x.val/max*100).toFixed(1)}%"></div></div></div>`).join('') : `<div class="small muted">No completed rental earnings recorded yet.</div>`}
          </div></div>
        </div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Quick actions</div></div><div class="panel-body"><div class="stack">
          <a href="#/admin/reservations" class="btn btn-block">Review reservation requests</a>
          <a href="#/admin/payments" class="btn btn-block">Verify payments</a>
          <button class="btn btn-block" onclick="App.openVehicleModal()">Add vehicle</button>
          <a href="#/admin/maintenance" class="btn btn-block">Log maintenance or incident</a>
        </div></div></div>
      </div>
    `);
  }

  // ---------- Admin: Vehicles ----------
  function renderAdminVehicles() {
    mount(`
      <div class="page-header"><div><h1 class="page-title">Vehicles</h1><p class="page-desc">Manage fleet records and current vehicle status.</p></div><div><button class="btn btn-primary" onclick="App.openVehicleModal()">Add vehicle</button></div></div>
      <div class="panel"><div class="panel-body flush"><div class="table-wrap"><table class="table">
        <thead><tr><th>Vehicle</th><th>Type</th><th>Plate</th><th>Rates</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${state.vehicles.map(v=>`<tr>
          <td><div style="display:flex;align-items:center;gap:10px;">${vehicleMark(v)}<div><div class="cell-main">${esc(v.name)}</div><div class="cell-sub">${esc(v.brand)} ${esc(v.model)} · ${v.year}</div></div></div></td>
          <td style="text-transform:capitalize">${esc(v.type)}</td>
          <td class="mono">${esc(v.plateNumber)}</td>
          <td><div>${fmtPHP(v.ratePerDay)} / day</div><div class="cell-sub">${fmtPHP(v.ratePerHour)} / hour</div></td>
          <td>${statusBadge(v.status)}</td>
          <td><div class="btn-group">
            <select class="select" style="width:auto;padding:4px 8px;font-size:12px;" onchange="App.changeVehicleStatus('${v.id}', this.value)">
              ${['available','rented','maintenance','malfunction'].map(s=>`<option value="${s}" ${v.status===s?'selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}
            </select>
            <button class="btn btn-sm" onclick="App.openVehicleModal('${v.id}')">Edit</button>
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div></div></div>
    `);
  }

  // ---------- Admin: Reservations ----------
  function renderAdminReservations() {
    const tab = state.ui.adminResTab || 'pending';
    const tabs = [['pending','Pending'],['approved','Approved'],['ongoing','Ongoing'],['completed','Completed'],['cancelled','Cancelled'],['rejected','Rejected']];
    const list = state.reservations.filter(r=>r.status===tab).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    mount(`
      <div class="page-header"><div><h1 class="page-title">Reservations</h1><p class="page-desc">Review requests and manage rental status transitions.</p></div></div>
      <div class="tabs">${tabs.map(([k,l])=>`<button class="tab ${tab===k?'active':''}" onclick="App.setUI('adminResTab','${k}'); App.render()">${l} <span class="faint">(${state.reservations.filter(r=>r.status===k).length})</span></button>`).join('')}</div>
      ${list.length ? `<div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Customer</th><th>Vehicle</th><th>Period</th><th>Amount</th><th>Payment</th><th>Actions</th></tr></thead><tbody>${list.map(r=>{
        const v=getVehicle(r.vehicleId); const p=getPaymentByReservation(r.id);
        return `<tr>
          <td><div class="cell-main">${esc(r.customerName)}</div><div class="cell-sub">${esc(r.customerEmail)}</div></td>
          <td><div class="cell-main">${esc(v?v.name:r.vehicleId)}</div><div class="cell-sub">${esc(v?v.plateNumber:'')}</div></td>
          <td class="small">${fmtDateShort(r.start)} - ${fmtDateShort(r.end)}<div class="cell-sub">${esc(getDeliveryMethod(r))}</div></td>
          <td>${fmtPHP(r.totalFee)}${r.overtimeFee?`<div class="cell-sub">+ ${fmtPHP(r.overtimeFee)} OT</div>`:''}</td>
          <td>${p ? statusBadge(p.status) : '<span class="small muted">None</span>'}</td>
          <td><div class="btn-group">
            <a href="#/admin/reservation/${r.id}" class="btn btn-sm">View</a>
            ${r.status==='pending'?`<button class="btn btn-sm btn-primary" onclick="App.approveReservation('${r.id}')">Approve</button><button class="btn btn-sm btn-danger" onclick="App.openRejectReservationModal('${r.id}')">Reject</button>`:''}
            ${r.status==='approved'?`<button class="btn btn-sm btn-primary" onclick="App.startRental('${r.id}')">Start rental</button>`:''}
            ${r.status==='ongoing'?`<button class="btn btn-sm btn-primary" onclick="App.openCompleteModal('${r.id}')">Complete</button>`:''}
          </div></td>
        </tr>`;
      }).join('')}</tbody></table></div></div>` : `<div class="empty"><div class="empty-title">No ${esc(tab)} reservations</div><div>Reservations with this status will appear here.</div></div>`}
    `);
  }

  function renderAdminReservationDetail(id) {
    const r = getReservation(id);
    if (!r) return mount(`<div class="empty"><div class="empty-title">Reservation not found</div></div>`);
    const v = getVehicle(r.vehicleId); const p = getPaymentByReservation(r.id); const cust = getCustomer(r.customerId);
    mount(`
      <div style="margin-bottom:12px;"><a href="#/admin/reservations" class="btn btn-ghost btn-sm">&larr; Back to reservations</a></div>
      <div class="page-header"><div><h1 class="page-title">Reservation ${esc(r.id.toUpperCase())}</h1><p class="page-desc">${esc(r.customerName)} · ${esc(v?v.name:'Vehicle')}</p></div><div>${statusBadge(r.status)}</div></div>
      <div class="grid-3">
        <div class="stack" style="grid-column: span 2;">
          <div class="panel"><div class="panel-header"><div class="panel-title">Status</div></div><div class="panel-body">${timelineHTML(r.status)}</div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Reservation details</div></div><div class="panel-body">
            <div class="form-grid">
              <div class="kv"><div class="k">Customer</div><div class="v">${esc(r.customerName)}</div><div class="k">Email</div><div class="v">${esc(r.customerEmail)}</div><div class="k">Phone</div><div class="v">${esc(cust?cust.phone:'—')}</div><div class="k">Customer since</div><div class="v">${fmtDateShort(cust?cust.joinedAt:r.createdAt)}</div></div>
              <div class="kv"><div class="k">Vehicle</div><div class="v">${esc(v?v.name:'-')}</div><div class="k">Plate</div><div class="v mono">${esc(v?v.plateNumber:'-')}</div><div class="k">Period</div><div class="v">${fmtDateShort(r.start)} - ${fmtDateShort(r.end)}</div><div class="k">Delivery method</div><div class="v">${esc(getDeliveryMethod(r))}</div><div class="k">Requested</div><div class="v">${fmtDate(r.createdAt,{time:true})}</div></div>
            </div>
            <div class="divider"></div>
            <div class="kv"><div class="k">Rental fee</div><div class="v">${fmtPHP(r.totalFee)}</div><div class="k">Overtime fee</div><div class="v">${fmtPHP(r.overtimeFee||0)}</div><div class="k">Total</div><div class="v">${fmtPHP(r.totalFee + (r.overtimeFee||0))}</div>${r.actualReturn?`<div class="k">Actual return</div><div class="v">${fmtDate(r.actualReturn,{time:true})}</div>`:''}</div>
            ${r.rejectReason ? `<div class="callout danger mt-3 small"><strong>Rejection reason:</strong> ${esc(r.rejectReason)}</div>` : ''}
            ${r.cancelReason ? `<div class="callout mt-3 small"><strong>Cancellation reason:</strong> ${esc(r.cancelReason)}</div>` : ''}
          </div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Internal notes</div></div><div class="panel-body">
            <form onsubmit="App.saveAdminNotes(event,'${r.id}')"><textarea id="adminNotes" class="textarea" rows="3" placeholder="Add a note for internal reference">${esc(r.adminNotes||'')}</textarea><div class="form-actions"><button class="btn">Save note</button></div></form>
          </div></div>
        </div>
        <div class="stack">
          <div class="panel"><div class="panel-header"><div class="panel-title">Payment</div></div><div class="panel-body">
            ${p ? `<div class="kv mb-2"><div class="k">Status</div><div class="v">${statusBadge(p.status)}</div><div class="k">Method</div><div class="v">${esc(p.method)}</div><div class="k">Amount</div><div class="v">${fmtPHP(p.amount)}</div></div>
              <div class="proof-preview mb-2">${p.proofDataUrl ? `<img src="${p.proofDataUrl}" alt="Payment proof">` : `<span class="muted small">Proof on file</span>`}</div>
              ${p.status==='pending' ? `<div class="btn-group"><button class="btn btn-sm btn-primary" onclick="App.verifyPayment('${p.id}')">Verify</button><button class="btn btn-sm btn-danger" onclick="App.openRejectPaymentModal('${p.id}')">Reject</button></div>` : ''}
              ${p.rejectReason ? `<div class="callout danger small mt-2">${esc(p.rejectReason)}</div>` : ''}`
            : `<p class="small muted">No payment proof submitted.</p>`}
          </div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Actions</div></div><div class="panel-body"><div class="stack">
            ${r.status==='pending'?`<button class="btn btn-primary btn-block" onclick="App.approveReservation('${r.id}')">Approve reservation</button><button class="btn btn-danger btn-block" onclick="App.openRejectReservationModal('${r.id}')">Reject reservation</button>`:''}
            ${r.status==='approved'?`<button class="btn btn-primary btn-block" onclick="App.startRental('${r.id}')">Mark as ongoing (start rental)</button>`:''}
            ${r.status==='ongoing'?`<button class="btn btn-primary btn-block" onclick="App.openCompleteModal('${r.id}')">Complete rental</button>`:''}
            ${['completed','cancelled','rejected'].includes(r.status)?`<p class="small muted">No further actions available for this status.</p>`:''}
          </div></div></div>
        </div>
      </div>
    `);
  }

  // ---------- Admin: Payments ----------
  function renderAdminPayments() {
    const list = state.payments.slice().sort((a,b)=> new Date(b.submittedAt)-new Date(a.submittedAt));
    mount(`
      <div class="page-header"><div><h1 class="page-title">Payments</h1><p class="page-desc">Review submitted payment proofs and confirm verification status.</p></div></div>
      ${list.length ? `<div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Customer</th><th>Reservation</th><th>Method</th><th>Amount</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map(p=>{
        const r=getReservation(p.reservationId); const v=r?getVehicle(r.vehicleId):null;
        return `<tr>
          <td class="cell-main">${esc(r?r.customerName:'—')}</td>
          <td><div class="cell-main">${esc(v?v.name:'—')}</div><div class="cell-sub mono">${esc(r?r.id.toUpperCase():'')}</div></td>
          <td>${esc(p.method)}</td>
          <td>${fmtPHP(p.amount)}</td>
          <td class="small">${fmtDate(p.submittedAt,{time:true})}</td>
          <td>${statusBadge(p.status)}</td>
          <td><div class="btn-group">
            <button class="btn btn-sm" onclick="App.openPaymentModal('${p.id}')">View proof</button>
            ${p.status==='pending'?`<button class="btn btn-sm btn-primary" onclick="App.verifyPayment('${p.id}')">Verify</button><button class="btn btn-sm btn-danger" onclick="App.openRejectPaymentModal('${p.id}')">Reject</button>`:''}
          </div></td>
        </tr>`;
      }).join('')}</tbody></table></div></div>` : `<div class="empty"><div class="empty-title">No payments</div><div>Submitted payment proofs will appear here.</div></div>`}
    `);
  }

  // ---------- Admin: Maintenance ----------
  function renderAdminMaintenance() {
    const logs = state.maintenanceLogs.slice().sort((a,b)=> new Date(b.reportedAt)-new Date(a.reportedAt));
    mount(`
      <div class="page-header"><div><h1 class="page-title">Maintenance and incidents</h1><p class="page-desc">Track service records and reported vehicle issues.</p></div><div><button class="btn btn-primary" onclick="App.openMaintenanceModal()">Log entry</button></div></div>
      ${logs.length ? `<div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Vehicle</th><th>Type</th><th>Title</th><th>Reported</th><th>Cost</th><th>Status</th><th>Actions</th></tr></thead><tbody>${logs.map(l=>{
        const v=getVehicle(l.vehicleId);
        return `<tr>
          <td><div class="cell-main">${esc(v?v.name:l.vehicleId)}</div><div class="cell-sub">${esc(v?v.plateNumber:'')}</div></td>
          <td><span class="status ${l.type==='incident'?'status-malfunction':'status-approved'}">${esc(l.type)}</span></td>
          <td><div class="cell-main">${esc(l.title)}</div><div class="cell-sub">${esc(l.description)}</div></td>
          <td class="small">${fmtDate(l.reportedAt,{time:true})}${l.resolvedAt?`<div class="cell-sub">Resolved ${fmtDateShort(l.resolvedAt)}</div>`:''}</td>
          <td>${fmtPHP(l.cost||0)}</td>
          <td>${statusBadge(l.status)}</td>
          <td>${l.status==='open'?`<button class="btn btn-sm btn-primary" onclick="App.openResolveLogModal('${l.id}')">Resolve</button>`:'<span class="small muted">—</span>'}</td>
        </tr>`;
      }).join('')}</tbody></table></div></div>` : `<div class="empty"><div class="empty-title">No maintenance or incident records</div><div>Log service work or reported issues to track vehicle condition.</div></div>`}
    `);
  }

  // ---------- Admin: Reports ----------
  function renderAdminReports() {
    const range = state.ui.reportRange || 'month';
    const now = new Date();
    const inRange = (iso) => {
      if (!iso) return false; const d = new Date(iso); if (range === 'all') return true;
      if (range === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === last.getMonth() && d.getFullYear() === last.getFullYear();
    };
    const completed = state.reservations.filter(r => r.status === 'completed' && inRange(r.actualReturn || r.end));
    const totalRev = completed.reduce((s,r)=>s+r.totalFee+(r.overtimeFee||0),0);
    const totalOT = completed.reduce((s,r)=>s+(r.overtimeFee||0),0);
    const perV = state.vehicles.map(v=>({v, rev: completed.filter(r=>r.vehicleId===v.id).reduce((s,r)=>s+r.totalFee+(r.overtimeFee||0),0)})).filter(x=>x.rev>0).sort((a,b)=>b.rev-a.rev);
    const maxRev = Math.max(1, ...perV.map(x=>x.rev));
    const daysInPeriod = range==='all' ? 90 : new Date(now.getFullYear(), range==='month'?now.getMonth()+1:now.getMonth(), 0).getDate();
    const utilization = state.vehicles.map(v => {
      const rentedDays = state.reservations.filter(r=>r.vehicleId===v.id && ['approved','ongoing','completed'].includes(r.status) && inRange(r.start)).reduce((s,r)=>{ const endD = r.actualReturn ? new Date(r.actualReturn) : new Date(r.end); const ms = Math.min(endD, now) - new Date(r.start); return s + Math.max(0, Math.ceil(ms/86400000)); },0);
      const pct = Math.min(100, Math.round((rentedDays / Math.max(1, daysInPeriod)) * 100));
      return { v, rentedDays, pct };
    });
    const counts = { pending:0,approved:0,ongoing:0,completed:0,cancelled:0,rejected:0 };
    state.reservations.filter(r=>inRange(r.createdAt)).forEach(r=> { if (counts[r.status] != null) counts[r.status]++; });
    const cars = state.reservations.filter(r=>inRange(r.createdAt) && getVehicle(r.vehicleId)?.type==='car').length;
    const motos = state.reservations.filter(r=>inRange(r.createdAt) && getVehicle(r.vehicleId)?.type==='motorcycle').length;
    const typeMax = Math.max(1, cars, motos);
    mount(`
      <div class="page-header"><div><h1 class="page-title">Reports</h1><p class="page-desc">Summary of earnings, utilization, and reservation activity.</p></div>
        <div><select class="select" onchange="App.setUI('reportRange', this.value); App.render()">
          <option value="month" ${range==='month'?'selected':''}>This month</option>
          <option value="last" ${range==='last'?'selected':''}>Last month</option>
          <option value="all" ${range==='all'?'selected':''}>All time</option>
        </select></div></div>
      <div class="metrics mb-3">
        <div class="metric"><div class="metric-label">Total revenue</div><div class="metric-value sm">${fmtPHP(totalRev)}</div></div>
        <div class="metric"><div class="metric-label">Overtime collected</div><div class="metric-value sm">${fmtPHP(totalOT)}</div></div>
        <div class="metric"><div class="metric-label">Completed rentals</div><div class="metric-value">${completed.length}</div></div>
        <div class="metric"><div class="metric-label">Reservations created</div><div class="metric-value">${state.reservations.filter(r=>inRange(r.createdAt)).length}</div></div>
      </div>
      <div class="grid-2 mb-3">
        <div class="panel"><div class="panel-header"><div class="panel-title">Revenue by vehicle</div></div><div class="panel-body">
          ${perV.length ? perV.map(x=>`<div class="bar-row"><div class="bar-label"><span>${esc(x.v.name)}</span><span>${fmtPHP(x.rev)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(x.rev/maxRev*100).toFixed(1)}%"></div></div></div>`).join('') : `<div class="small muted">No completed revenue in this period.</div>`}
        </div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Vehicle utilization</div><span class="small muted">Estimated rented days</span></div><div class="panel-body">
          ${utilization.map(u=>`<div class="bar-row"><div class="bar-label"><span>${esc(u.v.name)}</span><span>${u.rentedDays} days · ${u.pct}%</span></div><div class="bar-track"><div class="bar-fill alt" style="width:${u.pct}%"></div></div></div>`).join('')}
        </div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-header"><div class="panel-title">Reservations by status</div><span class="small muted">By creation date</span></div><div class="panel-body flush"><table class="table"><tbody>${Object.entries(counts).map(([k,v])=>`<tr><td style="text-transform:capitalize">${esc(k)}</td><td class="text-right"><strong>${v}</strong></td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Reservations by vehicle type</div></div><div class="panel-body">
          <div class="bar-row"><div class="bar-label"><span>Cars</span><span>${cars}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(cars/typeMax*100)}%"></div></div></div>
          <div class="bar-row"><div class="bar-label"><span>Motorcycles</span><span>${motos}</span></div><div class="bar-track"><div class="bar-fill alt" style="width:${(motos/typeMax*100)}%"></div></div></div>
        </div></div>
      </div>
    `);
  }

  // ---------- Admin: Customers ----------
  function renderAdminCustomers() {
    const rows = state.customers.map(c => {
      const mine = state.reservations.filter(r=>r.customerId===c.id);
      const spent = mine.filter(r=>r.status==='completed').reduce((s,r)=>s+r.totalFee+(r.overtimeFee||0),0);
      return { c, count: mine.length, spent };
    });
    mount(`
      <div class="page-header"><div><h1 class="page-title">Customers</h1><p class="page-desc">Customer records and rental summaries.</p></div></div>
      <div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Name</th><th>Contact</th><th>Total rentals</th><th>Total spent</th><th>Joined</th><th></th></tr></thead><tbody>${rows.map(({c,count,spent})=>`
        <tr><td class="cell-main">${esc(c.name)}</td><td><div>${esc(c.email)}</div><div class="cell-sub">${esc(c.phone)}</div></td><td>${count}</td><td>${fmtPHP(spent)}</td><td class="small">${fmtDateShort(c.joinedAt)}</td><td class="text-right"><button class="btn btn-sm" onclick="App.openCustomerModal('${c.id}')">View history</button></td></tr>`).join('')}</tbody></table></div></div>
    `);
  }

  // ---------- Modal renderers ----------
  function openVehicleModal(id) {
    const v = id ? getVehicle(id) : null;
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${v?'Edit vehicle':'Add vehicle'}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.saveVehicle(event, ${v?`'${v.id}'`:'null'})"><div class="modal-body"><div class="form-grid">
        <div class="field"><label class="field-label">Display name</label><input name="name" class="input" required value="${esc(v?v.name:'')}"></div>
        <div class="field"><label class="field-label">Type</label><select name="type" class="select"><option value="car" ${v&&v.type==='car'?'selected':''}>Car</option><option value="motorcycle" ${v&&v.type==='motorcycle'?'selected':''}>Motorcycle</option></select></div>
        <div class="field"><label class="field-label">Brand</label><input name="brand" class="input" required value="${esc(v?v.brand:'')}"></div>
        <div class="field"><label class="field-label">Model</label><input name="model" class="input" required value="${esc(v?v.model:'')}"></div>
        <div class="field"><label class="field-label">Year</label><input name="year" type="number" min="1990" max="2035" class="input" required value="${v?v.year:new Date().getFullYear()}"></div>
        <div class="field"><label class="field-label">Plate number</label><input name="plateNumber" class="input" required value="${esc(v?v.plateNumber:'')}"></div>
        <div class="field"><label class="field-label">Rate per day (PHP)</label><input name="ratePerDay" type="number" min="1" class="input" required value="${v?v.ratePerDay:1500}"></div>
        <div class="field"><label class="field-label">Rate per hour (PHP)</label><input name="ratePerHour" type="number" min="1" class="input" required value="${v?v.ratePerHour:120}"></div>
        <div class="field"><label class="field-label">Seats</label><input name="seats" type="number" min="1" max="20" class="input" required value="${v?v.seats:5}"></div>
        <div class="field"><label class="field-label">Transmission</label><select name="transmission" class="select"><option ${v&&v.transmission==='Automatic'?'selected':''}>Automatic</option><option ${v&&v.transmission==='Manual'?'selected':''}>Manual</option></select></div>
        <div class="field"><label class="field-label">Color</label><input name="color" class="input" value="${esc(v?v.color:'')}"></div>
      </div></div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Save vehicle</button></div></form></div>`);
  }

  function openMaintenanceModal() {
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Log maintenance or incident</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.saveMaintenance(event)"><div class="modal-body stack">
        <div class="field"><label class="field-label">Vehicle</label><select name="vehicleId" class="select" required>${state.vehicles.map(v=>`<option value="${v.id}">${esc(v.name)} (${esc(v.plateNumber)})</option>`).join('')}</select></div>
        <div class="form-grid">
          <div class="field"><label class="field-label">Type</label><select name="type" class="select"><option value="maintenance">Maintenance</option><option value="incident">Incident</option></select></div>
          <div class="field"><label class="field-label">Estimated cost (PHP)</label><input name="cost" type="number" min="0" class="input" value="0"></div>
        </div>
        <div class="field"><label class="field-label">Title</label><input name="title" class="input" required placeholder="e.g. Oil change and brake check"></div>
        <div class="field"><label class="field-label">Description</label><textarea name="description" class="textarea" rows="3" required placeholder="Describe the work or issue"></textarea></div>
        <div class="callout info small">Logging a maintenance entry may set an available vehicle to Maintenance; incidents may set it to Malfunction.</div>
      </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Save log</button></div></form></div>`);
  }

  function openCompleteModal(id) {
    const r = getReservation(id); if (!r) return;
    const val = fmtDateTimeInput(r.end);
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Complete rental</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.completeRental(event,'${r.id}')"><div class="modal-body stack">
        <div class="callout info small">Scheduled end: <strong>${fmtDate(r.end,{time:true})}</strong>. Enter the actual return time to calculate any overtime charges.</div>
        <div class="field"><label class="field-label">Actual return date and time</label><input name="actualReturn" type="datetime-local" class="input" value="${val}" required></div>
      </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Complete rental</button></div></form></div>`);
  }

  function openRejectReservationModal(id) {
    const r = getReservation(id); if (!r) return;
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Reject reservation</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.submitRejectReservation(event,'${r.id}')"><div class="modal-body stack">
        <p class="small muted">Provide a reason for rejecting this request. The customer will be notified.</p>
        <div class="field"><label class="field-label">Reason</label><textarea name="reason" class="textarea" rows="3" required placeholder="e.g. Incomplete requirements or unavailable dates"></textarea></div>
      </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-danger-solid">Reject reservation</button></div></form></div>`);
  }

  function openRejectPaymentModal(pid) {
    const p = state.payments.find(x=>x.id===pid); if (!p) return;
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Reject payment proof</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.submitRejectPayment(event,'${pid}')"><div class="modal-body stack">
        <p class="small muted">Provide a reason for rejecting this payment proof.</p>
        <div class="field"><label class="field-label">Reason</label><textarea name="reason" class="textarea" rows="3" required placeholder="e.g. Reference number not readable"></textarea></div>
      </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-danger-solid">Reject payment</button></div></form></div>`);
  }

  function openResolveLogModal(id) {
    const l = state.maintenanceLogs.find(x=>x.id===id); if (!l) return;
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Resolve log entry</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.submitResolveLog(event,'${id}')"><div class="modal-body stack">
        <p class="small muted"><strong>${esc(l.title)}</strong> — enter the final cost and mark this entry as resolved.</p>
        <div class="field"><label class="field-label">Final cost (PHP)</label><input name="cost" type="number" min="0" class="input" value="${Number(l.cost||0)}" required></div>
      </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Mark resolved</button></div></form></div>`);
  }

  function openPaymentModal(pid) {
    const p = state.payments.find(x=>x.id===pid); if (!p) return;
    const r = getReservation(p.reservationId); const v = r ? getVehicle(r.vehicleId) : null;
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Payment proof</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <div class="modal-body stack">
        <div class="kv"><div class="k">Customer</div><div class="v">${esc(r?r.customerName:'—')}</div><div class="k">Vehicle</div><div class="v">${esc(v?v.name:'—')}</div><div class="k">Method</div><div class="v">${esc(p.method)}</div><div class="k">Amount</div><div class="v">${fmtPHP(p.amount)}</div><div class="k">Status</div><div class="v">${statusBadge(p.status)}</div></div>
        <div class="proof-preview" style="min-height:160px;">${p.proofDataUrl ? `<img src="${p.proofDataUrl}" alt="Payment proof" style="max-height:360px;">` : `<span class="muted small">Proof on file</span>`}</div>
        ${p.rejectReason ? `<div class="callout danger small">Reason: ${esc(p.rejectReason)}</div>` : ''}
      </div>
      <div class="modal-footer">${p.status==='pending'?`<button class="btn btn-danger" onclick="App.openRejectPaymentModal('${p.id}')">Reject</button><button class="btn btn-primary" onclick="App.verifyPayment('${p.id}')">Verify payment</button>`:`<button class="btn" onclick="App.closeModal()">Close</button>`}</div></div>`);
  }

  function openCustomerModal(cid) {
    const c = getCustomer(cid); if (!c) return;
    const mine = state.reservations.filter(r=>r.customerId===c.id).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${esc(c.name)}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <div class="modal-body stack">
        <div class="kv"><div class="k">Email</div><div class="v">${esc(c.email)}</div><div class="k">Phone</div><div class="v">${esc(c.phone)}</div><div class="k">Joined</div><div class="v">${fmtDateShort(c.joinedAt)}</div></div>
        <div><div class="section-title mb-2">Rental history</div>${mine.length ? `<table class="table"><thead><tr><th>Vehicle</th><th>Period</th><th>Amount</th><th>Status</th></tr></thead><tbody>${mine.map(r=>{const v=getVehicle(r.vehicleId); return `<tr><td>${esc(v?v.name:'')}</td><td class="small">${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}</td><td>${fmtPHP(r.totalFee+(r.overtimeFee||0))}</td><td>${statusBadge(r.status)}</td></tr>`;}).join('')}</tbody></table>` : `<div class="small muted">No rentals recorded.</div>`}</div>
      </div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Close</button></div></div>`);
  }

  // ---------- Actions ----------
  function loginAs(role) { state.role = role; localStorage.setItem('vera_role', role); toast(`Signed in as ${role === 'admin' ? 'Administrator' : 'Customer'}.`, 'success'); navigate(role === 'admin' ? '#/admin/dashboard' : '#/customer/vehicles'); }
  function switchRole(role) { if (state.role === role) return; loginAs(role); }
  function setUI(key, val) { state.ui[key] = val; }
  function render() { route(); }
  function toggleNotifications(e) { if (e) e.stopPropagation(); state.ui.notifOpen = !state.ui.notifOpen; renderChrome(); }
  function closeNotifications() { state.ui.notifOpen = false; renderChrome(); }
  function markAllRead() { state.notifications.forEach(n => { if (n.role === state.role) n.isRead = true; }); toast('All notifications marked as read.', 'success'); render(); }
  function markNotifRead(id) { const n = state.notifications.find(x => x.id === id); if (n) n.isRead = true; }

  function updateFeePreview(vehicleId) {
    const form = $('#reqForm'); if (!form) return;
    const start = form.start.value, end = form.end.value;
    const box = $('#feePreview'), msg = $('#conflictMsg');
    if (msg) msg.innerHTML = '';
    if (!start || !end) { box.className = 'callout info small'; box.innerHTML = 'Select start and end dates to calculate the estimated fee.'; return; }
    if (new Date(end) <= new Date(start)) { box.className = 'callout danger small'; box.innerHTML = 'End date and time must be after the start.'; return; }
    const { days, total } = computeFee(vehicleId, start, end);
    box.className = 'callout small';
    box.innerHTML = `<strong>Estimated rental:</strong> ${days} day(s) × daily rate = <strong>${fmtPHP(total)}</strong><div class="muted" style="margin-top:4px;">Overtime, if any, is calculated at return based on the hourly rate.</div>`;
    const conflict = hasConflict(vehicleId, new Date(start).toISOString(), new Date(end).toISOString());
    if (conflict.conflict && msg) msg.innerHTML = `<div class="callout danger small mt-2"><strong>Dates unavailable.</strong> ${esc(conflict.reason || 'This vehicle is already booked for the selected period.')}</div>`;
  }

  function submitReservation(e, vehicleId) {
    e.preventDefault();
    const form = e.target; const btn = form.querySelector('button[type="submit"]');
    if (btn && btn.disabled) return;
    const startVal = form.start.value, endVal = form.end.value;
    const deliveryMethod = form.deliveryMethod ? form.deliveryMethod.value : '';
    if (!startVal || !endVal) { toast('Please select start and end dates.', 'error'); return; }
    if (!DELIVERY_METHODS.includes(deliveryMethod)) {
      toast('Please select a delivery method.', 'error');
      if (form.deliveryMethod) form.deliveryMethod.focus();
      return;
    }
    const start = new Date(startVal).toISOString(), end = new Date(endVal).toISOString();
    if (new Date(end) <= new Date(start)) { toast('End date must be after start date.', 'error'); updateFeePreview(vehicleId); return; }
    const conflict = hasConflict(vehicleId, start, end);
    if (conflict.conflict) {
      const msg = $('#conflictMsg'); if (msg) msg.innerHTML = `<div class="callout danger small"><strong>Dates unavailable.</strong> ${esc(conflict.reason || '')}</div>`;
      toast('Selected dates overlap an existing booking.', 'error'); return;
    }
    if (btn) btn.disabled = true;
    const cust = currentCustomer();
    const { total } = computeFee(vehicleId, start, end);
    const r = { id: uid('r'), vehicleId, customerId: cust.id, customerName: cust.name, customerEmail: cust.email, start, end, actualReturn: null, status: 'pending', totalFee: total, overtimeFee: 0, createdAt: new Date().toISOString(), approvedBy: null, rejectReason: '', adminNotes: '', deliveryMethod };
    setTimeout(() => {
      state.reservations.unshift(r);
      notify('admin', 'New reservation request', `${cust.name} requested ${getVehicle(vehicleId)?.name || 'a vehicle'}.`, '#/admin/reservations');
      toast('Reservation request submitted.', 'success');
      navigate('#/customer/reservations');
    }, 300);
  }

  function confirmCancelReservation(id) {
    openConfirm({ title: 'Cancel reservation request', body: `<p class="small muted">Cancel this pending reservation request? This action cannot be undone.</p>`, confirmLabel: 'Cancel request', danger: true, onConfirm: () => { closeModal(); customerCancel(id); } });
  }
  function submitCancelReservation(e, id) { e.preventDefault(); const reason = e.target.reason ? e.target.reason.value : ''; customerCancel(id, reason); }
  function customerCancel(id, reason) {
    const r = getReservation(id); if (!r || r.status !== 'pending') return;
    r.status = 'cancelled';
    r.cancelReason = (reason || 'Cancelled by customer').trim();
    notify('admin', 'Reservation cancelled', `${r.customerName} cancelled a pending request.`, '#/admin/reservations');
    toast('Reservation cancelled.', 'info');
    render();
  }

  function previewProof(input) {
    const file = input.files && input.files[0];
    const box = $('#proofPreview');
    if (!box) return;
    if (input.dataset.previewUrl) {
      try { URL.revokeObjectURL(input.dataset.previewUrl); } catch (_) {}
      delete input.dataset.previewUrl;
    }
    if (!file) { box.innerHTML = '<span class="muted small">No image selected</span>'; return; }
    const url = URL.createObjectURL(file);
    input.dataset.previewUrl = url;
    box.innerHTML = `<img src="${url}" alt="Payment proof preview">`;
  }
  function submitPayment(e, reservationId) {
    e.preventDefault();
    const r = getReservation(reservationId); if (!r) return;
    const form = e.target; const btn = form.querySelector('button[type="submit"]');
    const method = form.method.value;
    const amount = Number(form.amount.value || r.totalFee);
    const file = form.proof.files && form.proof.files[0];
    if (!file) { toast('Please select a proof image.', 'error'); return; }
    if (!amount || amount < 1) { toast('Please enter a valid amount.', 'error'); return; }
    if (btn) btn.disabled = true;
    const proofDataUrl = URL.createObjectURL(file);
    setTimeout(() => {
      const existing = getPaymentByReservation(reservationId);
      if (existing) {
        Object.assign(existing, { method, amount, status: 'pending', submittedAt: new Date().toISOString(), proofDataUrl, rejectReason: '', verifiedBy: null });
      } else {
        state.payments.unshift({ id: uid('p'), reservationId, method, amount, proofEmoji: 'receipt', proofDataUrl, status: 'pending', submittedAt: new Date().toISOString(), verifiedBy: null, rejectReason: '' });
      }
      notify('admin', 'Payment proof submitted', `${r.customerName} submitted ${method} proof for ${getVehicle(r.vehicleId)?.name || 'a reservation'}.`, '#/admin/payments');
      toast('Payment proof submitted for confirmation.', 'success');
      navigate(`#/customer/reservation/${reservationId}`);
    }, 300);
  }

  function approveReservation(id) {
    const r = getReservation(id); if (!r || r.status !== 'pending') return;
    r.status = 'approved'; r.approvedBy = 'Admin';
    notify('customer', 'Reservation approved', `Your ${getVehicle(r.vehicleId)?.name || 'reservation'} was approved. You may now upload payment proof.`, '#/customer/reservations');
    toast('Reservation approved.', 'success'); render();
  }
  function openRejectReservationModalAction(id) { openRejectReservationModal(id); }
  function submitRejectReservation(e, id) {
    e.preventDefault();
    const r = getReservation(id); if (!r || r.status !== 'pending') return;
    const reason = (e.target.reason.value || '').trim();
    if (!reason) { toast('Please provide a reason.', 'error'); return; }
    r.status = 'rejected'; r.rejectReason = reason; r.approvedBy = 'Admin';
    notify('customer', 'Reservation rejected', `Your ${getVehicle(r.vehicleId)?.name || 'reservation'} was rejected.`, '#/customer/reservations');
    closeModal(); toast('Reservation rejected.', 'info'); render();
  }
  // compatibility: if called directly
  function rejectReservation(id) { openRejectReservationModal(id); }

  function startRental(id) {
    const r = getReservation(id); if (!r || r.status !== 'approved') return;
    openConfirm({ title: 'Start rental', body: `<p class="small muted">Mark this reservation as ongoing? The vehicle will be set to <strong>Rented</strong>.</p>`, confirmLabel: 'Start rental', onConfirm: () => {
      closeModal();
      r.status = 'ongoing';
      const v = getVehicle(r.vehicleId); if (v) v.status = 'rented';
      notify('customer', 'Rental started', `Your rental for ${v ? v.name : 'the vehicle'} is now ongoing.`, '#/customer/reservations');
      toast('Rental marked as ongoing.', 'success'); render();
    }});
  }
  function completeRental(e, id) {
    e.preventDefault();
    const r = getReservation(id); if (!r || r.status !== 'ongoing') return;
    const val = e.target.actualReturn.value;
    if (!val) { toast('Please enter the actual return time.', 'error'); return; }
    const actual = new Date(val).toISOString();
    const ot = computeOvertime(r.vehicleId, r.end, actual);
    r.status = 'completed'; r.actualReturn = actual; r.overtimeFee = ot.fee;
    const v = getVehicle(r.vehicleId); if (v) v.status = 'available';
    const cust = getCustomer(r.customerId); if (cust) cust.totalRentals = (cust.totalRentals || 0) + 1;
    notify('customer', 'Rental completed', `Your rental for ${v ? v.name : 'the vehicle'} is completed.${ot.fee ? ' Overtime: ' + fmtPHP(ot.fee) + '.' : ''}`, '#/customer/history');
    closeModal(); toast('Rental completed.', 'success'); render();
  }

  function verifyPayment(pid) {
    const p = state.payments.find(x=>x.id===pid); if (!p) return;
    if (p.status === 'verified') return;
    openConfirm({ title: 'Verify payment', body: `<p class="small muted">Confirm that this payment proof has been checked and verified?</p>`, confirmLabel: 'Verify payment', onConfirm: () => {
      closeModal();
      p.status = 'verified'; p.verifiedBy = 'Admin'; p.rejectReason = '';
      const r = getReservation(p.reservationId);
      if (r) notify('customer', 'Payment verified', `Your payment for ${getVehicle(r.vehicleId)?.name || 'your reservation'} has been verified.`, '#/customer/reservations');
      toast('Payment verified.', 'success'); render();
    }});
  }
  function submitRejectPayment(e, pid) {
    e.preventDefault();
    const p = state.payments.find(x=>x.id===pid); if (!p) return;
    const reason = (e.target.reason.value || '').trim();
    if (!reason) { toast('Please provide a reason.', 'error'); return; }
    p.status = 'rejected'; p.rejectReason = reason; p.verifiedBy = 'Admin';
    const r = getReservation(p.reservationId);
    if (r) notify('customer', 'Payment rejected', `Your payment proof was rejected. Reason: ${reason}`, '#/customer/reservations');
    closeModal(); toast('Payment rejected.', 'info'); render();
  }
  function rejectPayment(pid) { openRejectPaymentModal(pid); }

  function changeVehicleStatus(id, status) {
    const v = getVehicle(id); if (!v || v.status === status) return;
    setVehicleStatus(id, status);
  }
  function setVehicleStatus(id, status) {
    const v = getVehicle(id); if (!v) return;
    v.status = status;
    toast(`${v.name} status updated to ${status}.`, 'success');
    render();
  }
  function saveVehicle(e, id) {
    e.preventDefault();
    const f = e.target;
    const data = {
      name: f.name.value.trim(), type: f.type.value, brand: f.brand.value.trim(), model: f.model.value.trim(),
      year: Number(f.year.value), plateNumber: f.plateNumber.value.trim(),
      ratePerDay: Number(f.ratePerDay.value), ratePerHour: Number(f.ratePerHour.value),
      color: f.color.value.trim(), seats: Number(f.seats.value || 4), transmission: f.transmission.value
    };
    if (!data.name || !data.plateNumber) { toast('Please complete required fields.', 'error'); return; }
    if (id) { Object.assign(getVehicle(id), data); toast('Vehicle updated.', 'success'); }
    else { state.vehicles.unshift({ id: uid('v'), status: 'available', imageEmoji: '', ...data }); toast('Vehicle added.', 'success'); }
    closeModal(); render();
  }

  function saveMaintenance(e) {
    e.preventDefault();
    const f = e.target;
    const log = { id: uid('m'), vehicleId: f.vehicleId.value, type: f.type.value, title: f.title.value.trim(), description: f.description.value.trim(), cost: Number(f.cost.value||0), status: 'open', reportedAt: new Date().toISOString(), resolvedAt: null };
    if (!log.title || !log.description) { toast('Please provide a title and description.', 'error'); return; }
    state.maintenanceLogs.unshift(log);
    const v = getVehicle(log.vehicleId);
    if (v) {
      if (log.type === 'incident') v.status = 'malfunction';
      else if (log.type === 'maintenance' && v.status === 'available') v.status = 'maintenance';
    }
    notify('admin', 'Log entry added', `${log.title} recorded for ${v ? v.name : 'a vehicle'}.`, '#/admin/maintenance');
    closeModal(); toast('Log entry saved.', 'success'); render();
  }
  function submitResolveLog(e, id) {
    e.preventDefault();
    const l = state.maintenanceLogs.find(x=>x.id===id); if (!l) return;
    const cost = Number(e.target.cost.value || 0);
    l.status = 'resolved'; l.resolvedAt = new Date().toISOString(); l.cost = cost;
    const v = getVehicle(l.vehicleId);
    if (v && (v.status === 'maintenance' || v.status === 'malfunction')) {
      const hasOpen = state.maintenanceLogs.some(x=>x.vehicleId===v.id && x.status==='open');
      if (!hasOpen) v.status = 'available';
    }
    closeModal(); toast('Log marked as resolved.', 'success'); render();
  }
  function resolveLog(id) { openResolveLogModal(id); }

  function saveAdminNotes(e, id) {
    if (e) e.preventDefault();
    const r = getReservation(id); if (!r) return;
    r.adminNotes = ($('#adminNotes')?.value || '').trim();
    toast('Note saved.', 'success');
  }

  // ---------- Wiring ----------
  window.App = {
    loginAs, switchRole, goHome, setUI, render, toggleNotifications, closeNotifications, markAllRead, markNotifRead,
    updateFeePreview, submitReservation, confirmCancelReservation, submitCancelReservation, customerCancel,
    previewProof, submitPayment,
    approveReservation, rejectReservation, openRejectReservationModal, submitRejectReservation,
    startRental, openCompleteModal, completeRental,
    openPaymentModal, verifyPayment, rejectPayment, openRejectPaymentModal, submitRejectPayment,
    openVehicleModal, saveVehicle, setVehicleStatus, changeVehicleStatus,
    openMaintenanceModal, saveMaintenance, resolveLog, openResolveLogModal, submitResolveLog,
    saveAdminNotes, openCustomerModal, closeModal, _confirm: null,
    // Exposed for automated tests and inspection (no UI behavior change)
    DELIVERY_METHODS, getDeliveryMethod, overlaps, computeFee, computeOvertime, hasConflict
  };

  document.addEventListener('click', (e) => {
    const dd = $('#notifDropdown'), btn = $('#notifBtn');
    if (state.ui.notifOpen && dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
      state.ui.notifOpen = false; renderChrome();
    }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('load', () => {
    const saved = localStorage.getItem('vera_role');
    if (saved && !state.role) state.role = saved;
    if (state.role && (!location.hash || location.hash === '#/' || location.hash === '#')) {
      navigate(state.role === 'admin' ? '#/admin/dashboard' : '#/customer/vehicles');
    } else {
      route();
    }
  });
})();