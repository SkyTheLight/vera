// V.E.R.A. App (vanilla JS, hash router, in-memory state)
(function () {
    'use strict';
    const state = window.VERA_STATE;
    const $ = (sel, root = document) => root.querySelector(sel);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtPHP = (n) => '₱' + Number(n || 0).toLocaleString('en-PH');
    const fmtDate = (iso, opts = {}) => {
        if (!iso)
            return '—';
        const d = new Date(iso);
        return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: opts.time ? 'short' : undefined, ...opts });
    };
    const fmtDateShort = (iso) => {
        if (!iso)
            return '—';
        return new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
    };
    const fmtDateTimeInput = (iso) => {
        if (!iso)
            return '';
        const d = new Date(iso);
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
        const o = {};
        p.forEach(x => o[x.type] = x.value);
        return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;
    };
    const toManilaDateKey = (iso) => {
        const d = new Date(iso);
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
        const obj = {};
        parts.forEach(p => obj[p.type] = p.value);
        return `${obj.year}-${obj.month}-${obj.day}`;
    };
    const todayKey = () => toManilaDateKey(new Date().toISOString());
    const uid = (p) => p + Math.random().toString(36).slice(2, 8);
    const DISPLACEMENT_CLASSES = { '400': '400cc Class', '600': '600cc Class', '1000': '1000cc Class' };
    const displacementLabel = displacement => DISPLACEMENT_CLASSES[String(displacement)] || 'Unspecified';
    const DELIVERY_METHODS = [
        'Guest Pickup & Guest Return',
        'Guest Pickup & Host Collection',
        'Host Delivery & Guest Return',
        'Host Delivery & Host Collection'
    ];
    function getDeliveryMethod(r) {
        if (!r || r.deliveryMethod == null || r.deliveryMethod === '')
            return 'Not specified';
        return DELIVERY_METHODS.includes(r.deliveryMethod) ? r.deliveryMethod : String(r.deliveryMethod);
    }
    // ---------- Domain ----------
    function getVehicle(id) {
        return state.vehicles.find(v => v.id === id);
    }
    function getReservation(id) {
        return state.reservations.find(r => r.id === id);
    }
    function getPaymentByReservation(rid, type = 'rental') {
        return state.payments.find(p => p.reservationId === rid && (p.paymentType || 'rental') === type);
    }
    function getCustomer(id) {
        return state.customers.find(c => c.id === id);
    }
    function ownsReservation(r) {
        const c = currentCustomer();
        return !!c && (r.customerId === c.id || (!r.customerId && r.customerEmail === c.email));
    }
    function currentCustomer() {
        return getCustomer(state.currentCustomerId) || state.customers[0];
    }
    function reservationsForVehicle(vehicleId) {
        return state.reservations.filter(r => r.vehicleId === vehicleId);
    }
    function overlaps(aStart, aEnd, bStart, bEnd) {
        return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
    }
    function hasConflict(vehicleId, start, end, excludeId) {
        const v = getVehicle(vehicleId);
        if (!v)
            return { conflict: true, reason: 'Vehicle not found.' };
        if (v.status === 'maintenance' || v.status === 'malfunction')
            return { conflict: true, reason: `Vehicle is currently marked as ${v.status}.` };
        const blocking = reservationsForVehicle(vehicleId).filter(r => (r.status === 'approved' || r.status === 'ongoing') && r.id !== excludeId);
        for (const r of blocking) {
            if (overlaps(start, end, r.start, r.end))
                return { conflict: true, reason: `Overlaps with an existing rental (${fmtDateShort(r.start)}–${fmtDateShort(r.end)}).`, conflictRes: r };
        }
        return { conflict: false };
    }
    function computeFee(vehicleId, start, end) {
        const v = getVehicle(vehicleId);
        if (!v || !start || !end)
            return { days: 0, total: 0 };
        const ms = new Date(end) - new Date(start);
        if (!Number.isFinite(ms) || ms <= 0)
            return { days: 0, total: 0 };
        const days = Math.max(1, Math.ceil(ms / 86400000));
        return { days, total: days * v.ratePerDay };
    }
    const DEFAULT_DEPOSIT_AMOUNT = 5000;
    const DEFAULT_OVERTIME_SETTINGS = {
        tiers: { 1: 500, 2: 800, 3: 1000 },
        perHourAfterThird: 500,
        fullDayAfterHours: 6,
        cleaningFee: 200
    };

    function getDepositAmount() {
        const v = Number(state?.settings?.depositAmount);
        return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DEPOSIT_AMOUNT;
    }

    function getOvertimeSettings() {
        const s = state && state.settings && state.settings.overtime ? state.settings.overtime : {};
        const tiers = Object.assign({}, DEFAULT_OVERTIME_SETTINGS.tiers, s.tiers || {});
        return {
            tiers: {
                1: Number(tiers[1]) || DEFAULT_OVERTIME_SETTINGS.tiers[1],
                2: Number(tiers[2]) || DEFAULT_OVERTIME_SETTINGS.tiers[2],
                3: Number(tiers[3]) || DEFAULT_OVERTIME_SETTINGS.tiers[3]
            },
            perHourAfterThird: Number(s.perHourAfterThird) || DEFAULT_OVERTIME_SETTINGS.perHourAfterThird,
            fullDayAfterHours: Number(s.fullDayAfterHours) || DEFAULT_OVERTIME_SETTINGS.fullDayAfterHours,
            cleaningFee: Number(s.cleaningFee) || DEFAULT_OVERTIME_SETTINGS.cleaningFee
        };
    }

    function computeOvertime(vehicleId, scheduledEnd, actualReturn, options = {}) {
        const v = getVehicle(vehicleId);
        const settings = getOvertimeSettings();
        const cleaningFee = options.cleaning ? settings.cleaningFee : 0;
        const refuelingFee = Math.max(0, Number(options.refuelingFee) || 0);
        if (!v || !actualReturn)
            return { hours: 0, fee: 0, baseFee: 0, tierLabel: 'On time', cleaningFee, refuelingFee, total: 0, fullDayApplied: false, settings };
        const ms = new Date(actualReturn) - new Date(scheduledEnd);
        if (!Number.isFinite(ms) || ms <= 0)
            return { hours: 0, fee: 0, baseFee: 0, tierLabel: 'On time', cleaningFee, refuelingFee, total: cleaningFee + refuelingFee, fullDayApplied: false, settings };
        const hours = Math.ceil(ms / 3600000);
        let baseFee = 0;
        let tierLabel = '';
        let fullDayApplied = false;
        if (hours > settings.fullDayAfterHours) {
            baseFee = Number(v.ratePerDay) || 0;
            tierLabel = `More than ${settings.fullDayAfterHours} hours late (full-day rate)`;
            fullDayApplied = true;
        } else if (hours === 1) {
            baseFee = settings.tiers[1];
            tierLabel = '1 hour late (contract tier)';
        } else if (hours === 2) {
            baseFee = settings.tiers[2];
            tierLabel = '2 hours late (contract tier)';
        } else if (hours === 3) {
            baseFee = settings.tiers[3];
            tierLabel = '3 hours late (contract tier)';
        } else {
            baseFee = settings.tiers[3] + ((hours - 3) * settings.perHourAfterThird);
            tierLabel = `${hours} hours late (P1,000 + P${settings.perHourAfterThird}/hr after 3rd hour)`;
        }
        const fee = baseFee + cleaningFee + refuelingFee;
        return { hours, fee, baseFee, tierLabel, cleaningFee, refuelingFee, total: fee, fullDayApplied, settings };
    }
    function notify(role, title, body, link, customerId = null) {
        state.notifications.unshift({ id: uid('n'), role, customerId, title, body, isRead: false, createdAt: new Date().toISOString(), link: link || (role === 'admin' ? '#/admin/dashboard' : '#/customer/notifications') });
    }
    function toast(msg, type = 'info') {
        captureActivity();
        const c = $('#toastContainer');
        if (!c)
            return;
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = msg;
        c.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 180);
        }, 2800);
    }
    function statusBadge(status) {
        const labels = { pending: 'Pending', approved: 'Approved', ongoing: 'Ongoing', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected', available: 'Available', rented: 'Rented', maintenance: 'Maintenance', malfunction: 'Malfunction', verified: 'Verified', open: 'Open', resolved: 'Resolved' };
        const s = status || 'neutral';
        return `<span class="status status-${esc(s)}">${esc(labels[s] || s)}</span>`;
    }
    function timelineHTML(status) {
        const flow = ['pending', 'approved', 'ongoing', 'completed'];
        const terminalBad = status === 'cancelled' || status === 'rejected';
        const idx = flow.indexOf(status);
        let html = '<div class="timeline">';
        flow.forEach((s, i) => {
            let cls = '';
            if (!terminalBad) {
                if (idx > i)
                    cls = 'done';
                else if (idx === i)
                    cls = 'active';
            }
            else if (s === 'pending')
                cls = 'done';
            html += `<span class="timeline-step ${cls}"><span class="timeline-dot"></span>${s}</span>`;
            if (i < flow.length - 1)
                html += '<span class="timeline-line"></span>';
        });
        if (terminalBad)
            html += `<span class="timeline-line"></span><span class="timeline-step bad"><span class="timeline-dot"></span>${esc(status)}</span>`;
        html += '</div>';
        return html;
    }
    function vehicleMark(v, lg) {
        if (!v)
            return '';
        const cls = lg ? 'vehicle-mark lg' : 'vehicle-mark';
        return `<div class="${cls}" aria-label="${esc(displacementLabel(v.displacement))}"><span class="vm-type">${esc(displacementLabel(v.displacement))}</span><span class="vm-plate">${esc(v.plateNumber || '')}</span></div>`;
    }
    // ---------- Router ----------
    function parseHash() {
        const h = location.hash.replace(/^#/, '') || '/';
        return h.split('/').filter(Boolean);
    }
    function navigate(hash) {
        location.hash = hash;
    }
    function goHome(e) {
        if (e)
            e.preventDefault();
        navigate(state.role === 'admin' ? '#/admin/dashboard' : (state.role === 'customer' ? '#/customer/vehicles' : '#/'));
    }
    function route() {
        captureActivity();
        const parts = parseHash();
        state.ui.notifOpen = false;
        renderChrome();
        if (!state.role) {
            renderLanding();
            return;
        }
        const [area, page, param, sub] = parts;
        if (area !== state.role) {
            navigate(state.role === 'admin' ? '#/admin/dashboard' : '#/customer/vehicles');
            return;
        }
        if (state.role === 'customer')
            routeCustomer(page, param, sub);
        else
            routeAdmin(page, param, sub);
    }
    function routeCustomer(page, param, sub) {
        switch (page) {
            case 'vehicles':
                renderCustomerVehicles();
                break;
            case 'vehicle':
                renderCustomerVehicleDetail(param);
                break;
            case 'reservations':
                renderCustomerReservations();
                break;
            case 'reservation':
                sub === 'pay' ? renderCustomerPayment(param) : renderCustomerReservationDetail(param);
                break;
            case 'notifications':
                renderCustomerNotifications();
                break;
            case 'history':
                renderCustomerHistory();
                break;
            default: renderCustomerVehicles();
        }
    }
    function routeAdmin(page, param, sub) {
        if (state.role !== 'admin') { navigate('#/'); return; }
        switch (page) {
            case 'dashboard':
                renderAdminDashboard();
                break;
            case 'map':
                if (state.role === 'admin') logActivity({module:'Tracking',action:'Viewed',entityId:'map',description:'Admin opened Live Map',link:'#/admin/map',changes:[]});
                if (App.Tracking?.renderMapPage) App.Tracking.renderMapPage(false); else mount('<div class="empty"><div class="empty-title">Map module unavailable</div></div>');
                break;
            case 'vehicles':
                renderAdminVehicles();
                break;
            case 'reservations':
                renderAdminReservations();
                break;
            case 'reservation':
                renderAdminReservationDetail(param);
                break;
            case 'payments':
                renderAdminPayments();
                break;
            case 'maintenance':
                renderAdminMaintenance();
                break;
            case 'schedule':
                renderAdminSchedule();
                break;
            case 'reports':
                renderAdminReports();
                break;
            case 'activity':
                renderActivityLog();
                break;
            case 'customers':
                renderAdminCustomers();
                break;
            default: renderAdminDashboard();
        }
    }
    // ---------- Chrome ----------
    function navItems() {
      if (state.role === 'admin') {
          return [
              { href: '#/admin/dashboard', label: 'Dashboard' },
              { href: '#/admin/map', label: 'Live Map' },
              { href: '#/admin/vehicles', label: 'Vehicles' },
              { href: '#/admin/reservations', label: 'Reservations' },
              { href: '#/admin/schedule', label: 'Fleet Schedule' },
              { href: '#/admin/payments', label: 'Payments & Refunds' },
              { href: '#/admin/maintenance', label: 'Maintenance' },
              { href: '#/admin/reports', label: 'Reports' },
              { href: '#/admin/customers', label: 'Customers' },
              { href: '#/admin/activity', label: 'Activity Log' }
          ];
      }

      return [
          { href: '#/customer/vehicles', label: 'Vehicles' },
          { href: '#/customer/reservations', label: 'Reservations' }
      ];
  }
    function renderChrome() {
        const topbar = $('#topbar'), sidebar = $('#sidebar'), bottomNav = $('#bottomNav');
        if (!state.role) {
            topbar.classList.add('hidden');
            sidebar.classList.add('hidden');
            bottomNav.classList.add('hidden');
            return;
        }
        topbar.classList.remove('hidden');
        sidebar.classList.remove('hidden');
        bottomNav.classList.remove('hidden');
        $('#roleBtnCustomer').classList.toggle('active', state.role === 'customer');
        $('#roleBtnAdmin').classList.toggle('active', state.role === 'admin');
        const accountBtn = document.getElementById('accountBtn');

        if (accountBtn) {
            accountBtn.classList.toggle(
                'hidden',
                state.role !== 'customer'
            );

            accountBtn.classList.toggle(
                'active',
                location.hash === '#/customer/history'
            );
        }
        if (state.role === 'admin' && App.Tracking?.preloadLeaflet) { try { App.Tracking.preloadLeaflet(); } catch (_) {} }
        const items = navItems();
        const hash = location.hash || '#/';
        $('#sidebarNav').innerHTML = items.map(it => `<a href="${it.href}" class="nav-link ${hash.startsWith(it.href) ? 'active' : ''}"><span class="nav-dot"></span><span>${esc(it.label)}</span></a>`).join('');
        $('#bottomNavInner').innerHTML = items.map(it => `<a href="${it.href}" class="${hash.startsWith(it.href) ? 'active' : ''}"><span class="bn-dot"></span><span>${esc(it.label)}</span></a>`).join('');
        const roleNotifs = state.notifications.filter(n => n.role === state.role && (!n.customerId || n.customerId === currentCustomer()?.id)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const unread = roleNotifs.filter(n => !n.isRead).length;
        const badge = $('#notifBadge');
        if (unread > 0) {
            badge.textContent = unread;
            badge.classList.remove('hidden');
        }
        else
            badge.classList.add('hidden');
        $('#notifViewAll').href = state.role === 'admin' ? '#/admin/reservations' : '#/customer/notifications';
        $('#notifList').innerHTML = roleNotifs.length ? roleNotifs.slice(0, 6).map(n => `
      <a href="${esc(n.link)}" class="notif-item ${n.isRead ? '' : 'unread'}" onclick="App.markNotifRead('${n.id}'); App.closeNotifications()">
        <div class="notif-item-title">${esc(n.title)}</div>
        <div class="notif-item-body">${esc(n.body)}</div>
        <div class="notif-item-time">${fmtDate(n.createdAt, { time: true })}</div>
      </a>`).join('') : `<div class="notif-item"><div class="notif-item-body">No notifications.</div></div>`;
        $('#notifDropdown').classList.toggle('hidden', !state.ui.notifOpen);
    }
    function mount(html) {
        const root = $('#appRoot');
        if (root)
            root.innerHTML = html;
        window.scrollTo({ top: 0 });
    }
    // ---------- Modals ----------
    function openModal(html) {
        $('#modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)App.closeModal()">${html}</div>`;
    }
    function closeModal() {
        $('#actualReturn')?._flatpickr?.destroy();
        $('#modalRoot').innerHTML = '';
    }
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
    
    function switchVehicleSlide(direction, targetIndex) {
        const track = $('#vehicleTrack');
        if (!track || state.role !== 'customer' || track.dataset.sliding === 'true') return;
        const total = Number(track.dataset.total);
        const current = Number(state.ui.vehicleSlide || 0);
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= total || targetIndex === current) return;

        // Cloned end panels make wrapping feel like an ordinary one-step slide.
        const wrappingNext = direction === 'next' && current === total - 1 && targetIndex === 0;
        const wrappingPrev = direction === 'prev' && current === 0 && targetIndex === total - 1;
        const realPosition = targetIndex + 1;
        const position = wrappingNext ? total + 1 : wrappingPrev ? 0 : realPosition;
        const wrapper = track.closest('.showcase-wrapper');
        track.dataset.sliding = 'true';
        state.ui.vehicleSlide = targetIndex;
        track.dataset.activeIndex = String(targetIndex);
        wrapper.querySelectorAll('.slide-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === targetIndex);
            dot.setAttribute('aria-current', String(i === targetIndex));
        });
        track.querySelectorAll('.showcase-slide').forEach(slide => {
            const active = slide.dataset.realIndex === String(targetIndex);
            slide.inert = !active;
            slide.setAttribute('aria-hidden', String(!active));
        });
        const status = wrapper.querySelector('.carousel-announcement');
        if (status) status.textContent = `Motorcycle ${targetIndex + 1} of ${total}`;

        const start = `translate3d(${-100 * (current + 1)}%, 0, 0)`;
        const end = `translate3d(${-100 * position}%, 0, 0)`;
        const final = `translate3d(${-100 * realPosition}%, 0, 0)`;
        track.style.transform = start;
        function finish() {
            track.style.transform = final;
            delete track.dataset.sliding;
        }
        const animation = track.animate([
            { transform: start }, { transform: end }
        ], { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
        animation.onfinish = () => {
            finish();
            animation.cancel();
        };
        animation.oncancel = finish;
    }

    function vehicleAvailabilityLabel(v) {
        if (!v) return { label: 'Unknown', tone: 'muted', bookable: false };
        if (v.status === 'available') return { label: 'Available', tone: 'success', bookable: true };
        if (v.status === 'rented') return { label: 'Rented', tone: 'warning', bookable: false };
        if (v.status === 'maintenance' || v.status === 'malfunction') return { label: 'Maintenance', tone: 'danger', bookable: false };
        return { label: String(v.status || 'Unknown'), tone: 'muted', bookable: false };
    }

    function renderCustomerVehicles() {
        const query = (state.ui.q || '').toLowerCase();
        const displacement = state.ui.displacementFilter || 'all';
        const chips = [['all','All'],['400','400cc'],['600','600cc'],['1000','1000cc']];
        const vehicles = state.vehicles.filter(vehicle => {
            const search = [vehicle.name, vehicle.brand, vehicle.model, vehicle.plateNumber].join(' ').toLowerCase();
            return search.includes(query) && (displacement === 'all' || String(vehicle.displacement) === displacement);
        });
        mount(`
        <div class="page-header">
          <div>
            <h1 class="page-title">Choose a motorcycle</h1>
            <p class="page-desc">Step 1: Select an available model. Non-available vehicles are visible but cannot be booked.</p>
          </div>
        </div>
        <div class="toolbar" style="gap:10px;flex-wrap:wrap;">
          <input id="vehicleSearch" class="input grow" placeholder="Search motorcycles..." value="${esc(state.ui.q || '')}" oninput="App.searchVehicles(this)">
          <div class="cc-chips" role="group" aria-label="Engine displacement filter">
            ${chips.map(([k,l]) => `<button type="button" class="cc-chip ${displacement===k?'active':''}" onclick="App.setUI('displacementFilter','${k}'); App.render()">${l}</button>`).join('')}
          </div>
        </div>
        ${vehicles.length ? `<div class="vehicle-grid" data-ai-target="vehicle-list">
          ${vehicles.map(v => {
            const a = vehicleAvailabilityLabel(v);
            const bookable = a.bookable;
            return `<div class="vehicle-card ${bookable ? '' : 'is-unavailable'}">
              <div class="vehicle-card-media">${vehicleImage(v)}<span class="availability-pill tone-${a.tone}">${a.label}</span></div>
              <div class="vehicle-card-body">
                <div class="vehicle-card-top"><div><div class="vehicle-card-name">${esc(v.brand)} ${esc(v.name)}</div><div class="muted small">${esc(v.year)} • ${esc(v.displacement)}cc • ${esc(v.transmission)}</div></div><div class="vehicle-card-rate">${fmtPHP(v.ratePerDay)}<span>/day</span></div></div>
                <div class="vehicle-card-meta"><span>Plate: <span class="mono">${esc(v.plateNumber)}</span></span><span>${esc(v.color)}</span></div>
                <div class="mt-2">
                  ${bookable
                    ? `<a class="btn btn-primary btn-block" href="#/customer/vehicle/${v.id}" data-ai-target="book-vehicle-${esc(v.id)}">View details & reserve</a>`
                    : `<button class="btn btn-block" disabled aria-disabled="true">Not available for booking</button>`}
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>` : `<div class="empty"><div class="empty-title">No vehicles found</div><div>Try a different search or displacement filter.</div></div>`}
        `);
        const s = $('#vehicleSearch');
        if (s && s.value) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }

    function isVehicleBookable(v) { return !!v && !['maintenance', 'malfunction', 'rented'].includes(v.status); }
    function getBlockedRanges(vehicleId, excludeId) {
        return reservationsForVehicle(vehicleId)
            .filter(r => (r.status === 'approved' || r.status === 'ongoing') && r.id !== excludeId)
            .map(r => ({ from: new Date(r.start), to: new Date(r.end), start: r.start, end: r.end }));
    }
    function rangeCrossesBlocked(start, end, blockedRanges) {
        const s = new Date(start), e = new Date(end);
        if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime()) || e <= s) return false;
        return (blockedRanges || []).some(b => overlaps(s, e, b.from, b.to));
    }
    function buildFlatpickrDisable(vehicleId, excludeId) {
        const blocked = getBlockedRanges(vehicleId, excludeId);
        const disable = blocked.map(b => ({ from: b.from, to: b.to }));
        const v = getVehicle(vehicleId);
        if (v && ['maintenance', 'malfunction'].includes(v.status)) disable.push(() => true);
        return { disable, blockedRanges: blocked };
    }
    function manilaDateTimeToISO(dateStr, timeStr) {
        if (!dateStr || !timeStr) return null;
        const iso = new Date(`${dateStr}T${timeStr}:00+08:00`);
        return Number.isFinite(iso.getTime()) ? iso.toISOString() : null;
    }
    function bookingHasLicense(cust) {
        const d = cust?.identification || {};
        return !!(d.licenseNumber && d.licenseFront && d.licenseBack && (d.licenseExpiry || '') >= todayKey());
    }

    function getLicenseStatus(customer, reservation) {
        const d = customer?.identification || {};
        const hasLicense = !!(d.licenseNumber || d.licenseFront || d.licenseBack || d.licenseExpiry);
        if (!hasLicense || !d.licenseNumber) return { status: 'Missing', tone: 'danger', detail: 'No license on file' };
        const expiry = String(d.licenseExpiry || '').slice(0, 10);
        if (!expiry) return { status: 'Missing', tone: 'danger', detail: 'License expiry missing' };
        const today = todayKey();
        const resEnd = reservation?.end ? toManilaDateKey(reservation.end) : null;
        if (expiry < today) return { status: 'Expired', tone: 'danger', detail: `Expired ${expiry}` };
        if (resEnd && expiry < resEnd) return { status: 'Expires before return', tone: 'warning', detail: `Expires ${expiry}, return ${resEnd}` };
        return { status: 'Valid', tone: 'success', detail: resEnd ? `Valid through return (${expiry})` : `Valid until ${expiry}` };
    }

    function adminReservationDocumentsCard(r, c) {
        const d = c?.identification || {};
        const idStatus = identityStatus(c || {});
        const verified = idStatus === 'verified';
        const lic = getLicenseStatus(c, r);
        const restriction = /A1/i.test(String(d.licenseNumber || '') + ' ' + String(d.idType || '')) ? 'A / A1' : (d.licenseNumber ? 'A / A1' : '-');
        // Reuse existing fields: we do not have a separate restriction field; show A / A1 from seeded/demo data context if present in license text, else default A/A1 when license exists.
        const restrictionDisplay = d.restrictionCode || ((/a1/i.test(String(d.licenseNumber||'')) || /a1/i.test(String(d.idType||''))) ? 'A1' : (d.licenseNumber ? 'A' : '-'));
        return reservationPanel('Customer documents', `
            <div class="kv">
                <div class="k">Customer</div><div class="v">${esc(r.customerName || c?.name || '-')}</div>
                <div class="k">Identity status</div><div class="v"><span class="status status-${verified ? 'verified' : 'pending'}">${verified ? 'Verified' : 'Not verified'}</span></div>
                <div class="k">LTO license number</div><div class="v mono">${esc(d.licenseNumber || '-')}</div>
                <div class="k">Restriction Code</div><div class="v">${esc(restrictionDisplay || '-')}</div>
                <div class="k">License expiry</div><div class="v">${esc(d.licenseExpiry || '-')}</div>
                <div class="k">License status</div><div class="v"><span class="status status-${lic.tone === 'success' ? 'verified' : lic.tone === 'warning' ? 'pending' : 'rejected'}">${esc(lic.status)}</span> <span class="small muted">${esc(lic.detail)}</span></div>
            </div>
            <p class="small muted mt-2">Read-only information for approval review. Approval rules remain unchanged.</p>
        `);
    }
    function licenseUploadTarget() { return '#/customer/history'; }

    function parseBudgetAmount(input) {
        if (input == null) return null;
        if (typeof input === 'number' && Number.isFinite(input)) return input;
        let s = String(input).toLowerCase().trim();
        s = s.replace(/[₱,\s]/g, '');
        const k = s.match(/^(\d+(?:\.\d+)?)k$/);
        if (k) return Number(k[1]) * 1000;
        const m = s.match(/(\d+(?:\.\d+)?)/);
        if (!m) return null;
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : null;
    }

    function recommendByBudget(budget, start, end) {
        const b = parseBudgetAmount(budget);
        const deposit = getDepositAmount();
        if (!Number.isFinite(b) || b <= 0) return { ok: false, reason: 'invalid_budget', deposit, budget: b, items: [] };
        const startISO = start ? new Date(start).toISOString() : null;
        const endISO = end ? new Date(end).toISOString() : null;
        if (!startISO || !endISO || !Number.isFinite(new Date(startISO).getTime()) || !Number.isFinite(new Date(endISO).getTime()) || new Date(endISO) <= new Date(startISO)) {
            return { ok: false, reason: 'missing_dates', deposit, budget: b, items: [] };
        }
        const items = [];
        for (const v of (state.vehicles || [])) {
            if (!isVehicleBookable(v)) continue;
            const conflict = hasConflict(v.id, startISO, endISO);
            if (conflict.conflict) continue;
            const fee = computeFee(v.id, startISO, endISO);
            if (!fee || !fee.days) continue;
            const total = fee.total + deposit;
            if (total <= b) items.push({
                vehicleId: v.id, name: v.name, brand: v.brand, displacement: v.displacement,
                ratePerDay: v.ratePerDay, days: fee.days, rentalFee: fee.total, deposit, total,
                startISO, endISO
            });
        }
        items.sort((a, b) => a.total - b.total || a.ratePerDay - b.ratePerDay || a.name.localeCompare(b.name));
        return { ok: true, deposit, budget: b, startISO, endISO, items: items.slice(0, 5) };
    }

    function initBookingForm(v, opts = {}) {
        const input = document.getElementById('dateRange');
        if (!input || !window.flatpickr) return;
        const { disable, blockedRanges } = buildFlatpickrDisable(v.id);
        const prefill = opts.prefill;
        const syncSelectedRange = (inst, selectedDates) => {
            const msg = document.getElementById('conflictMsg');
            if (msg) msg.innerHTML = '';
            if (!selectedDates || selectedDates.length === 0) {
                document.getElementById('start').value = '';
                document.getElementById('end').value = '';
                updateFeePreview(v.id);
                return;
            }
            let s = selectedDates[0];
            let e = selectedDates.length === 2 ? selectedDates[1] : selectedDates[0];
            if (e < s) [s, e] = [e, s];
            const startDate = inst.formatDate(s, 'Y-m-d');
            const endDate = inst.formatDate(e, 'Y-m-d');
            const pickup = document.getElementById('pickupTime')?.value || '09:00';
            const ret = document.getElementById('returnTime')?.value || '09:00';
            const startISO = manilaDateTimeToISO(startDate, pickup);
            const endISO = manilaDateTimeToISO(endDate, ret);
            if (!startISO || !endISO) {
                document.getElementById('start').value = '';
                document.getElementById('end').value = '';
                updateFeePreview(v.id);
                return;
            }
            if (rangeCrossesBlocked(startISO, endISO, blockedRanges)) {
                inst.clear();
                document.getElementById('start').value = '';
                document.getElementById('end').value = '';
                toast('Selected range crosses a blocked date. Please choose different dates.', 'error');
                updateFeePreview(v.id);
                return;
            }
            if (startDate === endDate && ret <= pickup) {
                document.getElementById('start').value = startISO;
                document.getElementById('end').value = endISO;
                updateFeePreview(v.id);
                return;
            }
            document.getElementById('start').value = startISO;
            document.getElementById('end').value = endISO;
            updateFeePreview(v.id);
        };
        const fp = window.flatpickr(input, {
            mode: 'range',
            dateFormat: 'Y-m-d',
            minDate: 'today',
            disable,
            showMonths: window.innerWidth < 768 ? 1 : 2,
            onChange: (selectedDates, _dateStr, inst) => syncSelectedRange(inst, selectedDates),
            onClose: (selectedDates, _dateStr, inst) => {
                if (selectedDates.length === 1) syncSelectedRange(inst, selectedDates);
            }
        });
        const syncTimes = () => {
            const sel = fp.selectedDates || [];
            if (sel.length >= 1) syncSelectedRange(fp, sel);
            else updateFeePreview(v.id);
        };
        ['pickupTime','returnTime'].forEach(id => { const el = document.getElementById(id); if (el) { el.addEventListener('change', syncTimes); el.addEventListener('input', syncTimes); } });
        state.ui.bookingPicker = fp;
        if (prefill?.start && prefill?.end) {
            try {
                const s = new Date(prefill.start), e = new Date(prefill.end);
                if (Number.isFinite(s.getTime()) && Number.isFinite(e.getTime())) {
                    const pStart = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(s);
                    const pEnd = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(e);
                    const gs=k=>pStart.find(x=>x.type===k)?.value||'09'; const ge=k=>pEnd.find(x=>x.type===k)?.value||'09';
                    const pickup = document.getElementById('pickupTime'); const ret = document.getElementById('returnTime');
                    if (pickup) pickup.value = `${gs('hour')}:${gs('minute')}`;
                    if (ret) ret.value = `${ge('hour')}:${ge('minute')}`;
                    fp.setDate([s, e], true);
                }
            } catch (_) {}
            state.ui.bookingPrefill = null;
        }
        updateFeePreview(v.id);
    }

    function openOvertimeRulesModal() {
        const s = getOvertimeSettings();
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Overtime rules</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
          <div class="modal-body"><div class="kv">
            <div class="k">1 hour late</div><div class="v">${fmtPHP(s.tiers[1])}</div>
            <div class="k">2 hours late</div><div class="v">${fmtPHP(s.tiers[2])}</div>
            <div class="k">3 hours late</div><div class="v">${fmtPHP(s.tiers[3])}</div>
            <div class="k">4+ hours late</div><div class="v">${fmtPHP(s.tiers[3])} + ${fmtPHP(s.perHourAfterThird)}/hour after 3rd</div>
            <div class="k">More than ${s.fullDayAfterHours} hours</div><div class="v">1 full-day rate (vehicle rate/day)</div>
            <div class="k">Cleaning fee (add-on)</div><div class="v">${fmtPHP(s.cleaningFee)}</div>
            <div class="k">Refueling fee (add-on)</div><div class="v">Admin-entered amount</div>
          </div><p class="small muted mt-2">Hours are rounded up to the next whole hour.</p></div></div>`);
    }

    function renderCustomerVehicleDetail(id) {
        const v = getVehicle(id);
        if (!v)
            return mount(`<div class="empty"><div class="empty-title">Vehicle not found</div><div><a href="#/customer/vehicles">Return to vehicles</a></div></div>`);
        const blockedVehicle = ['maintenance', 'malfunction'].includes(v.status);
        const unavailable = !isVehicleBookable(v);
        const cust = currentCustomer();
        const hasLicense = bookingHasLicense(cust);
        const deposit = getDepositAmount();
        const bookedRanges = getBlockedRanges(id);
        const prefill = state.ui.bookingPrefill && state.ui.bookingPrefill.vehicleId === id ? state.ui.bookingPrefill : null;
        mount(`
      <div style="margin-bottom:12px;"><a href="#/customer/vehicles" class="btn btn-ghost btn-sm" data-ai-target="browse-vehicles-link">&larr; Back to vehicles</a></div>
      <div class="page-header">
        <div><h1 class="page-title">${esc(v.name)}</h1><p class="page-desc">${esc(v.brand)} ${esc(v.model)} � ${v.year} � ${esc(v.color)}</p></div>
        <div>${statusBadge(v.status)}</div>
      </div>
      <div class="grid-3">
        <div class="stack">
          <div class="panel"><div class="panel-body">${vehicleMark(v, true)}
            <div class="kv mt-3">
              <div class="k">Plate number</div><div class="v mono">${esc(v.plateNumber)}</div>
              <div class="k">Displacement</div><div class="v" style="text-transform:capitalize">${esc(displacementLabel(v.displacement))}</div>
              <div class="k">Seats</div><div class="v">${v.seats}</div>
              <div class="k">Transmission</div><div class="v">${esc(v.transmission)}</div>
              <div class="k">Daily rate</div><div class="v">${fmtPHP(v.ratePerDay)}</div>
              <div class="k">Hourly rate</div><div class="v">${fmtPHP(v.ratePerHour)}</div>
            </div>
          </div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Booking rule: overlap prevention</div></div><div class="panel-body">
            <p class="small muted mb-2">A request is blocked when its date range overlaps an approved or ongoing rental for the same vehicle, or the vehicle is under maintenance/malfunction.</p>
            <div class="callout small"><span class="mono">newStart &lt; existingEnd &amp;&amp; newEnd &gt; existingStart</span></div>
            <div class="small muted mt-2">${bookedRanges.length ? `<strong>Blocked periods:</strong> ${bookedRanges.map(r => `${fmtDateShort(r.start)}-${fmtDateShort(r.end)}`).join('; ')}` : 'No approved/ongoing bookings blocking this vehicle right now.'}</div>
          </div></div>
        </div>
        <div style="grid-column: span 2;">
          <div class="panel"><div class="panel-header"><div class="panel-title">Book this vehicle</div></div><div class="panel-body">
            ${blockedVehicle ? `<div class="callout danger">This vehicle is currently <strong>${esc(v.status)}</strong> and cannot accept reservation requests.</div>` : unavailable ? `<div class="callout warning">This vehicle is currently <strong>${esc(v.status)}</strong>. Please choose another available vehicle.</div>` : `
            <form id="reqForm" data-ai-target="booking-form" onsubmit="App.submitReservation(event,'${v.id}')" class="stack booking-flow">
              <div class="booking-step"><div class="step-head"><span class="step-num">1</span><div><div class="step-title">Choose model</div><div class="small muted">Selected: ${esc(v.brand)} ${esc(v.name)} (${esc(v.displacement)}cc)</div></div></div></div>

              <div class="booking-step"><div class="step-head"><span class="step-num">2</span><div><div class="step-title">Dates + delivery/pickup</div><div class="small muted">Pick a start and end date. Blocked/conflicting dates are disabled.</div></div></div>
                <div class="field"><label class="field-label" for="dateRange">Rental dates</label><input id="dateRange" class="input" type="text" placeholder="Select start date then end date" readonly required><div class="field-hint">One calendar range only. If a range crosses a blocked date, it will be cleared.</div></div>
                <div class="grid-2">
                  <div class="field"><label class="field-label" for="pickupTime">Pickup time</label><input id="pickupTime" class="input" type="time" value="09:00" required onchange="App.updateFeePreview('${v.id}')"></div>
                  <div class="field"><label class="field-label" for="returnTime">Return time</label><input id="returnTime" class="input" type="time" value="09:00" required onchange="App.updateFeePreview('${v.id}')"></div>
                </div>
                <input type="hidden" id="start" name="start"><input type="hidden" id="end" name="end">
                <div id="rangeSummary" class="callout small muted">Select a date range to see duration.</div>
                <div class="field"><label class="field-label" for="deliveryMethod">Delivery method</label>
                  <select id="deliveryMethod" name="deliveryMethod" class="select" required>
                    <option value="">Select pickup and return option</option>
                    ${DELIVERY_METHODS.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
                  </select>
                  <div class="field-hint">Required. Choose how the vehicle will be picked up and returned.</div>
                </div>
              </div>

              <div class="booking-step"><div class="step-head"><span class="step-num">3</span><div><div class="step-title">Live estimated price</div><div class="small muted">Updates when dates change. Fees use existing compute logic.</div></div></div>
                <div id="feePreview" class="callout info small">Select start and end dates to calculate the estimated fee.</div>
                <div id="conflictMsg"></div>
                <button type="button" class="link-btn small" onclick="App.openOvertimeRulesModal()">View overtime rules</button>
              </div>

              <div class="booking-step"><div class="step-head"><span class="step-num">4</span><div><div class="step-title">License check</div><div class="small muted">LTO license (Restriction Code A/A1) required before submit.</div></div></div>
                ${hasLicense ? `<div class="callout success small">License on file. You can proceed to review and confirm.</div>` : `<div class="callout danger small"><strong>License required.</strong> Upload your LTO license (Restriction Code A/A1) in your profile before submitting. <a href="${licenseUploadTarget()}" data-ai-target="upload-license-link">Upload license in Account</a></div>`}
              </div>

              <div class="booking-step"><div class="step-head"><span class="step-num">5</span><div><div class="step-title">Review and confirm</div><div class="small muted">No payment is collected at this stage.</div></div></div>
                <div id="reviewSummary" class="callout small muted">Complete the steps above to review your booking.</div>
                <label class="field" style="display:flex;gap:10px;align-items:flex-start"><input id="trackingConsent" name="trackingConsent" type="checkbox" required style="margin-top:3px"><span class="small muted">I agree the vehicle may be tracked by GPS during my rental period.</span></label>
                <button class="btn btn-primary btn-block" type="submit" data-ai-target="booking-submit" ${hasLicense ? '' : 'disabled'}>Submit reservation request</button>
                <p class="small muted">Requests are submitted as <strong>Pending</strong> until reviewed by the administrator. No payment prompt at this stage.</p>
              </div>
            </form>`}
          </div></div>
        </div>
      </div>
    `);
        if (!blockedVehicle && !unavailable) initBookingForm(v, { prefill });
    }

    // ---------- Customer: Reservations ----------
    function renderCustomerReservations() {
        const tab = state.ui.resTab || 'all';
        const mine = state.reservations.filter(r => ownsReservation(r)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const list = tab === 'all' ? mine : mine.filter(r => r.status === tab);
        const tabs = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
        mount(`
      <div class="page-header"><div><h1 class="page-title">My reservations</h1><p class="page-desc">Track request status, upload payment proof, and review rental details.</p></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" onclick="App.setUI('resTab','${k}'); App.render()">${l}</button>`).join('')}</div>
      ${list.length ? `<div class="stack">${list.map(r => {
            const v = getVehicle(r.vehicleId);
            const p = getPaymentByReservation(r.id);
            const banner = getNextStepBanner(r, state.payments);
            return `<div class="list-row">
          <div class="list-row-main">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">${vehicleMark(v)}<div><div class="list-row-title"><a href="#/customer/reservation/${r.id}">${esc(v ? v.name : r.vehicleId)}</a></div><div class="list-row-meta">${fmtDateShort(r.start)} to ${fmtDateShort(r.end)} � ${fmtPHP(r.totalFee + (r.overtimeFee || 0))}${r.overtimeFee ? ' (incl. overtime)' : ''}</div><div class="list-row-meta">Delivery: ${esc(getDeliveryMethod(r))}</div></div></div>
            <div class="next-step-chip tone-${esc(banner.tone)}">${esc(banner.title)}</div>
            ${p && r.status === 'approved' ? `<div class="small muted mt-2">Payment: ${statusBadge(p.status)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            ${statusBadge(r.status)}
            <div class="list-row-actions">
              <a href="#/customer/reservation/${r.id}" class="btn btn-sm">Details</a>
              ${r.status === 'pending' ? `<button class="btn btn-sm btn-danger" onclick="App.confirmCancelReservation('${r.id}')">Cancel</button>` : ''}
              ${r.status === 'approved' && (!p || p.status === 'rejected') ? `<a href="#/customer/reservation/${r.id}/pay" class="btn btn-sm btn-primary">Upload payment</a>` : ''}
            </div>
          </div>
        </div>`;
        }).join('')}</div>` : `<div class="empty"><div class="empty-title">No reservations</div><div>Reservations in this status will appear here.</div></div>`}
    `);
    }

    // ---------- Shared reservation components ----------
    function getNextStepBanner(r, payments = state.payments || []) {
        if (!r) return { tone:'info', title:'Reservation not found', message:'', action:null };
        const p = (payments || []).filter(x => x && x.reservationId === r.id).sort((a,b)=>new Date(b.submittedAt||0)-new Date(a.submittedAt||0))[0] || null;
        if (r.status === 'pending') return { tone:'warning', title:'Waiting for admin approval', message:'Your request was submitted. Please wait for admin approval. You will be notified.', action:null, payment:p };
        if (r.status === 'approved') {
            if (!p || p.status === 'rejected') return { tone:'primary', title:'Approved! Pay now', message:p?.status==='rejected' ? 'Your previous proof was rejected. Please upload a new payment proof.' : 'Your reservation is approved. Upload payment proof to continue.', action:{href:`#/customer/reservation/${r.id}/pay`,label:'Pay now'}, payment:p };
            if (p.status === 'pending') return { tone:'info', title:'Payment submitted. Waiting for verification', message:'Your payment proof was submitted and is awaiting admin verification.', action:null, payment:p };
            if (p.status === 'verified') return { tone:'success', title:'Ready for pickup / delivery', message:'Payment verified. Your rental is ready for pickup or delivery as scheduled.', action:null, payment:p };
        }
        if (r.status === 'ongoing') return { tone:'info', title:'Rental in progress', message:`Return time: ${fmtDate(r.end, { time: true })}.`, action:null, payment:p };
        if (r.status === 'completed') {
            const refund = r.refund?.status ? ` Refund: ${r.refund.status}.` : '';
            return { tone:'success', title:'Completed', message:`This rental is completed.${refund}`, action:null, payment:p };
        }
        if (r.status === 'rejected') return { tone:'danger', title:'Reservation rejected', message:r.rejectReason || 'The admin rejected this reservation.', action:null, payment:p };
        if (r.status === 'cancelled') return { tone:'muted', title:'Reservation cancelled', message:r.cancelReason || 'This reservation was cancelled.', action:null, payment:p };
        return { tone:'info', title:'Reservation update', message:`Status: ${r.status}`, action:null, payment:p };
    }

    function nextStepBannerHTML(r, payments = state.payments || [], compact = false) {
        const b = getNextStepBanner(r, payments);
        const action = b.action ? `<a class="btn btn-sm ${b.tone==='primary'?'btn-primary':''}" href="${esc(b.action.href)}">${esc(b.action.label)}</a>` : '';
        return `<div class="next-step-banner tone-${esc(b.tone)} ${compact?'compact':''}" data-ai-target="next-step-banner"><div><div class="next-step-title">${esc(b.title)}</div>${compact?'':`<div class="next-step-msg">${esc(b.message)}</div>`}</div>${action?`<div class="next-step-action">${action}</div>`:''}</div>`;
    }

    function reservationPanel(title, body) {
        return `
            <div class="panel">
                <div class="panel-header"><div class="panel-title">${esc(title)}</div></div>
                <div class="panel-body">${body}</div>
            </div>`;
    }

    function reservationDetailsCard(r, v) {
        const [pickup = 'Not specified', dropoff = 'Not specified'] = getDeliveryMethod(r).split(' & ');
        const duration = Math.max(0, new Date(r.end) - new Date(r.start));
        const minutes = Math.floor(duration / 60000);
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor(minutes / 60) % 24;
        const remainder = minutes % 60;
        const billableDays = Math.ceil(duration / 86400000);
        const rental = Number(r.totalFee || 0);
        const overtime = Number(r.overtimeFee || 0);
        const deposit = getDepositAmount();
        const totalToPrepare = rental + deposit;

        const schedule = (label, date) => `
            <div class="schedule-card">
                <span class="schedule-label">${label}</span>
                <strong>${fmtDateShort(date)}</strong>
                <span class="muted">${new Date(date).toLocaleTimeString('en-PH', {
                    timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true
                })}</span>
            </div>`;
        const delivery = (label, value) => `
            <div class="delivery-item">
                <span class="muted small">${label}</span>
                <strong>${esc(value)}</strong>
            </div>`;
        const price = (label, amount, sub='') => `
            <div class="reservation-price-row"><span>${label}${sub?` <span class="muted small">${esc(sub)}</span>`:''}</span><strong>${fmtPHP(amount)}</strong></div>`;

        return `
            <div class="reservation-card">
                <div class="reservation-card-header">
                    <h2>Reservation details</h2>${statusBadge(r.status)}
                </div>
                <div class="reservation-vehicle">
                    <div class="reservation-vehicle-image">${v ? vehicleImage(v) : ''}</div>
                    <div class="reservation-vehicle-info">
                        <h2>${esc(v?.name || 'Unknown vehicle')}</h2>
                        <p class="muted">${esc(v?.brand || '')} � ${esc(displacementLabel(v?.displacement))}</p>
                        <span class="reservation-plate">${esc(v?.plateNumber || '-')}</span>
                    </div>
                </div>
                <section class="reservation-section">
                    <h3>Rental schedule</h3>
                    <div class="reservation-schedule">${schedule('Pickup', r.start)}${schedule('Return', r.end)}</div>
                    <div class="reservation-duration">${days} day(s), ${hours} hour(s)${remainder ? `, ${remainder} min` : ''} � ${billableDays} billable day(s)</div>
                </section>
                <section class="reservation-section">
                    <h3>Delivery arrangements</h3>
                    <div class="delivery-options">${delivery('Pickup method', pickup)}${delivery('Return method', dropoff)}</div>
                </section>
                <section class="reservation-section">
                    <h3>Payment breakdown</h3>
                    ${price('Rental fee', rental)}${price('Security deposit', deposit, '(Refundable)')}${price('Overtime fee', overtime)}${r.refund?.amount ? price('Refund', -r.refund.amount) : ''}
                    <div class="reservation-total"><span>Total to prepare</span><strong>${fmtPHP(totalToPrepare + overtime - (r.refund?.amount || 0))}</strong></div>
                    <div class="small muted mt-2">Rental fee + refundable security deposit. Overtime/refunds applied when applicable.</div>
                </section>
                ${r.actualReturn ? `<section class="reservation-section"><h3>Actual return</h3><p>${fmtDate(r.actualReturn, { time: true })}</p></section>` : ''}
                ${r.rejectReason ? `<section class="reservation-section"><div class="callout danger"><strong>Rejection reason</strong><p>${esc(r.rejectReason)}</p></div></section>` : ''}
                ${r.cancelReason ? `<section class="reservation-section"><div class="callout"><strong>Cancellation reason</strong><p>${esc(r.cancelReason)}</p></div></section>` : ''}
                <div class="reservation-footer">Requested on ${fmtDate(r.createdAt, { time: true })}</div>
            </div>`;
    }

    function reservationPaymentPanel(r, p, admin) {
        let body;
        const payLink = `#/customer/reservation/${r.id}/pay`;
        if (p) {
            body = `
                <div class="kv mb-2">
                    <div class="k">Status</div><div class="v">${statusBadge(p.status)}</div>
                    <div class="k">Method</div><div class="v">${esc(p.method)}</div>
                    <div class="k">Amount</div><div class="v">${fmtPHP(p.amount)}</div>
                    <div class="k">Submitted</div><div class="v">${fmtDate(p.submittedAt, { time: true })}</div>
                </div>
                <div class="proof-preview">${p.proofDataUrl ? `<img src="${esc(p.proofDataUrl)}" alt="Payment proof">` : '<span class="muted small">Proof on file</span>'}</div>
                ${p.rejectReason ? `<div class="callout danger small mt-2">${esc(p.rejectReason)}</div>` : ''}
                ${admin && p.status === 'pending' ? `
                    <div class="btn-group mt-3">
                        <button class="btn btn-primary" onclick="App.verifyPayment('${p.id}')">Verify</button>
                        <button class="btn btn-danger" onclick="App.openRejectPaymentModal('${p.id}')">Reject</button>
                    </div>` : ''}
                ${!admin && r.status === 'approved' && p.status === 'rejected' ? `<a class="btn btn-primary btn-block mt-3" href="${payLink}" data-ai-target="upload-payment-proof">Resubmit payment proof</a>` : ''}`;
        } else if (!admin && r.status === 'approved') {
            const due = Number(r.totalFee || 0) + getDepositAmount();
            body = `
                <p class="callout info small mb-3">No payment proof has been submitted.</p>
                <div class="reservation-price-row"><span>Rental fee</span><strong>${fmtPHP(r.totalFee)}</strong></div>
                <div class="reservation-price-row"><span>Security deposit <span class="muted small">(Refundable)</span></span><strong>${fmtPHP(getDepositAmount())}</strong></div>
                <div class="reservation-price-row"><span>Total to prepare</span><strong>${fmtPHP(due)}</strong></div>
                <a class="btn btn-primary btn-block mt-3" href="${payLink}" data-ai-target="upload-payment-proof">Upload payment proof</a>`;
        } else {
            body = `<p class="small muted">${!admin && r.status === 'pending' ? 'Payment proof can be uploaded once the reservation is approved.' : 'No payment proof submitted.'}</p>`;
        }
        return reservationPanel('Payment', body);
    }

    function reservationAdminActions(r) {
        const actions = {
            pending: `<button class="btn btn-primary btn-block" onclick="App.approveReservation('${r.id}')">Approve reservation</button><button class="btn btn-danger btn-block" onclick="App.openRejectReservationModal('${r.id}')">Reject reservation</button>`,
            approved: `<button class="btn btn-primary btn-block" onclick="App.startRental('${r.id}')">Start rental</button>`,
            ongoing: `<button class="btn btn-primary btn-block" onclick="App.openCompleteModal('${r.id}')">Complete rental</button>`
        };
        return reservationPanel('Actions', `<div class="stack">${actions[r.status] || ''}${canAssessRefund(r) ? `<button class="btn btn-block" onclick="App.openAssessRefund('${r.id}')">Assess refund</button>` : !actions[r.status] ? '<p class="small muted">No further actions available.</p>' : ''}</div>`);
    }

    function renderReservationDetail(id, admin = false) {
        const r = getReservation(id);
        const back = admin ? '#/admin/reservations' : '#/customer/reservations';
        if (!r || (admin ? state.role !== 'admin' : !ownsReservation(r))) {
            return mount(`<div class="empty"><div class="empty-title">Reservation not found</div><a href="${back}">Back to reservations</a></div>`);
        }
        const v = getVehicle(r.vehicleId);
        const p = getPaymentByReservation(r.id);
        const customer = admin ? getCustomer(r.customerId) : null;
        const customerPanel = admin ? reservationPanel('Customer information', `
            <div class="stack">
                <div style="display:flex;align-items:center;gap:12px">
                    ${customer ? customerAvatar(customer) : ''}
                    <div><strong>${esc(r.customerName)}</strong><div>${customer ? identityBadge(customer) : ''}</div></div>
                </div>
                <div class="kv">
                    <div class="k">Email</div><div class="v">${esc(r.customerEmail)}</div>
                    <div class="k">Phone</div><div class="v">${esc(customer?.phone || '—')}</div>
                    <div class="k">Customer since</div><div class="v">${fmtDateShort(customer?.joinedAt || r.createdAt)}</div>
                </div>
            </div>`) : '';
        const documentsPanel = (admin && state.role === 'admin') ? adminReservationDocumentsCard(r, customer) : '';
        const notes = admin ? reservationPanel('Internal notes', `
            <form onsubmit="App.saveAdminNotes(event,'${r.id}')">
                <textarea id="adminNotes" class="textarea" rows="3" aria-label="Internal notes" placeholder="Add a note for internal reference">${esc(r.adminNotes || '')}</textarea>
                <div class="form-actions"><button class="btn" type="submit">Save note</button></div>
            </form>`) : '';
        const cancel = !admin && r.status === 'pending' ? reservationPanel('Cancel request', `
            <form onsubmit="App.submitCancelReservation(event,'${r.id}')">
                <div class="field">
                    <label class="field-label" for="cancelReason">Reason (optional)</label>
                    <textarea id="cancelReason" name="reason" class="textarea" rows="3" placeholder="e.g. Schedule changed"></textarea>
                </div>
                <div class="form-actions"><button type="submit" class="btn btn-danger btn-block">Cancel reservation</button></div>
            </form>`) : '';
        mount(`
            <div class="mb-3"><a href="${back}" class="btn btn-ghost btn-sm" data-ai-target="my-reservations-link">&larr; Back to reservations</a></div>
            ${!admin ? nextStepBannerHTML(r, state.payments) : ''}
            <div class="page-header">
                <div><h1 class="page-title">Reservation ${esc(r.id.toUpperCase())}</h1><p class="page-desc">${esc(admin ? r.customerName + ' · ' + (v?.name || 'Vehicle') : v?.name || 'Vehicle')}</p></div>
                ${statusBadge(r.status)}
            </div>
            <div class="reservation-layout">
                <div class="reservation-main">${reservationDetailsCard(r, v)}${customerPanel}${documentsPanel}${notes}</div>
                <div class="reservation-sidebar">
                    ${reservationPaymentPanel(r, p, admin)}
                    ${overtimePanel(r, admin)}
                    ${refundPanel(r, admin)}
                    ${reservationPanel('Reservation status', timelineHTML(r.status))}
                    ${admin ? reservationAdminActions(r) : cancel}
                </div>
            </div>`);
    }

    function renderCustomerReservationDetail(id) {
        renderReservationDetail(id);
    }

    function renderCustomerPayment(id) {
        const r = getReservation(id);
        if (!r || !ownsReservation(r))
            return mount(`<div class="empty"><div class="empty-title">Reservation not found</div></div>`);
        if (r.status !== 'approved' || ['pending', 'verified'].includes(getPaymentByReservation(id)?.status))
            return mount(`<div class="empty"><div class="empty-title">Payment upload unavailable</div><div>Payment proof can only be submitted for approved reservations. <a href="#/customer/reservation/${r.id}">Back to reservation</a></div></div>`);
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
        const list = state.notifications.filter(n => n.role === 'customer' && (!n.customerId || n.customerId === currentCustomer()?.id)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        mount(`
      <div class="page-header"><div><h1 class="page-title">Notifications</h1><p class="page-desc">Updates about your reservations and payments.</p></div><div><button class="btn" onclick="App.markAllRead()">Mark all as read</button></div></div>
      ${list.length ? `<div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Status</th><th>Notification</th><th>Date</th><th></th></tr></thead><tbody>${list.map(n => `
        <tr><td>${n.isRead ? '<span class="small muted">Read</span>' : '<span class="status status-pending">Unread</span>'}</td><td><div class="cell-main">${esc(n.title)}</div><div class="cell-sub">${esc(n.body)}</div></td><td class="small muted nowrap">${fmtDate(n.createdAt, { time: true })}</td><td class="text-right"><a class="btn btn-sm" href="${esc(n.link)}" onclick="App.markNotifRead('${n.id}')">Open</a></td></tr>`).join('')}</tbody></table></div></div>`
            : `<div class="empty"><div class="empty-title">No notifications</div><div>You're up to date.</div></div>`}
    `);
    }
    function renderCustomerHistory() {
        const cust = currentCustomer();
        const allMine = state.reservations.filter(r => ownsReservation(r)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const completed = allMine.filter(r => r.status === 'completed');
        const spent = completed.reduce((s, r) => s + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r), 0);
        mount(`
      <div class="page-header"><div><h1 class="page-title">Account</h1><p class="page-desc">Your profile information and rental history.</p></div></div>
      <div class="grid-3">
        <div class="stack">
          <div class="panel"><div class="panel-header"><div class="panel-title">Profile</div><button class="btn btn-sm" data-ai-target="edit-profile" onclick="App.editCustomerIdentity('${cust.id}')">Edit profile</button></div><div class="panel-body"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">${customerAvatar(cust)}${identityBadge(cust)}</div>
            <div class="kv"><div class="k">Name</div><div class="v">${esc(cust.name)}</div><div class="k">Email</div><div class="v">${esc(cust.email)}</div><div class="k">Phone</div><div class="v">${esc(cust.phone)}</div><div class="k">Joined</div><div class="v">${fmtDateShort(cust.joinedAt)}</div></div>
          </div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Identification documents</div></div><div class="panel-body">${customerDocuments(cust)}${cust.identification?.rejectionReason ? `<div class="callout danger mt-2">${esc(cust.identification.rejectionReason)}</div>` : ''}</div></div><div class="metrics" style="grid-template-columns:1fr 1fr;">
            <div class="metric"><div class="metric-label">Completed rentals</div><div class="metric-value">${completed.length}</div></div>
            <div class="metric"><div class="metric-label">Total spent</div><div class="metric-value sm">${fmtPHP(spent)}</div></div>
          </div>
        </div>
        <div style="grid-column: span 2;">
          <div class="panel"><div class="panel-header"><div class="panel-title">Rental history</div></div><div class="panel-body flush">
            ${allMine.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Vehicle</th><th>Period</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${allMine.map(r => {
            const v = getVehicle(r.vehicleId);
            return `<tr><td><div class="cell-main">${esc(v ? v.name : r.vehicleId)}</div><div class="cell-sub">${esc(v ? v.plateNumber : '')}</div></td><td class="small">${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}</td><td>${fmtPHP(r.totalFee + (r.overtimeFee || 0))}</td><td>${statusBadge(r.status)}</td><td class="text-right"><a class="btn btn-sm btn-ghost" href="#/customer/reservation/${r.id}">View</a></td></tr>`;
        }).join('')}</tbody></table></div>` : `<div class="empty"><div class="empty-title">No rental history</div><div>Completed and past rentals will appear here.</div></div>`}
          </div></div>
        </div>
      </div>
    `);
    }
    function renderOvertimeRulesPanel() {
        const s = getOvertimeSettings();
        return `<div class="panel"><div class="panel-header"><div class="panel-title">Rental rules (overtime)</div><span class="small muted">Read-only contract settings</span></div><div class="panel-body"><div class="kv">
            <div class="k">1 hour late</div><div class="v">${fmtPHP(s.tiers[1])}</div>
            <div class="k">2 hours late</div><div class="v">${fmtPHP(s.tiers[2])}</div>
            <div class="k">3 hours late</div><div class="v">${fmtPHP(s.tiers[3])}</div>
            <div class="k">4+ hours late</div><div class="v">${fmtPHP(s.tiers[3])} + ${fmtPHP(s.perHourAfterThird)}/hour after 3rd</div>
            <div class="k">More than ${s.fullDayAfterHours} hours</div><div class="v">1 full-day rate (vehicle rate/day)</div>
            <div class="k">Cleaning fee (add-on)</div><div class="v">${fmtPHP(s.cleaningFee)}</div>
            <div class="k">Refueling fee (add-on)</div><div class="v">Admin-entered amount</div>
        </div><p class="small muted mt-2">Hours are rounded up to the next whole hour. Assumptions are documented in docs/KNOWN_LIMITATIONS.md.</p></div></div>`;
    }

    // ---------- Admin: Dashboard ----------
    function renderAdminDashboard() {
        const pending = state.reservations.filter(r => r.status === 'pending').length;
        const active = state.reservations.filter(r => r.status === 'ongoing').length;
        const available = state.vehicles.filter(v => v.status === 'available').length;
        const month = new Date().getMonth(), year = new Date().getFullYear();
        const earnings = state.reservations.filter(r => r.status === 'completed').filter(r => {
            const d = new Date(r.actualReturn || r.end);
            return d.getMonth() === month && d.getFullYear() === year;
        }).reduce((s, r) => s + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r), 0);
        const todayStr = todayKey();
        const todays = state.reservations.filter(r => (r.status === 'approved' || r.status === 'ongoing') && toManilaDateKey(r.start) <= todayStr && toManilaDateKey(r.end) >= todayStr);
        const perVehicle = state.vehicles.map(v => ({ v, val: state.reservations.filter(r => r.vehicleId === v.id && r.status === 'completed').reduce((s, r) => s + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r), 0) })).filter(x => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 6);
        const max = Math.max(1, ...perVehicle.map(x => x.val));
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
          ${renderOvertimeRulesPanel()}
          <div class="panel"><div class="panel-header"><div class="panel-title">Today's schedule</div><a href="#/admin/reservations" class="btn btn-sm btn-ghost">View reservations</a></div>
            <div class="panel-body flush">${todays.length ? `<table class="table"><thead><tr><th>Customer</th><th>Vehicle</th><th>Period</th><th>Status</th></tr></thead><tbody>${todays.map(r => {
            const v = getVehicle(r.vehicleId);
            return `<tr class="row-click" onclick="location.hash='#/admin/reservation/${r.id}'"><td class="cell-main">${esc(r.customerName)}</td><td>${esc(v ? v.name : '')}</td><td class="small">${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}</td><td>${statusBadge(r.status)}</td></tr>`;
        }).join('')}</tbody></table>` : `<div class="empty">No rentals scheduled for today.</div>`}</div>
          </div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Earnings by vehicle</div><span class="small muted">Completed rentals</span></div><div class="panel-body">
            ${perVehicle.length ? perVehicle.map(x => `<div class="bar-row"><div class="bar-label"><span>${esc(x.v.name)}</span><span>${fmtPHP(x.val)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(x.val / max * 100).toFixed(1)}%"></div></div></div>`).join('') : `<div class="small muted">No completed rental earnings recorded yet.</div>`}
          </div></div>
        </div>
      </div>
    `);
    }

    function vehicleImage(vehicle) {
    const image = vehicle?.imageUrlAlt || vehicle?.imageUrl;

    if (image) {
        return `
            <img
                class="vehicle-photo"
                src="${esc(image)}"
                alt="${esc(vehicle.name)}"
            >
        `;
    }

    return `
        <div class="vehicle-photo-placeholder">
            <span>${esc(vehicle.name)}</span>
            <small>${esc(vehicle.displacement)}cc Class</small>
        </div>
    `;
}
    // ---------- Admin: Vehicles ----------
    
function renderAdminVehicles() {
    const statuses = [
        'available',
        'rented',
        'maintenance',
        'malfunction'
    ];

    mount(`
        <div class="page-header">
            <div>
                <h1 class="page-title">Vehicles</h1>
                <p class="page-desc">
                    Manage fleet records and current vehicle status.
                </p>
            </div>

            <button
                class="btn btn-primary"
                onclick="App.openVehicleModal()"
            >
                + Add vehicle
            </button>
        </div>

        <div class="vehicle-grid">

            ${state.vehicles.map(vehicle => `
                <article class="fleet-card">

                    <div class="fleet-image">
                        ${vehicleImage(vehicle)}

                        <div class="fleet-status">
                            ${statusBadge(vehicle.status)}
                        </div>
                    </div>

                    <div class="fleet-card-body">

                        <div class="fleet-card-heading">
                            <h2>${esc(vehicle.name)}</h2>

                            <p class="muted small">
                                ${esc(vehicle.brand)}
                                · ${esc(vehicle.year)}
                            </p>
                        </div>

                        <div class="fleet-specs">
                            <div>
                                <span>Displacement</span>
                                <strong>
                                    ${esc(vehicle.displacement)}cc Class
                                </strong>
                            </div>

                            <div>
                                <span>Plate number</span>
                                <strong>
                                    ${esc(vehicle.plateNumber)}
                                </strong>
                            </div>

                            <div>
                                <span>Transmission</span>
                                <strong>
                                    ${esc(vehicle.transmission)}
                                </strong>
                            </div>
                        </div>

                        <div class="divider"></div>

                        <div class="fleet-price">
                            <strong>
                                ${fmtPHP(vehicle.ratePerDay)}
                            </strong>

                            <span class="muted">/ day</span>
                        </div>

                        <p class="muted small">
                            ${fmtPHP(vehicle.ratePerHour)} / hour
                        </p>
                        <p class="muted small" style="margin-top:6px">Tracker: ${esc(vehicle.tracker?.deviceId || 'Not set')} • ${vehicle.tracker?.enabled === false ? 'Disabled' : 'Enabled'}${vehicle.tracker?.lastSeenAt ? ` • Last seen ${fmtDateShort(vehicle.tracker.lastSeenAt)}` : ''}</p>

                        <div class="fleet-card-actions">

                            <select
                                class="select"
                                aria-label="Vehicle status"
                                onchange="App.changeVehicleStatus(
                                    '${vehicle.id}',
                                    this.value
                                )"
                            >
                                ${statuses.map(status => `
                                    <option
                                        value="${status}"
                                        ${vehicle.status === status
                                            ? 'selected'
                                            : ''}
                                    >
                                        ${status.charAt(0).toUpperCase()
                                            + status.slice(1)}
                                    </option>
                                `).join('')}
                            </select>

                            <button
                                class="btn"
                                onclick="App.openVehicleModal(
                                    '${vehicle.id}'
                                )"
                            >
                                Edit
                            </button>

                        </div>
                    </div>
                </article>
            `).join('')}

        </div>

        ${state.vehicles.length === 0
            ? '<div class="empty">No vehicles registered.</div>'
            : ''}
    `);
}

    // ---------- Admin: Reservations ----------
    function renderAdminReservations() {
        const tab = state.ui.adminResTab || 'pending';
        const tabs = [['pending', 'Pending'], ['approved', 'Approved'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['rejected', 'Rejected']];
        const list = state.reservations.filter(r => r.status === tab).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        mount(`
      <div class="page-header"><div><h1 class="page-title">Reservations</h1><p class="page-desc">Review requests and manage rental status transitions.</p></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" onclick="App.setUI('adminResTab','${k}'); App.render()">${l} <span class="faint">(${state.reservations.filter(r => r.status === k).length})</span></button>`).join('')}</div>
      ${list.length ? `<div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Customer</th><th>Vehicle</th><th>Period</th><th>Amount</th><th>Payment</th><th>Actions</th></tr></thead><tbody>${list.map(r => {
            const v = getVehicle(r.vehicleId);
            const p = getPaymentByReservation(r.id);
            return `<tr>
          <td><div class="cell-main">${esc(r.customerName)}</div><div class="cell-sub">${esc(r.customerEmail)}</div></td>
          <td><div class="cell-main">${esc(v ? v.name : r.vehicleId)}</div><div class="cell-sub">${esc(v ? v.plateNumber : '')}</div></td>
          <td class="small">${fmtDateShort(r.start)} - ${fmtDateShort(r.end)}<div class="cell-sub">${esc(getDeliveryMethod(r))}</div></td>
          <td>${fmtPHP(r.totalFee)}${r.overtimeFee ? `<div class="cell-sub">+ ${fmtPHP(r.overtimeFee)} OT</div>` : ''}</td>
          <td>${p ? statusBadge(p.status) : '<span class="small muted">None</span>'}</td>
          <td><div class="btn-group">
            <a href="#/admin/reservation/${r.id}" class="btn btn-sm">View</a>
            ${r.status === 'pending' ? `<button class="btn btn-sm btn-primary" onclick="App.approveReservation('${r.id}')">Approve</button><button class="btn btn-sm btn-danger" onclick="App.openRejectReservationModal('${r.id}')">Reject</button>` : ''}
            ${r.status === 'approved' ? `<button class="btn btn-sm btn-primary" onclick="App.startRental('${r.id}')">Start rental</button>` : ''}
            ${r.status === 'ongoing' ? `<button class="btn btn-sm btn-primary" onclick="App.openCompleteModal('${r.id}')">Complete</button>` : ''}
          </div></td>
        </tr>`;
        }).join('')}</tbody></table></div></div>` : `<div class="empty"><div class="empty-title">No ${esc(tab)} reservations</div><div>Reservations with this status will appear here.</div></div>`}
    `);
    }
    function renderAdminReservationDetail(id) {
        renderReservationDetail(id, true);
    }
    // ---------- Admin: Payments ----------
    function renderAdminPayments() {
        const list = state.payments.slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
        mount(`
      <div class="page-header"><div><h1 class="page-title">Payments &amp; Refunds</h1><p class="page-desc">Review submitted payment proofs and confirm verification status.</p></div></div>
      ${list.length ? `<div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Customer</th><th>Reservation</th><th>Payment type</th><th>Method</th><th>Amount</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map(p => {
            const r = getReservation(p.reservationId);
            const v = r ? getVehicle(r.vehicleId) : null;
            return `<tr>
          <td class="cell-main">${esc(r ? r.customerName : '—')}</td>
          <td><div class="cell-main">${esc(v ? v.name : '—')}</div><div class="cell-sub mono">${esc(r ? r.id.toUpperCase() : '')}</div></td>
          <td>${p.paymentType === 'overtime' ? 'Overtime' : 'Rental'}</td><td>${esc(p.method)}</td>
          <td>${fmtPHP(p.amount)}</td>
          <td class="small">${fmtDate(p.submittedAt, { time: true })}</td>
          <td>${statusBadge(p.status)}</td>
          <td><div class="btn-group">
            <button class="btn btn-sm" onclick="App.openPaymentModal('${p.id}')">View proof</button>
            ${p.status === 'pending' ? `<button class="btn btn-sm btn-primary" onclick="App.verifyPayment('${p.id}')">Verify</button><button class="btn btn-sm btn-danger" onclick="App.openRejectPaymentModal('${p.id}')">Reject</button>` : ''}
          </div></td>
        </tr>`;
        }).join('')}</tbody></table></div></div>` : `<div class="empty"><div class="empty-title">No payments</div><div>Submitted payment proofs will appear here.</div></div>`}
      <div style="margin-top:16px">
        ${reservationPanel('Refunds', `<div class="toolbar"><button class="btn btn-primary" onclick="App.openRefundSelection()">Assess refund</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Customer</th><th>Reservation</th><th>Reason</th><th>Responsibility</th><th>Refund amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.reservations.filter(r => r.refund?.amount > 0).map(r => `<tr><td>${esc(r.customerName)}</td><td>${esc(r.id.toUpperCase())}</td><td>${esc(refundReasonLabel(r.refund))}</td><td>${esc(refundResponsibility(r.refund))}</td><td>${fmtPHP(r.refund.amount)}</td><td>${esc(r.refund.status)}</td><td><a class="btn btn-sm" href="#/admin/reservation/${r.id}">View</a> ${r.refund.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="App.openRefundModal('${r.id}')">Record refund</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No refunds recorded.</td></tr>'}</tbody></table></div>`)}
      </div>
    `);
    }
    // ---------- Admin: Maintenance ----------
    function renderAdminMaintenance() {
        const logs = state.maintenanceLogs.slice().sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
        mount(`
      <div class="page-header"><div><h1 class="page-title">Maintenance and incidents</h1><p class="page-desc">Track service records and reported vehicle issues.</p></div><div><button class="btn btn-primary" onclick="App.openMaintenanceModal()">Log entry</button></div></div>
      ${logs.length ? `<div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Vehicle</th><th>Type</th><th>Damage</th><th>Photos</th><th>Title</th><th>Reported</th><th>Cost</th><th>Status</th><th>Actions</th></tr></thead><tbody>${logs.map(l => {
            const v = getVehicle(l.vehicleId);
            return `<tr>
          <td><div class="cell-main">${esc(v ? v.name : l.vehicleId)}</div><div class="cell-sub">${esc(v ? v.plateNumber : '')}</div></td>
          <td><span class="status ${l.type === 'incident' ? 'status-malfunction' : 'status-approved'}">${esc(l.type)}</span></td>
          <td>${esc(damageLabel(l.damageLocation))}</td>
          <td>${(l.photos || []).length}</td>
          <td><div class="cell-main">${esc(l.title)}</div><div class="cell-sub">${esc(l.description)}</div></td>
          <td class="small">${fmtDate(l.reportedAt, { time: true })}${l.resolvedAt ? `<div class="cell-sub">Resolved ${fmtDateShort(l.resolvedAt)}</div>` : ''}</td>
          <td>${fmtPHP(l.cost || 0)}</td>
          <td>${statusBadge(l.status)}</td>
          <td><button class="btn btn-sm" onclick="App.viewMaintenance('${l.id}')">View</button></td>
        </tr>`;
        }).join('')}</tbody></table></div></div>` : `<div class="empty"><div class="empty-title">No maintenance or incident records</div><div>Log service work or reported issues to track vehicle condition.</div></div>`}
    `);
    }
    // ---------- Admin: Reports ----------
    function renderAdminReports() {
        const range = state.ui.reportRange || 'month';
        const now = new Date();
        const inRange = (iso) => {
            if (!iso)
                return false;
            const d = new Date(iso);
            if (range === 'all')
                return true;
            if (range === 'month')
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return d.getMonth() === last.getMonth() && d.getFullYear() === last.getFullYear();
        };
        const completed = state.reservations.filter(r => r.status === 'completed' && inRange(r.actualReturn || r.end));
        const totalRev = completed.reduce((s, r) => s + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r), 0);
        const totalOT = completed.reduce((s, r) => s + (r.overtimeFee || 0), 0);
        const perV = state.vehicles.map(v => ({ v, rev: completed.filter(r => r.vehicleId === v.id).reduce((s, r) => s + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r), 0) })).filter(x => x.rev > 0).sort((a, b) => b.rev - a.rev);
        const maxRev = Math.max(1, ...perV.map(x => x.rev));
        const daysInPeriod = range === 'all' ? 90 : new Date(now.getFullYear(), range === 'month' ? now.getMonth() + 1 : now.getMonth(), 0).getDate();
        const utilization = state.vehicles.map(v => {
            const rentedDays = state.reservations.filter(r => r.vehicleId === v.id && ['approved', 'ongoing', 'completed'].includes(r.status) && inRange(r.start)).reduce((s, r) => {
                const endD = r.actualReturn ? new Date(r.actualReturn) : new Date(r.end);
                const ms = Math.min(endD, now) - new Date(r.start);
                return s + Math.max(0, Math.ceil(ms / 86400000));
            }, 0);
            const pct = Math.min(100, Math.round((rentedDays / Math.max(1, daysInPeriod)) * 100));
            return { v, rentedDays, pct };
        });
        const counts = { pending: 0, approved: 0, ongoing: 0, completed: 0, cancelled: 0, rejected: 0 };
        state.reservations.filter(r => inRange(r.createdAt)).forEach(r => {
            if (counts[r.status] != null)
                counts[r.status]++;
        });
        const displacementCounts = Object.entries(DISPLACEMENT_CLASSES).map(([key, label]) => ({ label, count: state.reservations.filter(r => inRange(r.createdAt) && String(getVehicle(r.vehicleId)?.displacement) === key).length }));
        const displacementMax = Math.max(1, ...displacementCounts.map(x => x.count));
        mount(`
      <div class="page-header"><div><h1 class="page-title">Reports</h1><p class="page-desc">Summary of earnings, utilization, and reservation activity.</p></div>
        <div><select class="select" onchange="App.setUI('reportRange', this.value); App.render()">
          <option value="month" ${range === 'month' ? 'selected' : ''}>This month</option>
          <option value="last" ${range === 'last' ? 'selected' : ''}>Last month</option>
          <option value="all" ${range === 'all' ? 'selected' : ''}>All time</option>
        </select></div></div>
      <div class="metrics mb-3">
        <div class="metric"><div class="metric-label">Total revenue</div><div class="metric-value sm">${fmtPHP(totalRev)}</div></div>
        <div class="metric"><div class="metric-label">Overtime collected</div><div class="metric-value sm">${fmtPHP(totalOT)}</div></div>
        <div class="metric"><div class="metric-label">Completed rentals</div><div class="metric-value">${completed.length}</div></div>
        <div class="metric"><div class="metric-label">Reservations created</div><div class="metric-value">${state.reservations.filter(r => inRange(r.createdAt)).length}</div></div>
      </div>
      <div class="grid-2 mb-3">
        <div class="panel"><div class="panel-header"><div class="panel-title">Revenue by vehicle</div></div><div class="panel-body">
          ${perV.length ? perV.map(x => `<div class="bar-row"><div class="bar-label"><span>${esc(x.v.name)}</span><span>${fmtPHP(x.rev)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(x.rev / maxRev * 100).toFixed(1)}%"></div></div></div>`).join('') : `<div class="small muted">No completed revenue in this period.</div>`}
        </div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Vehicle utilization</div><span class="small muted">Estimated rented days</span></div><div class="panel-body">
          ${utilization.map(u => `<div class="bar-row"><div class="bar-label"><span>${esc(u.v.name)}</span><span>${u.rentedDays} days · ${u.pct}%</span></div><div class="bar-track"><div class="bar-fill alt" style="width:${u.pct}%"></div></div></div>`).join('')}
        </div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-header"><div class="panel-title">Reservations by status</div><span class="small muted">By creation date</span></div><div class="panel-body flush"><table class="table"><tbody>${Object.entries(counts).map(([k, v]) => `<tr><td style="text-transform:capitalize">${esc(k)}</td><td class="text-right"><strong>${v}</strong></td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Reservations by displacement</div></div><div class="panel-body">
          ${displacementCounts.map(x => `<div class="bar-row"><div class="bar-label"><span>${esc(x.label)}</span><span>${x.count}</span></div><div class="bar-track"><div class="bar-fill" style="width:${x.count / displacementMax * 100}%"></div></div></div>`).join('')}
        </div></div>
      </div>
    `);
    }
    // ---------- Admin: Customers ----------
    function renderAdminCustomers() {
        const rows = state.customers.map(c => {
            const mine = state.reservations.filter(r => r.customerId === c.id);
            const spent = mine.filter(r => r.status === 'completed').reduce((s, r) => s + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r), 0);
            return { c, count: mine.length, spent };
        });
        mount(`
      <div class="page-header"><div><h1 class="page-title">Customers</h1><p class="page-desc">Customer records and rental summaries.</p></div></div>
      <div class="panel"><div class="panel-body flush"><table class="table"><thead><tr><th>Customer</th><th>Contact</th><th>ID status</th><th>Total rentals</th><th>Total spent</th><th>Joined</th><th></th></tr></thead><tbody>${rows.map(({ c, count, spent }) => `
        <tr><td><div style="display:flex;align-items:center;gap:10px">${customerAvatar(c)}<div>${esc(c.name)}<div class="cell-sub">${esc(c.id.toUpperCase())}</div></div></div></td><td><div>${esc(c.email)}</div><div class="cell-sub">${esc(c.phone)}</div></td><td>${identityBadge(c)}</td><td>${count}</td><td>${fmtPHP(spent)}</td><td class="small">${fmtDateShort(c.joinedAt)}</td><td class="text-right"><button class="btn btn-sm" onclick="App.openCustomerModal('${c.id}')">View profile</button></td></tr>`).join('')}</tbody></table></div></div>
    `);
    }
    // ---------- Modal renderers ----------
    function openVehicleModal(id) {
        const v = id ? getVehicle(id) : null;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${v ? 'Edit vehicle' : 'Add vehicle'}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.saveVehicle(event, ${v ? `'${v.id}'` : 'null'})"><div class="modal-body"><div class="form-grid">
        <div class="field"><label class="field-label">Display name</label><input name="name" class="input" required value="${esc(v ? v.name : '')}"></div>
        <div class="field"><label class="field-label">Displacement</label><select name="displacement" class="select">${Object.entries(DISPLACEMENT_CLASSES).map(([key, label]) => `<option value="${key}" ${v && String(v.displacement) === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="field"><label class="field-label">Brand</label><input name="brand" class="input" required value="${esc(v ? v.brand : '')}"></div>
        <div class="field"><label class="field-label">Model</label><input name="model" class="input" required value="${esc(v ? v.model : '')}"></div>
        <div class="field"><label class="field-label">Year</label><input name="year" type="number" min="1990" max="2035" class="input" required value="${v ? v.year : new Date().getFullYear()}"></div>
        <div class="field"><label class="field-label">Plate number</label><input name="plateNumber" class="input" required value="${esc(v ? v.plateNumber : '')}"></div>
        <div class="field"><label class="field-label">Rate per day (PHP)</label><input name="ratePerDay" type="number" min="1" class="input" required value="${v ? v.ratePerDay : 1500}"></div>
        <div class="field"><label class="field-label">Rate per hour (PHP)</label><input name="ratePerHour" type="number" min="1" class="input" required value="${v ? v.ratePerHour : 120}"></div>
        <div class="field"><label class="field-label">Seats</label><input name="seats" type="number" min="1" max="20" class="input" required value="${v ? v.seats : 2}"></div>
        <div class="field"><label class="field-label">Transmission</label><select name="transmission" class="select"><option ${v && v.transmission === 'Automatic' ? 'selected' : ''}>Automatic</option><option ${v && v.transmission === 'Manual' ? 'selected' : ''}>Manual</option></select></div>
        <div class="field"><label class="field-label">Color</label><input name="color" class="input" value="${esc(v ? v.color : '')}"></div>
        <div class="field"><label class="field-label">Tracker device ID</label><input name="trackerDeviceId" class="input" value="${esc(v?.tracker?.deviceId || '')}" placeholder="e.g. TRK-V1-001"></div>
        <div class="field"><label class="field-label">Tracker enabled</label><select name="trackerEnabled" class="select"><option value="true" ${v?.tracker?.enabled !== false ? 'selected' : ''}>Enabled</option><option value="false" ${v?.tracker?.enabled === false ? 'selected' : ''}>Disabled</option></select></div>
      </div></div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Save vehicle</button></div></form></div>`);
    }
    const DAMAGE_LOCATIONS = {
        none: 'No damage / routine service',
        internal: 'Internal',
        external: 'External',
        both: 'Internal and external',
        unknown: 'Not assessed'
    };

    function damageLabel(value) {
        return DAMAGE_LOCATIONS[value] || 'Not assessed';
    }

    function maintenancePhotos(log) {
        return (log.photos || []).filter(photo =>
            /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(photo.dataUrl)
        );
    }

    let photoDraft = [];

    function renderMaintenancePhotos(editable = true) {
        return photoDraft.map((photo, index) => `
            <div class="proof-preview" style="flex-direction:column;gap:8px">
                <img src="${esc(photo.dataUrl)}" alt="${esc(photo.name)}" style="max-height:240px">
                <span class="small muted">${esc(photo.name)}</span>
                ${editable ? `<button type="button" class="btn btn-sm btn-danger" onclick="App.removeMaintenancePhoto(${index})">Remove</button>` : ''}
            </div>`).join('') || '<p class="small muted">No photos attached.</p>';
    }

    function removeMaintenancePhoto(index) {
        photoDraft.splice(index, 1);
        $('#maintenancePhotos').innerHTML = renderMaintenancePhotos();
    }

    async function addMaintenancePhotos(input) {
        const form = input.form;
        const draft = photoDraft;
        const save = form.querySelector('[type="submit"]');
        input.disabled = true;
        save.disabled = true;
        try {
            for (const file of Array.from(input.files)) {
                if (draft.length >= 10) { toast('Maximum 10 photos per log.', 'error'); break; }
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
                    toast('Use JPG, PNG or WEBP up to 5 MB each.', 'error');
                    continue;
                }
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                if (!form.isConnected || draft !== photoDraft) return;
                draft.push({ name: file.name, dataUrl });
            }
        } catch (error) {
            toast('Unable to read photo.', 'error');
        } finally {
            input.value = '';
            input.disabled = false;
            save.disabled = false;
            if (form.isConnected && draft === photoDraft) $('#maintenancePhotos').innerHTML = renderMaintenancePhotos();
        }
    }

    function openMaintenanceModal(id) {
        if (state.role !== 'admin') return;
        const log = id ? state.maintenanceLogs.find(item => item.id === id) : null;
        if (id && !log) return;
        photoDraft = log ? maintenancePhotos(log).slice() : [];
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${log ? 'Edit log' : 'Log maintenance or incident'}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
          <form onsubmit="App.saveMaintenance(event, '${id || ''}')"><div class="modal-body stack">
            <div class="field"><label class="field-label">Vehicle</label><select name="vehicleId" class="select" required>${state.vehicles.map(v => `<option value="${v.id}" ${log?.vehicleId === v.id ? 'selected' : ''}>${esc(v.name)} (${esc(v.plateNumber)})</option>`).join('')}</select></div>
            <div class="form-grid">
              <div class="field"><label class="field-label">Type</label><select name="type" class="select"><option value="maintenance" ${log?.type === 'maintenance' ? 'selected' : ''}>Maintenance</option><option value="incident" ${log?.type === 'incident' ? 'selected' : ''}>Incident</option></select></div>
              <div class="field"><label class="field-label">Cost (PHP)</label><input name="cost" type="number" min="0" step="0.01" class="input" required value="${Number(log?.cost || 0)}"></div>
            </div>
            <div class="field"><label class="field-label">Damage classification</label><select name="damageLocation" class="select" required>${Object.entries(DAMAGE_LOCATIONS).map(([key,label]) => `<option value="${key}" ${(log?.damageLocation || 'unknown') === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
            <div class="field"><label class="field-label">Title</label><input name="title" class="input" required value="${esc(log?.title || '')}"></div>
            <div class="field"><label class="field-label">Description</label><textarea name="description" class="textarea" rows="3" required>${esc(log?.description || '')}</textarea></div>
            <div class="field"><label class="field-label">Photo documentation</label><input type="file" class="input" multiple accept="image/jpeg,image/png,image/webp" onchange="App.addMaintenancePhotos(this)"><div class="field-hint">Up to 10 photos, 5 MB each.</div></div>
            <div id="maintenancePhotos" class="stack">${renderMaintenancePhotos()}</div>
          </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button type="submit" class="btn btn-primary">Save log</button></div></form></div>`);
    }

    function viewMaintenance(id) {
        if (state.role !== 'admin') return;
        const log = state.maintenanceLogs.find(item => item.id === id);
        if (!log) return;
        const vehicle = getVehicle(log.vehicleId);
        photoDraft = maintenancePhotos(log).slice();
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${esc(log.title)}</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div>
          <div class="modal-body stack"><div class="kv">
            <div class="k">Vehicle</div><div class="v">${esc(vehicle?.name || log.vehicleId)} (${esc(vehicle?.plateNumber || '')})</div>
            <div class="k">Type</div><div class="v">${esc(log.type)}</div>
            <div class="k">Damage</div><div class="v">${esc(damageLabel(log.damageLocation))}</div>
            <div class="k">Status</div><div class="v">${statusBadge(log.status)}</div>
            <div class="k">Cost</div><div class="v">${fmtPHP(log.cost)}</div>
            <div class="k">Reported</div><div class="v">${fmtDate(log.reportedAt, {time:true})}</div>
            <div class="k">Resolved</div><div class="v">${fmtDate(log.resolvedAt, {time:true})}</div>
          </div><p style="white-space:pre-wrap">${esc(log.description)}</p><strong>Photos</strong>${renderMaintenancePhotos(false)}</div>
          <div class="modal-footer"><button class="btn" onclick="App.closeModal()">Close</button><button class="btn btn-primary" onclick="App.openMaintenanceModal('${id}')">Edit</button>${log.status === 'open' ? `<button class="btn btn-primary" onclick="App.openResolveLogModal('${id}')">Resolve</button>` : ''}</div></div>`);
    }
    // ---------- Overtime assessment and settlement ----------
    function overtimeStatus(r) {
        if (!r.overtimeFee) return 'not_applicable';
        const payment = getPaymentByReservation(r.id, 'overtime');
        return payment?.status === 'verified' ? 'paid' : payment?.status || 'unpaid';
    }

    function overtimePanel(r, admin) {
        if (!r.overtimeFee && !r.overtime?.hours) return '';
        const o = r.overtime || {};
        const p = getPaymentByReservation(r.id, 'overtime');
        const status = overtimeStatus(r);
        const labels = { unpaid: 'Unpaid', pending: 'Pending', rejected: 'Rejected', paid: 'Paid', not_applicable: 'No balance' };
        const cleaning = Number(o.cleaningFee) || 0;
        const refueling = Number(o.refuelingFee) || 0;
        const baseFee = Number(o.baseFee ?? o.calculatedFee ?? r.overtimeFee) || 0;
        const tier = o.tierLabel || (o.hours ? `${o.hours} hour(s) late` : 'Not applicable');
        const body = `
            <div class="kv">
                <div class="k">Status</div><div class="v">${statusBadge(status === 'paid' ? 'verified' : status === 'not_applicable' ? 'neutral' : status === 'unpaid' ? 'pending' : status)} ${labels[status]}</div>
                <div class="k">Billable hours</div><div class="v">${esc(o.hours ?? '-')}</div>
                <div class="k">Tier applied</div><div class="v">${esc(tier)}</div>
                <div class="k">Overtime base fee</div><div class="v">${fmtPHP(baseFee)}</div>
                <div class="k">Cleaning fee</div><div class="v">${fmtPHP(cleaning)}</div>
                <div class="k">Refueling fee</div><div class="v">${fmtPHP(refueling)}</div>
                <div class="k">Final charge</div><div class="v">${fmtPHP(r.overtimeFee)}</div>
                <div class="k">Outstanding</div><div class="v">${fmtPHP(status === 'paid' ? 0 : r.overtimeFee)}</div>
            </div>
            ${o.adjustmentReason ? `<p class="small muted mt-2">Adjustment: ${esc(o.adjustmentReason)}</p>` : ''}
            ${o.assessedAt ? `<p class="small muted mt-2">Assessed by ${esc(o.assessedBy)} � ${fmtDate(o.assessedAt, {time:true})}</p>` : ''}
            ${p ? `<div class="proof-preview">${p.proofDataUrl ? `<img src="${esc(p.proofDataUrl)}" alt="Overtime payment proof">` : 'Demo proof on file'}</div>` : ''}
            ${p?.rejectReason ? `<div class="callout danger mt-2">${esc(p.rejectReason)}</div>` : ''}
            ${admin && status === 'pending' ? `<div class="btn-group mt-3"><button class="btn btn-primary" onclick="App.verifyPayment('${p.id}')">Verify</button><button class="btn btn-danger" onclick="App.openRejectPaymentModal('${p.id}')">Reject</button></div>` : ''}
            ${!admin && ['unpaid','rejected'].includes(status) ? `<button class="btn btn-primary btn-block mt-3" data-ai-target="upload-overtime-proof" onclick="App.openOvertimePayment('${r.id}')">${status === 'rejected' ? 'Resubmit' : 'Upload'} overtime proof</button>` : ''}`;
        return reservationPanel('Overtime payment', body);
    }

        function openOvertimePayment(id) {
        const r = getReservation(id);
        if (state.role !== 'customer' || !r || !ownsReservation(r) || r.status !== 'completed' || !['unpaid','rejected'].includes(overtimeStatus(r))) return;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Settle overtime</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div>
            <form onsubmit="App.submitOvertimePayment(event,'${r.id}')"><div class="modal-body stack">
                <div class="callout info">Amount due: <strong>${fmtPHP(r.overtimeFee)}</strong></div>
                <label class="field">Payment method<select name="method" class="select"><option>GCash</option><option>Other</option></select></label>
                <label class="field">Payment proof<input name="proof" type="file" class="input" accept="image/jpeg,image/png,image/webp" required data-ai-target="payment-proof-input"></label>
            </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button type="submit" class="btn btn-primary">Submit proof</button></div></form></div>`);
    }

    function submitOvertimePayment(e, id) {
        e.preventDefault();
        const r = getReservation(id);
        if (state.role !== 'customer' || !r || !ownsReservation(r) || r.status !== 'completed' || !['unpaid','rejected'].includes(overtimeStatus(r))) return;
        const form = e.target;
        const file = form.elements.proof.files[0];
        if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return toast('Select a JPG, PNG or WEBP image up to 5 MB.', 'error');
        const existing = getPaymentByReservation(id, 'overtime');
        if (existing?.proofDataUrl?.startsWith('blob:')) URL.revokeObjectURL(existing.proofDataUrl);
        const values = { reservationId:id, paymentType:'overtime', method:form.elements.namedItem('method').value, amount:r.overtimeFee, proofDataUrl:URL.createObjectURL(file), status:'pending', submittedAt:new Date().toISOString(), verifiedBy:null, verifiedAt:null, rejectReason:'' };
        if (existing) Object.assign(existing, values);
        else state.payments.unshift({id:uid('p'), ...values});
        if (r.overtime) r.overtime.paymentStatus = 'pending';
        notify('admin','Overtime proof submitted',`${r.customerName} submitted overtime proof for ${r.id.toUpperCase()}.`,'#/admin/payments');
        closeModal();
        toast('Overtime proof submitted.', 'success');
        render();
    }

    // Early return: use the booked rate, not the current fleet price.
    const EARLY_RETURN_FEE = 500;
    const REFUND_REASONS = {
        early_return: ['Voluntary early return', 'Customer'],
        vehicle_defect: ['Vehicle defect / breakdown', 'Rental business'],
        customer_damage: ['Customer-caused damage', 'Customer'],
        business_cancellation: ['Business cancellation', 'Rental business'],
        service_issue: ['Service / delivery issue', 'Rental business'],
        other: ['Other / disputed responsibility', 'Undetermined']
    };
    function refundReasonLabel(f) { return REFUND_REASONS[f.reasonType || 'early_return']?.[0] || 'Other'; }
    function refundResponsibility(f) { return REFUND_REASONS[f.reasonType || 'early_return']?.[1] || 'Undetermined'; }
    function computeEarlyRefund(r, actual, reasonType = 'early_return') {
        const day = 86400000;
        const unusedDays = Math.max(0, Math.floor((new Date(r.end) - new Date(actual)) / day)) || 0;
        const bookedDays = Math.max(1, Math.ceil((new Date(r.end) - new Date(r.start)) / day));
        const rate = Number(r.totalFee || 0) / bookedDays;
        const gross = Math.round(unusedDays * rate * 100) / 100;
        const deduction = ['early_return','customer_damage'].includes(reasonType) ? Math.min(gross, unusedDays * EARLY_RETURN_FEE) : 0;
        const payment = getPaymentByReservation(r.id);
        const paid = payment?.status === 'verified' ? Number(payment.amount || 0) : 0;
        const amount = Math.max(0, Math.round(Math.min(gross - deduction, paid) * 100) / 100);
        return { unusedDays, rate, gross, deduction, amount, paid, reasonType };
    }

    function refundDeducted(r) {
        return ['disbursed', 'received'].includes(r.refund?.status) ? Number(r.refund.amount) : 0;
    }

    function refundPanel(r, admin) {
        const f = r.refund;
        if (!f) return '';
        const labels = { pending:'Pending refund', disbursed:'Disbursed', received:'Received', not_applicable:'No refund due' };
        return reservationPanel('Refund', `
            <div class="kv">
                <div class="k">Status</div><div class="v">${esc(labels[f.status])}</div>
                <div class="k">Reason</div><div class="v">${esc(refundReasonLabel(f))}</div>
                <div class="k">Responsibility</div><div class="v">${esc(refundResponsibility(f))}</div>
                ${f.reasonNotes ? `<div class="k">Assessment notes</div><div class="v">${esc(f.reasonNotes)}</div>` : ''}
                ${f.unusedDays != null ? `<div class="k">Unused days</div><div class="v">${f.unusedDays}</div>` : ''}
                ${f.gross != null ? `<div class="k">Refundable value</div><div class="v">${fmtPHP(f.gross)}</div>` : ''}
                ${f.deduction != null ? `<div class="k">Early return fee</div><div class="v">${fmtPHP(f.deduction)}</div>` : ''}
                <div class="k">Refund</div><div class="v">${fmtPHP(f.amount)}</div>
                ${f.referenceNumber ? `<div class="k">Reference</div><div class="v">${esc(f.referenceNumber)}</div><div class="k">Method</div><div class="v">${esc(f.method)}</div><div class="k">Disbursed</div><div class="v">${fmtDate(f.refundedAt,{time:true})}</div>` : ''}
            </div>
            ${f.proofDataUrl ? `<div class="proof-preview mt-2"><img src="${esc(f.proofDataUrl)}" alt="Refund transfer proof"></div>` : ''}
            ${admin && f.status === 'pending' ? `<button class="btn btn-primary btn-block mt-3" onclick="App.openRefundModal('${r.id}')">Record refund transfer</button>` : ''}
            ${!admin && f.status === 'disbursed' ? `<button class="btn btn-primary btn-block mt-3" onclick="App.acknowledgeRefund('${r.id}')">Confirm refund received</button>` : ''}
            ${f.status === 'pending' ? '<p class="small muted mt-2">Awaiting refund transfer by administrator.</p>' : ''}`);
    }

    function canAssessRefund(r) {
        const p = getPaymentByReservation(r.id);
        return ['completed','cancelled','approved'].includes(r.status) && (!r.refund || r.refund.status === 'not_applicable') && p?.status === 'verified' && Number(p.amount) > 0;
    }
    function openRefundSelection() {
        if (state.role !== 'admin') return;
        const eligible = state.reservations.filter(canAssessRefund);
        if (!eligible.length) return toast('No eligible reservations with verified payments.', 'info');
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Assess refund</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><div class="modal-body stack">${eligible.map(r => `<button class="btn" onclick="App.openAssessRefund('${r.id}')">${esc(r.id.toUpperCase())} · ${esc(r.customerName)} · ${esc(r.status)}</button>`).join('')}</div></div>`);
    }
    function openAssessRefund(id) {
        const r = getReservation(id);
        if (state.role !== 'admin' || !r || !canAssessRefund(r)) return;
        const paid = Number(getPaymentByReservation(id).amount);
        const approved = r.status === 'approved';
        const reasons = approved ? ['business_cancellation'] : ['vehicle_defect','service_issue','business_cancellation','customer_damage','other'];
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Assess refund</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div>
          <form onsubmit="App.assessRefund(event,'${r.id}')"><div class="modal-body stack">
            <div class="callout info">Verified rental payment: ${fmtPHP(paid)}. ${approved ? 'Confirming cancels this reservation before pickup and issues a full refund.' : 'Specify the justified refund amount after reviewing the incident or service issue. No automatic damage charge is applied.'}</div>
            <label class="field">Reason<select class="select" name="reasonType">${reasons.map(k=>`<option value="${k}">${REFUND_REASONS[k][0]} — ${REFUND_REASONS[k][1]}</option>`).join('')}</select></label>
            <label class="field">Refund amount (PHP)<input class="input" name="amount" type="number" min="0.01" max="${paid}" step="0.01" ${approved ? `value="${paid}" readonly` : ''} required></label>
            <label class="field">Assessment notes<textarea class="textarea" name="reasonNotes" required rows="3" placeholder="Explain responsibility, evidence and amount"></textarea></label>
          </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Confirm assessment</button></div></form></div>`);
    }
    function assessRefund(e,id) {
        e.preventDefault();
        const r = getReservation(id), f = e.target.elements;
        if (state.role !== 'admin' || !r || !canAssessRefund(r)) return;
        const paid = Number(getPaymentByReservation(id).amount), amount = Number(f.amount.value), reasonType = f.reasonType.value, reasonNotes = f.reasonNotes.value.trim();
        if (!REFUND_REASONS[reasonType] || reasonType === 'early_return' || !reasonNotes || !Number.isFinite(amount) || amount <= 0 || amount > paid) return toast('Enter a valid refund and assessment notes.', 'error');
        if (r.status === 'approved') {
            if (reasonType !== 'business_cancellation' || amount !== paid) return toast('Business cancellation requires a full refund.', 'error');
            r.status = 'cancelled'; r.cancelReason = reasonNotes;
        }
        r.refund = {reasonType, reasonNotes, amount, paid, status:'pending', assessedBy:'Admin', assessedAt:new Date().toISOString()};
        notify('customer','Refund assessed',`Refund due: ${fmtPHP(amount)}. ${refundReasonLabel(r.refund)}.`,`#/customer/reservation/${id}`,r.customerId);
        closeModal(); toast('Refund assessed.', 'success'); render();
    }

    function openRefundModal(id) {
        const r = getReservation(id);
        if (state.role !== 'admin' || r?.refund?.status !== 'pending') return;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Record refund transfer</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div>
            <form onsubmit="App.recordRefund(event,'${r.id}')"><div class="modal-body stack">
                <div class="callout info">Transfer ${fmtPHP(r.refund.amount)} to ${esc(r.customerName)} outside V.E.R.A. before recording the refund.</div>
                <label class="field">Method<select name="method" class="select"><option>GCash</option><option>Bank transfer</option><option>Cash</option></select></label>
                <label class="field">Reference or receipt number<input name="reference" class="input" required maxlength="100"></label>
                <label class="field">Proof of transfer or receipt<input name="proof" type="file" accept="image/png,image/jpeg,image/webp" class="input" required></label>
            </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Confirm disbursement</button></div></form></div>`);
    }

    function recordRefund(e, id) {
        e.preventDefault();
        const r = getReservation(id), f = e.target.elements;
        if (state.role !== 'admin' || r?.refund?.status !== 'pending') return;
        const file = f.proof.files[0], reference = f.reference.value.trim();
        if (!reference || !file || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return toast('Enter a reference and upload a JPG, PNG or WEBP receipt up to 5 MB.', 'error');
        Object.assign(r.refund, { status:'disbursed', method:f.method.value, referenceNumber:reference, proofDataUrl:URL.createObjectURL(file), refundedAt:new Date().toISOString(), refundedBy:'Admin' });
        notify('customer','Refund disbursed',`Your ${fmtPHP(r.refund.amount)} refund has been sent. Please confirm receipt.`,`#/customer/reservation/${id}`,r.customerId);
        closeModal(); toast('Refund recorded.', 'success'); render();
    }

    function acknowledgeRefund(id) {
        const r = getReservation(id);
        if (state.role !== 'customer' || !r || !ownsReservation(r) || r.refund?.status !== 'disbursed') return;
        openConfirm({title:'Confirm refund received',body:`Confirm that you received ${fmtPHP(r.refund.amount)}.`,onConfirm:()=>{
            if (state.role !== 'customer' || !ownsReservation(r) || r.refund.status !== 'disbursed') return;
            r.refund.status = 'received'; r.refund.receivedAt = new Date().toISOString();
            closeModal(); toast('Refund receipt confirmed.', 'success'); render();
        }});
    }

    function updateOvertimePreview(form, id) {
        const r = getReservation(id);
        if (!r || !form) return;
        const actual = new Date(form.elements.actualReturn.value + '+08:00');
        const preview = form.querySelector('#overtimePreview');
        const late = actual > new Date(r.end);
        const early = actual < new Date(r.end);
        form.elements.finalFee.disabled = !late;
        form.elements.adjustmentReason.disabled = !late;
        if (form.elements.cleaningFee) form.elements.cleaningFee.disabled = !late;
        if (form.elements.refuelingFee) form.elements.refuelingFee.disabled = !late;
        form.querySelector('#overtimeFields').hidden = !late;
        form.querySelector('#earlyRefundFields').hidden = !early;
        form.elements.refundReason.disabled = !early;
        form.elements.refundNotes.disabled = !early;
        form.elements.refundNotes.required = early && form.elements.refundReason.value !== 'early_return';
        if (!Number.isFinite(actual.getTime()) || actual < new Date(r.start) || actual > new Date()) {
            preview.textContent = 'Return time must be between rental start and now.';
            return;
        }
        if (early) {
            const f = computeEarlyRefund(r, actual, form.elements.refundReason.value);
            preview.innerHTML = `<strong>Early return refund</strong><br>Full unused days: ${f.unusedDays}<br>Unused rental value: ${fmtPHP(f.gross)}<br>Early return fee: -${fmtPHP(f.deduction)}<br>Refund due: <strong>${fmtPHP(f.amount)}</strong>${!f.paid && f.unusedDays ? '<br>No verified rental payment available to refund.' : ''}`;
            return;
        }
        const settings = getOvertimeSettings();
        const cleaning = !!form.elements.cleaningFee?.checked;
        const refuelingFee = Math.max(0, Number(form.elements.refuelingFee?.value) || 0);
        const ot = computeOvertime(r.vehicleId, r.end, actual, { cleaning, refuelingFee });
        const override = form.elements.finalFee.value;
        const final = late && override !== '' ? Number(override) : ot.fee;
        preview.innerHTML = late
            ? `Hours late: <strong>${ot.hours} hour(s)</strong><br>Tier: ${esc(ot.tierLabel)}<br>Overtime base: ${fmtPHP(ot.baseFee)}<br>Cleaning fee: ${fmtPHP(ot.cleaningFee)}${cleaning ? ' (applied)' : ''}<br>Refueling fee: ${fmtPHP(ot.refuelingFee)}<br>Calculated total: ${fmtPHP(ot.fee)}<br>Final charge: <strong>${fmtPHP(final)}</strong>${ot.fullDayApplied ? '<br><span class="small muted">Full-day rate applied because return is more than ' + settings.fullDayAfterHours + ' hours late.</span>' : ''}`
            : 'Returned on time. No overtime charge.';
        form.elements.adjustmentReason.required = late && final !== ot.fee;
    }

        function openCompleteModal(id) {
        const r = getReservation(id);
        if (state.role !== 'admin' || !r || r.status !== 'ongoing') return;
        const val = fmtDateTimeInput(new Date());
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Complete rental</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div>
            <form onsubmit="App.completeRental(event,'${r.id}')" oninput="App.updateOvertimePreview(this,'${r.id}')"><div class="modal-body stack">
                <div class="callout info">Scheduled return: <strong>${fmtDate(r.end,{time:true})}</strong><br>Overtime rate: ${fmtPHP(getVehicle(r.vehicleId)?.ratePerHour)}/hour<br>Early return fee: ₱500 per full unused day</div>
                <label class="field">Actual return<input id="actualReturn" name="actualReturn" type="datetime-local" class="input" value="${val}" min="${fmtDateTimeInput(r.start)}" max="${val}" required></label>
                <div id="earlyRefundFields" class="stack"><label class="field">Reason for early return<select class="select" name="refundReason">${['early_return','vehicle_defect','customer_damage','service_issue'].map(k=>`<option value="${k}">${REFUND_REASONS[k][0]} — ${REFUND_REASONS[k][1]}</option>`).join('')}</select></label><label class="field">Assessment notes<textarea class="textarea" name="refundNotes" rows="2" placeholder="Required for non-voluntary returns"></textarea></label></div>
                <div id="overtimePreview" class="callout"></div>
                <div id="overtimeFields" class="stack">
                    <label class="field checkline"><input type="checkbox" name="cleaningFee" value="1" onchange="App.updateOvertimePreview(this.form,'${id}')"> <span>Add cleaning fee (${fmtPHP(getOvertimeSettings().cleaningFee)})</span></label>
                    <label class="field">Refueling fee (PHP)<input name="refuelingFee" type="number" min="0" step="0.01" class="input" value="0" oninput="App.updateOvertimePreview(this.form,'${id}')" placeholder="0.00"></label>
                    <label class="field">Override total overtime charge (optional; 0 to waive)<input name="finalFee" type="number" min="0" step="0.01" class="input" placeholder="Use calculated total"></label>
                    <label class="field">Adjustment reason<textarea name="adjustmentReason" class="textarea" rows="2" placeholder="Required if final charge differs from calculated total"></textarea></label>
                </div>
            </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button type="submit" class="btn btn-primary">Complete & record adjustment</button></div></form></div>`);
        const form = $('#modalRoot form'), input = $('#actualReturn');
        if (typeof flatpickr === 'function' && typeof confirmDatePlugin === 'function') {
            input.type = 'text';
            flatpickr(input, {enableTime:true, dateFormat:'Y-m-d\\TH:i', altInput:true, altFormat:'M j, Y - h:i K', defaultDate:val, minDate:fmtDateTimeInput(r.start), maxDate:val, minuteIncrement:1, disableMobile:true, closeOnSelect:false,
                plugins:[new confirmDatePlugin({confirmText:'Confirm date and time',confirmIcon:'',showAlways:true,theme:'dark'})],
                onChange:()=>updateOvertimePreview(form,id), onClose:()=>updateOvertimePreview(form,id)});
        }
        updateOvertimePreview(form,id);
    }
    function openRejectReservationModal(id) {
        const r = getReservation(id);
        if (!r)
            return;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Reject reservation</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.submitRejectReservation(event,'${r.id}')"><div class="modal-body stack">
        <p class="small muted">Provide a reason for rejecting this request. The customer will be notified.</p>
        <div class="field"><label class="field-label">Reason</label><textarea name="reason" class="textarea" rows="3" required placeholder="e.g. Incomplete requirements or unavailable dates"></textarea></div>
      </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-danger-solid">Reject reservation</button></div></form></div>`);
    }
    function openRejectPaymentModal(pid) {
        const p = state.payments.find(x => x.id === pid);
        if (!p)
            return;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Reject payment proof</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.submitRejectPayment(event,'${pid}')"><div class="modal-body stack">
        <p class="small muted">Provide a reason for rejecting this payment proof.</p>
        <div class="field"><label class="field-label">Reason</label><textarea name="reason" class="textarea" rows="3" required placeholder="e.g. Reference number not readable"></textarea></div>
      </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-danger-solid">Reject payment</button></div></form></div>`);
    }
    function openResolveLogModal(id) {
        const l = state.maintenanceLogs.find(x => x.id === id);
        if (!l)
            return;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Resolve log entry</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <form onsubmit="App.submitResolveLog(event,'${id}')"><div class="modal-body stack">
        <p class="small muted"><strong>${esc(l.title)}</strong> — enter the final cost and mark this entry as resolved.</p>
        <div class="field"><label class="field-label">Final cost (PHP)</label><input name="cost" type="number" min="0" class="input" value="${Number(l.cost || 0)}" required></div>
      </div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Mark resolved</button></div></form></div>`);
    }
    function openPaymentModal(pid) {
        const p = state.payments.find(x => x.id === pid);
        if (!p)
            return;
        const r = getReservation(p.reservationId);
        const v = r ? getVehicle(r.vehicleId) : null;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Payment proof</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <div class="modal-body stack">
        <div class="kv"><div class="k">Customer</div><div class="v">${esc(r ? r.customerName : '—')}</div><div class="k">Vehicle</div><div class="v">${esc(v ? v.name : '—')}</div><div class="k">Method</div><div class="v">${esc(p.method)}</div><div class="k">Amount</div><div class="v">${fmtPHP(p.amount)}</div><div class="k">Status</div><div class="v">${statusBadge(p.status)}</div></div>
        <div class="proof-preview" style="min-height:160px;">${p.proofDataUrl ? `<img src="${p.proofDataUrl}" alt="Payment proof" style="max-height:360px;">` : `<span class="muted small">Proof on file</span>`}</div>
        ${p.rejectReason ? `<div class="callout danger small">Reason: ${esc(p.rejectReason)}</div>` : ''}
      </div>
      <div class="modal-footer">${p.status === 'pending' ? `<button class="btn btn-danger" onclick="App.openRejectPaymentModal('${p.id}')">Reject</button><button class="btn btn-primary" onclick="App.verifyPayment('${p.id}')">Verify payment</button>` : `<button class="btn" onclick="App.closeModal()">Close</button>`}</div></div>`);
    }
    function canAccessCustomer(c) {
        return !!c && (state.role === 'admin' || (state.role === 'customer' && currentCustomer()?.id === c.id));
    }
    const identityFields = { profileImage: 'Profile photograph', idImage: 'Government ID', licenseFront: 'Driver’s license — front', licenseBack: 'Driver’s license — back' };
    function identityStatus(c) {
        const d = c.identification || {};
        return d.verificationStatus === 'verified' && d.licenseExpiry < todayKey() ? 'expired' : (d.verificationStatus || 'not_submitted');
    }
    function identityBadge(c) {
        const s = identityStatus(c);
        return `<span class="status status-${s === 'verified' ? 'verified' : s === 'pending' ? 'pending' : s === 'not_submitted' ? 'neutral' : 'rejected'}">${esc(s.replaceAll('_', ' '))}</span>`;
    }
    function safeCustomerImage(src) {
        return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src || '') ? src : '';
    }
    function customerAvatar(c) {
        const src = safeCustomerImage(c.profileImage);
        return `<div style="width:42px;height:42px;flex:0 0 42px;border-radius:50%;overflow:hidden;background:var(--surface-alt);display:grid;place-items:center">${src ? `<img src="${src}" alt="Profile photo" style="width:100%;height:100%;object-fit:cover">` : esc(c.name.split(/\s+/).map(x => x[0]).slice(0,2).join(''))}</div>`;
    }
    function customerDocuments(c) {
        const d = c.identification || {};
        return `<div class="grid-2">${Object.entries(identityFields).map(([key,label]) => {
            const src = safeCustomerImage(key === 'profileImage' ? c.profileImage : d[key]);
            return `<div><div class="field-label">${label}</div><div class="proof-preview">${src ? `<a href="${src}" download="${key}.jpg"><img src="${src}" alt="${label}"></a>` : 'Not submitted'}</div></div>`;
        }).join('')}</div>`;
    }
    function editCustomerIdentity(id) {
        const c = getCustomer(id);
        if (!canAccessCustomer(c)) return;
        const d = c.identification || {};
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Edit customer profile</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div>
        <form onsubmit="App.saveCustomerIdentity(event,'${c.id}')"><div class="modal-body stack">
        <div class="callout">Demo only. Use fictional identification documents.</div>
        ${[['name','Full name','text',c.name],['email','Email','email',c.email],['phone','Phone','tel',c.phone],['idType','Government ID type','text',d.idType],['idNumber','Government ID number','text',d.idNumber],['licenseNumber','License number','text',d.licenseNumber],['licenseExpiry','License expiry','date',d.licenseExpiry]].map(([key,label,type,value]) => `<label class="field"><span class="field-label">${label}</span><input class="input" name="${key}" type="${type}" value="${esc(value || '')}" ${['name','email','phone'].includes(key) ? 'required' : ''}></label>`).join('')}
        ${Object.entries(identityFields).map(([key,label]) => `<label class="field"><span class="field-label">${label}</span><input class="input" type="file" name="${key}" accept="image/jpeg,image/png,image/webp"><span class="field-hint">Leave blank to retain current image. Maximum 5 MB.</span></label>`).join('')}
        ${customerDocuments(c)}</div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Save profile</button></div></form></div>`);
    }
    function readCustomerImage(file) {
        if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return Promise.reject(new Error('Use JPG, PNG or WEBP images up to 5 MB.'));
        return new Promise((resolve,reject) => {
            const reader = new FileReader();
            reader.onload = () => safeCustomerImage(reader.result) ? resolve(reader.result) : reject(new Error('Invalid image.'));
            reader.onerror = () => reject(new Error('Unable to read image.'));
            reader.readAsDataURL(file);
        });
    }
    function identityComplete(d) {
        return !!(d.idType && d.idNumber && d.idImage && d.licenseNumber && d.licenseFront && d.licenseBack && d.licenseExpiry >= todayKey());
    }
    async function saveCustomerIdentity(e,id) {
        e.preventDefault();
        const c = getCustomer(id);
        if (!canAccessCustomer(c)) return;
        const form = e.target;
        const btn = form.querySelector('button[type="submit"], button.btn-primary');
        if (btn.disabled) return;
        btn.disabled = true;
        try {
            const f = form.elements;
            const value = key => f.namedItem(key).value.trim();
            const d = {...c.identification};
            for (const key of ['idType','idNumber','licenseNumber','licenseExpiry']) d[key] = value(key);
            let profileImage = c.profileImage || '';
            for (const key of Object.keys(identityFields)) {
                const file = f.namedItem(key).files[0];
                if (!file) continue;
                const src = await readCustomerImage(file);
                if (key === 'profileImage') profileImage = src; else d[key] = src;
            }
            if (!canAccessCustomer(c) || !form.isConnected) return;
            const name = value('name'), email = value('email'), phone = value('phone');
            if (!name || !email || !phone) throw new Error('Complete your contact information.');
            if (state.customers.some(x => x.id !== id && x.email.toLowerCase() === email.toLowerCase())) throw new Error('Email already in use.');
            const changed = name !== c.name || ['idType','idNumber','licenseNumber','licenseExpiry','idImage','licenseFront','licenseBack'].some(k => d[k] !== c.identification?.[k]);
            if (changed) Object.assign(d,{verificationStatus: identityComplete(d) ? 'pending' : 'not_submitted', verifiedBy:null, verifiedAt:null, rejectionReason:''});
            const modified = [
                ...['name','email','phone'].filter(k => ({name,email,phone})[k] !== c[k]),
                ...['idType','idNumber','licenseNumber','licenseExpiry','idImage','licenseFront','licenseBack'].filter(k => d[k] !== c.identification?.[k]),
                ...(profileImage !== c.profileImage ? ['profileImage'] : [])
            ];
            Object.assign(c,{name,email,phone,profileImage,identification:d});
            if (modified.length) logActivity({module:'Customers',action:'Profile updated',entityId:id,description:id,link:'#/admin/customers',changes:modified.map(field=>({field,previousValue:'Not recorded for privacy',newValue:'Updated'}))});
            closeModal(); render(); toast('Customer profile saved.','success');
        } catch (err) { toast(err.message,'error'); } finally { btn.disabled = false; }
    }
    function reviewCustomerIdentity(id, approved) {
        if (state.role !== 'admin') return;
        const c = getCustomer(id), d = c?.identification;
        if (!d || d.verificationStatus !== 'pending') return;
        if (approved && !identityComplete(d)) return toast('Complete documents and a valid license are required.','error');
        const reason = approved ? '' : ($('#identityRejectReason')?.value || '').trim();
        if (!approved && !reason) return toast('Enter a rejection reason.','error');
        Object.assign(d,{verificationStatus:approved?'verified':'rejected', verifiedBy:approved?'Admin':null, verifiedAt:approved?new Date().toISOString():null,rejectionReason:reason});
        render(); openCustomerModal(id); toast('Identity review saved.','success');
    }
    function openCustomerModal(cid) {
        const c = getCustomer(cid);
        if (!canAccessCustomer(c))
            return;
        const mine = state.reservations.filter(r => r.customerId === c.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${esc(c.name)}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
      <div class="modal-body stack">
        <div style="display:flex;align-items:center;gap:12px">${customerAvatar(c)}${identityBadge(c)}<button class="btn btn-sm" onclick="App.editCustomerIdentity('${c.id}')">Edit profile</button></div>
        <div class="kv"><div class="k">ID type</div><div class="v">${esc(c.identification?.idType || '—')}</div><div class="k">ID number</div><div class="v">${esc(c.identification?.idNumber || '—')}</div><div class="k">License number</div><div class="v">${esc(c.identification?.licenseNumber || '—')}</div><div class="k">License expiry</div><div class="v">${esc(c.identification?.licenseExpiry || '—')}</div></div>
        ${customerDocuments(c)}
        ${c.identification?.rejectionReason ? `<div class="callout danger">${esc(c.identification.rejectionReason)}</div>` : ''}
        ${state.role === 'admin' && identityStatus(c) === 'pending' ? `<label class="field">Rejection reason<input id="identityRejectReason" class="input"></label><div class="btn-group"><button class="btn btn-primary" onclick="App.reviewCustomerIdentity('${c.id}',true)">Verify identity</button><button class="btn btn-danger" onclick="App.reviewCustomerIdentity('${c.id}',false)">Reject identity</button></div>` : ''}
        <div class="kv"><div class="k">Email</div><div class="v">${esc(c.email)}</div><div class="k">Phone</div><div class="v">${esc(c.phone)}</div><div class="k">Joined</div><div class="v">${fmtDateShort(c.joinedAt)}</div></div>
        <div><div class="section-title mb-2">Rental history</div>${mine.length ? `<table class="table"><thead><tr><th>Vehicle</th><th>Period</th><th>Amount</th><th>Status</th></tr></thead><tbody>${mine.map(r => {
            const v = getVehicle(r.vehicleId);
            return `<tr><td>${esc(v ? v.name : '')}</td><td class="small">${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}</td><td>${fmtPHP(r.totalFee + (r.overtimeFee || 0))}</td><td>${statusBadge(r.status)}</td></tr>`;
        }).join('')}</tbody></table>` : `<div class="small muted">No rentals recorded.</div>`}</div>
      </div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Close</button></div></div>`);
    }
    // ---------- Actions ----------
    function loginAs(role) {
        captureActivity();
        const previousRole = state.role;
        state.role = role;
        logActivity({module:'Authentication',action:previousRole ? 'Role switched' : 'Signed in',entityId:role,description:'Demo role selection',changes:[{field:'role',previousValue:previousRole,newValue:role}]});
        localStorage.setItem('vera_role', role);
        toast(`Signed in as ${role === 'admin' ? 'Administrator' : 'Customer'}.`, 'success');
        navigate(role === 'admin' ? '#/admin/dashboard' : '#/customer/vehicles');
    }
    function switchRole(role) {
        if (state.role === role)
            return;
        loginAs(role);
    }
    function searchVehicles(input) {
        const pos = input.selectionStart;
        state.ui.q = input.value;
        renderCustomerVehicles();
        const next = $('#vehicleSearch');
        if (next) {
            next.focus();
            next.setSelectionRange(pos, pos);
        }
    }
    function setUI(key, val) {
        state.ui[key] = val;
    }
    function render() {
        route();
    }
    function toggleNotifications(e) {
        if (e)
            e.stopPropagation();
        state.ui.notifOpen = !state.ui.notifOpen;
        renderChrome();
    }
    function closeNotifications() {
        state.ui.notifOpen = false;
        renderChrome();
    }
    function markAllRead() {
        state.notifications.forEach(n => {
            if (n.role === state.role)
                n.isRead = true;
        });
        toast('All notifications marked as read.', 'success');
        render();
    }
    function markNotifRead(id) {
        const n = state.notifications.find(x => x.id === id);
        if (n)
            n.isRead = true;
    }
    function updateFeePreview(vehicleId) {
        const form = $('#reqForm');
        if (!form) return;
        const start = form.start.value, end = form.end.value;
        const box = $('#feePreview'), msg = $('#conflictMsg'), summary = $('#rangeSummary'), review = $('#reviewSummary');
        const deposit = getDepositAmount();
        if (msg) msg.innerHTML = '';
        if (!start || !end) {
            if (box) { box.className = 'callout info small'; box.innerHTML = 'Select start and end dates to calculate the estimated fee.'; }
            if (summary) { summary.className = 'callout small muted'; summary.textContent = 'Select a date range to see duration.'; }
            if (review) { review.className = 'callout small muted'; review.textContent = 'Complete the steps above to review your booking.'; }
            return;
        }
        const sDate = new Date(start), eDate = new Date(end);
        if (!Number.isFinite(sDate.getTime()) || !Number.isFinite(eDate.getTime()) || eDate <= sDate) {
            const sameDay = Number.isFinite(sDate.getTime()) && Number.isFinite(eDate.getTime()) && start.slice(0,10) === end.slice(0,10);
            const msgTxt = sameDay ? 'For a same-day rental, return time must be later than pickup time.' : 'End date/time must be after start date/time.';
            if (box) { box.className = 'callout danger small'; box.innerHTML = msgTxt; }
            if (review) { review.className = 'callout small muted'; review.textContent = 'Fix the selected times to review your booking.'; }
            const submit = form.querySelector('button[type="submit"]');
            if (submit) submit.disabled = true;
            return;
        }
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = !bookingHasLicense(currentCustomer());
        const { days, total } = computeFee(vehicleId, start, end);
        const grand = total + deposit;
        if (summary) {
            summary.className = 'callout small';
            summary.innerHTML = `<strong>Selected range:</strong> ${fmtDateShort(start)} – ${fmtDateShort(end)} • ${days} day(s)`;
        }
        if (box) {
            box.className = 'callout small';
            box.innerHTML = `
              <div class="kv">
                <div class="k">Rental fee</div><div class="v">${days} day(s) × ${fmtPHP(getVehicle(vehicleId)?.ratePerDay||0)} = <strong>${fmtPHP(total)}</strong></div>
                <div class="k">Security deposit</div><div class="v">${fmtPHP(deposit)} <span class="muted">(Refundable)</span></div>
                <div class="k"><strong>Total to prepare</strong></div><div class="v"><strong>${fmtPHP(grand)}</strong></div>
              </div>
              <div class="small muted mt-2">Overtime, if any, is calculated at return. <button type="button" class="link-btn" onclick="App.openOvertimeRulesModal()">Overtime rules</button></div>`;
        }
        if (review) {
            const dm = form.deliveryMethod?.value || 'Not selected';
            review.className = 'callout small';
            review.innerHTML = `<div class="kv"><div class="k">Vehicle</div><div class="v">${esc(getVehicle(vehicleId)?.name||'-')}</div><div class="k">Dates</div><div class="v">${fmtDateShort(start)} ${esc(form.pickupTime?.value||'')} – ${fmtDateShort(end)} ${esc(form.returnTime?.value||'')}</div><div class="k">Delivery</div><div class="v">${esc(dm)}</div><div class="k">Total to prepare</div><div class="v"><strong>${fmtPHP(grand)}</strong> (${fmtPHP(total)} rental + ${fmtPHP(deposit)} refundable deposit)</div></div>`;
        }
        const conflict = hasConflict(vehicleId, start, end);
        if (conflict.conflict && msg)
            msg.innerHTML = `<div class="callout danger small mt-2"><strong>Dates unavailable.</strong> ${esc(conflict.reason || 'This vehicle is already booked for the selected period.')}</div>`;
    }
    function submitReservation(e, vehicleId) {
        e.preventDefault();
        if (state.role !== 'customer') return;
        if (state.reservations.some(r => ownsReservation(r) && r.status === 'completed' && ['unpaid','pending','rejected'].includes(overtimeStatus(r)))) return toast('Settle outstanding overtime before requesting another rental.', 'error');
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        if (btn && btn.disabled) return;
        const cust = currentCustomer();
        if (!cust) { toast('No customer account selected.', 'error'); return; }
        if (!bookingHasLicense(cust)) { toast('Upload your LTO license (Restriction Code A/A1) in Account before submitting.', 'error'); return; }
        const startVal = form.start.value, endVal = form.end.value;
        const deliveryMethod = form.deliveryMethod ? form.deliveryMethod.value : '';
        const trackingConsentAccepted = !!form.trackingConsent?.checked;
        if (!startVal || !endVal) { toast('Please select start and end dates.', 'error'); return; }
        if (!DELIVERY_METHODS.includes(deliveryMethod)) { toast('Please select a delivery method.', 'error'); form.deliveryMethod?.focus(); return; }
        if (!trackingConsentAccepted) { toast('Please agree to GPS tracking consent to continue.', 'error'); form.trackingConsent?.focus(); return; }
        const start = new Date(startVal).toISOString(), end = new Date(endVal).toISOString();
        if (!Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime()) || new Date(end) <= new Date(start)) {
            const sameDay = (form.start.value||'').slice(0,10) === (form.end.value||'').slice(0,10);
            toast(sameDay ? 'For a same-day rental, return time must be later than pickup time.' : 'End date must be after start date.', 'error');
            updateFeePreview(vehicleId); return;
        }
        const conflict = hasConflict(vehicleId, start, end);
        if (conflict.conflict) {
            const msg = $('#conflictMsg');
            if (msg) msg.innerHTML = `<div class="callout danger small"><strong>Dates unavailable.</strong> ${esc(conflict.reason || '')}</div>`;
            toast('Selected dates overlap an existing booking.', 'error'); return;
        }
        if (btn) btn.disabled = true;
        const { total } = computeFee(vehicleId, start, end);
        const r = { id: uid('r'), vehicleId, customerId: cust.id, customerName: cust.name, customerEmail: cust.email, start, end, actualReturn: null, status: 'pending', totalFee: total, overtimeFee: 0, createdAt: new Date().toISOString(), approvedBy: null, rejectReason: '', adminNotes: '', deliveryMethod, trackingConsent: { accepted: true, at: new Date().toISOString() } };
        setTimeout(() => {
            state.reservations.unshift(r);
            notify('admin', 'New reservation request', `${cust.name} requested ${getVehicle(vehicleId)?.name || 'a vehicle'}.`, `#/admin/reservation/${r.id}`);
            toast('Request submitted. Please wait for admin approval. You will be notified.', 'success');
            navigate(`#/customer/reservation/${r.id}`);
        }, 300);
    }
    function confirmCancelReservation(id) {
        openConfirm({ title: 'Cancel reservation request', body: `<p class="small muted">Cancel this pending reservation request? This action cannot be undone.</p>`, confirmLabel: 'Cancel request', danger: true, onConfirm: () => {
                closeModal();
                customerCancel(id);
            } });
    }
    function submitCancelReservation(e, id) {
        e.preventDefault();
        const reason = e.target.reason ? e.target.reason.value : '';
        customerCancel(id, reason);
    }
    function customerCancel(id, reason) {
        const r = getReservation(id);
        if (!r || r.status !== 'pending' || !ownsReservation(r))
            return;
        r.status = 'cancelled';
        r.cancelReason = (reason || 'Cancelled by customer').trim();
        notify('admin', 'Reservation cancelled', `${r.customerName} cancelled a pending request.`, '#/admin/reservations');
        toast('Reservation cancelled.', 'info');
        render();
    }
    function previewProof(input) {
        const file = input.files && input.files[0];
        const box = $('#proofPreview');
        if (!box)
            return;
        if (input.dataset.previewUrl) {
            try {
                URL.revokeObjectURL(input.dataset.previewUrl);
            }
            catch (_) { }
            delete input.dataset.previewUrl;
        }
        if (!file) {
            box.innerHTML = '<span class="muted small">No image selected</span>';
            return;
        }
        const url = URL.createObjectURL(file);
        input.dataset.previewUrl = url;
        box.innerHTML = `<img src="${url}" alt="Payment proof preview">`;
    }
    function submitPayment(e, reservationId) {
        e.preventDefault();
        const r = getReservation(reservationId);
        if (!r || r.status !== 'approved' || !ownsReservation(r) || ['pending', 'verified'].includes(getPaymentByReservation(reservationId)?.status))
            return;
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        if (btn && btn.disabled)
            return;
        const method = form.elements.namedItem('method').value;
        const amount = Number(form.amount.value || r.totalFee);
        const file = form.proof.files && form.proof.files[0];
        if (!file || !file.type.startsWith('image/')) {
            toast('Please select a proof image.', 'error');
            return;
        }
        if (!Number.isFinite(amount) || amount < 1) {
            toast('Please enter a valid amount.', 'error');
            return;
        }
        if (btn)
            btn.disabled = true;
        const proofDataUrl = URL.createObjectURL(file);
        setTimeout(() => {
            const existing = getPaymentByReservation(reservationId);
            if (existing) {
                Object.assign(existing, { method, amount, status: 'pending', submittedAt: new Date().toISOString(), proofDataUrl, rejectReason: '', verifiedBy: null });
            }
            else {
                state.payments.unshift({ id: uid('p'), reservationId, paymentType: 'rental', method, amount, proofEmoji: 'receipt', proofDataUrl, status: 'pending', submittedAt: new Date().toISOString(), verifiedBy: null, rejectReason: '' });
            }
            notify('admin', 'Payment proof submitted', `${r.customerName} submitted ${method} proof for ${getVehicle(r.vehicleId)?.name || 'a reservation'}.`, '#/admin/payments');
            captureActivity('customer', r.customerId);
            toast('Payment proof submitted for confirmation.', 'success');
            navigate(`#/customer/reservation/${reservationId}`);
        }, 300);
    }
    function approveReservation(id) {
        const r = getReservation(id);
        if (state.role !== 'admin' || !r || r.status !== 'pending') return;
        const customer = getCustomer(r.customerId);
        if (!customer || identityStatus(customer) !== 'verified' || !identityComplete(customer.identification)) {
            toast('Verify the customer identity and valid license before approving.', 'error');
            if (customer) openCustomerModal(customer.id);
            return;
        }
        const conflict = hasConflict(r.vehicleId, r.start, r.end, r.id);
        if (conflict.conflict) {
            toast(conflict.reason, 'error');
            return;
        }
        r.status = 'approved';
        r.approvedBy = 'Admin';
        notify('customer', 'Reservation approved', `Your ${getVehicle(r.vehicleId)?.name || 'reservation'} was approved. You may now upload payment proof.`, '#/customer/reservations');
        toast('Reservation approved.', 'success');
        render();
    }
    function openRejectReservationModalAction(id) {
        openRejectReservationModal(id);
    }
    function submitRejectReservation(e, id) {
        e.preventDefault();
        const r = getReservation(id);
        if (!r || r.status !== 'pending')
            return;
        const reason = (e.target.reason.value || '').trim();
        if (!reason) {
            toast('Please provide a reason.', 'error');
            return;
        }
        r.status = 'rejected';
        r.rejectReason = reason;
        r.approvedBy = 'Admin';
        notify('customer', 'Reservation rejected', `Your ${getVehicle(r.vehicleId)?.name || 'reservation'} was rejected.`, '#/customer/reservations');
        closeModal();
        toast('Reservation rejected.', 'info');
        render();
    }
    // compatibility: if called directly
    function rejectReservation(id) {
        openRejectReservationModal(id);
    }
    function startRental(id) {
        const r = getReservation(id);
        if (!r || r.status !== 'approved')
            return;
        openConfirm({ title: 'Start rental', body: `<p class="small muted">Mark this reservation as ongoing? The vehicle will be set to <strong>Rented</strong>.</p>`, confirmLabel: 'Start rental', onConfirm: () => {
                closeModal();
                const vehicle = getVehicle(r.vehicleId);
                if (r.status !== 'approved' || !vehicle || ['maintenance', 'malfunction', 'rented'].includes(vehicle.status) || reservationsForVehicle(r.vehicleId).some(x => x.id !== r.id && x.status === 'ongoing')) {
                    toast('Vehicle is not available for release.', 'error');
                    return;
                }
                if (getPaymentByReservation(r.id)?.status !== 'verified') {
                    toast('Verify payment before starting the rental.', 'error');
                    return;
                }
                r.status = 'ongoing';
                const v = getVehicle(r.vehicleId);
                if (v)
                    v.status = 'rented';
                notify('customer', 'Rental started', `Your rental for ${v ? v.name : 'the vehicle'} is now ongoing.`, '#/customer/reservations');
                toast('Rental marked as ongoing.', 'success');
                render();
            } });
    }
    function completeRental(e, id) {
        e.preventDefault();
        const r = getReservation(id);
        if (state.role !== 'admin' || !r || r.status !== 'ongoing')
            return;
        const val = e.target.actualReturn.value;
        if (!val) {
            toast('Please enter the actual return time.', 'error');
            return;
        }
        const parsed = new Date(val + '+08:00');
        if (!Number.isFinite(parsed.getTime())) return toast('Invalid return time.', 'error');
        const actual = parsed.toISOString();
        if (new Date(actual) < new Date(r.start) || new Date(actual) > new Date()) {
            toast('Return time must be between the rental start and now.', 'error');
            return;
        }
        const cleaning = !!e.target.elements.cleaningFee?.checked;
        const refuelingFee = Math.max(0, Number(e.target.elements.refuelingFee?.value) || 0);
        const ot = computeOvertime(r.vehicleId, r.end, actual, { cleaning, refuelingFee });
        const override = e.target.elements.finalFee.value;
        const late = parsed > new Date(r.end);
        const finalFee = !late || override === '' ? ot.fee : Number(override);
        const reason = late ? e.target.elements.adjustmentReason.value.trim() : '';
        const reasonType = e.target.elements.refundReason?.value;
        const reasonNotes = e.target.elements.refundNotes?.value.trim() || '';
        if (parsed < new Date(r.end) && (!['early_return','vehicle_defect','customer_damage','service_issue'].includes(reasonType) || (reasonType !== 'early_return' && !reasonNotes))) return toast('Select a refund reason and provide assessment notes.', 'error');
        const refund = {...computeEarlyRefund(r, actual, reasonType), reasonNotes};
        if (refund.unusedDays && !refund.paid) return toast('Verify the original rental payment before assessing a refund.', 'error');
        if (!Number.isFinite(finalFee) || finalFee < 0 || !Number.isFinite(refuelingFee) || refuelingFee < 0 || (finalFee !== ot.fee && !reason)) return toast('Enter a valid fee and a reason for any adjustment.', 'error');
        r.status = 'completed';
        r.actualReturn = actual;
        r.refund = parsed < new Date(r.end) ? {...refund, status:refund.amount > 0 ? 'pending' : 'not_applicable', assessedBy:'Admin', assessedAt:new Date().toISOString()} : null;
        r.overtimeFee = finalFee;
        r.overtime = { hours:ot.hours, ratePerHour:getVehicle(r.vehicleId)?.ratePerHour || 0, baseFee:ot.baseFee, cleaningFee:ot.cleaningFee, refuelingFee:ot.refuelingFee, calculatedFee:ot.fee, finalFee, tierLabel:ot.tierLabel, fullDayApplied:ot.fullDayApplied, adjustmentReason:reason, assessedBy:'Admin', assessedAt:new Date().toISOString(), paymentStatus:finalFee > 0 ? 'unpaid' : 'not_applicable' };
        const v = getVehicle(r.vehicleId);
        if (v && v.status === 'rented') {
            const openLogs = state.maintenanceLogs.filter(log => log.vehicleId === v.id && log.status === 'open');
            v.status = openLogs.some(log => log.type === 'incident') ? 'malfunction' : openLogs.length ? 'maintenance' : 'available';
        }
        const cust = getCustomer(r.customerId);
        if (cust)
            cust.totalRentals = (cust.totalRentals || 0) + 1;
        notify('customer', 'Rental completed', `Your rental for ${v ? v.name : 'the vehicle'} is completed.${finalFee ? ' Outstanding overtime: ' + fmtPHP(finalFee) + '.' : ''}${r.refund?.amount ? ' Refund due: ' + fmtPHP(r.refund.amount) + '.' : ''}`, `#/customer/reservation/${r.id}`, r.customerId);
        closeModal();
        toast('Rental completed.', 'success');
        render();
    }
    function verifyPayment(pid) {
        if (state.role !== 'admin') return;
        const p = state.payments.find(x => x.id === pid);
        if (!p)
            return;
        if (p.status !== 'pending')
            return;
        openConfirm({ title: 'Verify payment', body: `<p class="small muted">Confirm that this payment proof has been checked and verified?</p>`, confirmLabel: 'Verify payment', onConfirm: () => {
                if (state.role !== 'admin' || p.status !== 'pending') return;
                const reservation = getReservation(p.reservationId);
                if (p.paymentType === 'overtime' && (!reservation || p.amount !== reservation.overtimeFee)) return toast('Overtime amount does not match the charge.', 'error');
                closeModal();
                p.status = 'verified';
                p.verifiedAt = new Date().toISOString();
                if (p.paymentType === 'overtime' && reservation.overtime) reservation.overtime.paymentStatus = 'paid';
                p.verifiedBy = 'Admin';
                p.rejectReason = '';
                const r = getReservation(p.reservationId);
                if (r)
                    notify('customer', p.paymentType === 'overtime' ? 'Overtime payment verified' : 'Payment verified', `Your payment for ${getVehicle(r.vehicleId)?.name || 'your reservation'} has been verified.`, `#/customer/reservation/${r.id}`, r.customerId);
                toast('Payment verified.', 'success');
                render();
            } });
    }
    function submitRejectPayment(e, pid) {
        e.preventDefault();
        if (state.role !== 'admin') return;
        const p = state.payments.find(x => x.id === pid);
        if (!p || p.status !== 'pending')
            return;
        const reason = (e.target.reason.value || '').trim();
        if (!reason) {
            toast('Please provide a reason.', 'error');
            return;
        }
        p.status = 'rejected';
        const reservation = getReservation(p.reservationId);
        if (p.paymentType === 'overtime' && reservation?.overtime) reservation.overtime.paymentStatus = 'rejected';
        p.rejectReason = reason;
        p.verifiedBy = 'Admin';
        const r = getReservation(p.reservationId);
        if (r)
            notify('customer', p.paymentType === 'overtime' ? 'Overtime payment rejected' : 'Payment rejected', `Your payment proof was rejected. Reason: ${reason}`, `#/customer/reservation/${r.id}`, r.customerId);
        closeModal();
        toast('Payment rejected.', 'info');
        render();
    }
    function rejectPayment(pid) {
        openRejectPaymentModal(pid);
    }
    function changeVehicleStatus(id, status) {
        const v = getVehicle(id);
        if (!v || v.status === status)
            return;
        setVehicleStatus(id, status);
    }
    function setVehicleStatus(id, status) {
        const v = getVehicle(id);
        if (!v || !['available', 'rented', 'maintenance', 'malfunction'].includes(status))
            return;
        if (status === 'available' && (reservationsForVehicle(id).some(r => r.status === 'ongoing') || state.maintenanceLogs.some(l => l.vehicleId === id && l.status === 'open'))) {
            toast('Resolve active rentals or maintenance before marking available.', 'error');
            render();
            return;
        }
        v.status = status;
        toast(`${v.name} status updated to ${status}.`, 'success');
        render();
    }
    function saveVehicle(e, id) {
        e.preventDefault();
        const f = e.target;
        const data = {
            name: f.elements.namedItem('name').value.trim(), displacement: f.elements.namedItem('displacement').value, brand: f.brand.value.trim(), model: f.model.value.trim(),
            year: Number(f.year.value), plateNumber: f.plateNumber.value.trim(),
            ratePerDay: Number(f.ratePerDay.value), ratePerHour: Number(f.ratePerHour.value),
            color: f.color.value.trim(), seats: Number(f.seats.value || 2), transmission: f.transmission.value,
            tracker: {
                deviceId: f.elements.namedItem('trackerDeviceId')?.value.trim() || '',
                enabled: f.elements.namedItem('trackerEnabled')?.value !== 'false',
                lastSeenAt: (id ? getVehicle(id)?.tracker?.lastSeenAt : null) || null
            }
        };
        if (!Object.hasOwn(DISPLACEMENT_CLASSES, data.displacement)) {
            toast('Select a valid displacement class.', 'error');
            return;
        }
        if (state.vehicles.some(v => v.id !== id && String(v.plateNumber).trim().toUpperCase() === data.plateNumber.toUpperCase())) {
            toast('Plate number already exists.', 'error');
            return;
        }
        if (!data.name || !data.plateNumber || !data.brand || !data.model) {
            toast('Please complete required fields.', 'error');
            return;
        }
        if (id) {
            const v = getVehicle(id);
            const prevTracker = v?.tracker ? { ...v.tracker } : null;
            Object.assign(v, data);
            if (JSON.stringify(prevTracker) !== JSON.stringify(v.tracker)) {
                logActivity({module:'Vehicles',action:'Tracker updated',entityId:id,description:v.name,link:'#/admin/vehicles',changes:[{field:'tracker.enabled',previousValue:prevTracker?.enabled,newValue:v.tracker?.enabled},{field:'tracker.deviceId',previousValue:prevTracker?.deviceId,newValue:v.tracker?.deviceId}]});
            }
            toast('Vehicle updated.', 'success');
        }
        else {
            state.vehicles.unshift({ id: uid('v'), status: 'available', imageEmoji: '', ...data });
            toast('Vehicle added.', 'success');
        }
        closeModal();
        render();
    }
    function refreshMaintenanceStatus(vehicleId) {
        const vehicle = getVehicle(vehicleId);
        if (!vehicle) return;
        const open = state.maintenanceLogs.filter(log => log.vehicleId === vehicleId && log.status === 'open');
        if (open.some(log => log.type === 'incident')) vehicle.status = 'malfunction';
        else if (open.length) vehicle.status = 'maintenance';
        else if (['maintenance', 'malfunction'].includes(vehicle.status)) {
            vehicle.status = reservationsForVehicle(vehicleId).some(r => r.status === 'ongoing') ? 'rented' : 'available';
        }
    }

    function saveMaintenance(e, id) {
        e.preventDefault();
        if (state.role !== 'admin') return;
        const f = e.target.elements;
        const existing = id ? state.maintenanceLogs.find(log => log.id === id) : null;
        if (id && !existing) return;
        const data = {
            vehicleId: f.namedItem('vehicleId').value,
            type: f.namedItem('type').value,
            damageLocation: f.namedItem('damageLocation').value,
            title: f.namedItem('title').value.trim(),
            description: f.namedItem('description').value.trim(),
            cost: Number(f.namedItem('cost').value),
            photos: photoDraft.slice()
        };
        if (!getVehicle(data.vehicleId) || !data.title || !data.description || !Number.isFinite(data.cost) || data.cost < 0 || !Object.hasOwn(DAMAGE_LOCATIONS, data.damageLocation) || !['maintenance','incident'].includes(data.type)) {
            toast('Please check all required fields.', 'error');
            return;
        }
        if (existing) {
            const oldVehicleId = existing.vehicleId;
            Object.assign(existing, data, { updatedAt: new Date().toISOString() });
            if (existing.status === 'open') {
                refreshMaintenanceStatus(oldVehicleId);
                refreshMaintenanceStatus(data.vehicleId);
            }
        } else {
            state.maintenanceLogs.unshift({ id: uid('m'), ...data, status: 'open', reportedAt: new Date().toISOString(), resolvedAt: null });
            refreshMaintenanceStatus(data.vehicleId);
            notify('admin', 'Log entry added', `${data.title} recorded for ${getVehicle(data.vehicleId).name}.`, '#/admin/maintenance');
        }
        closeModal();
        toast(existing ? 'Log updated.' : 'Log entry saved.', 'success');
        render();
    }

    function submitResolveLog(e, id) {
        e.preventDefault();
        if (state.role !== 'admin') return;
        const log = state.maintenanceLogs.find(item => item.id === id);
        const cost = Number(e.target.elements.namedItem('cost').value);
        if (!log || log.status !== 'open' || !Number.isFinite(cost) || cost < 0) return;
        Object.assign(log, { status: 'resolved', resolvedAt: new Date().toISOString(), cost });
        refreshMaintenanceStatus(log.vehicleId);
        closeModal();
        toast('Log marked as resolved.', 'success');
        render();
    }
    function resolveLog(id) {
        openResolveLogModal(id);
    }
    function saveAdminNotes(e, id) {
        if (e)
            e.preventDefault();
        const r = getReservation(id);
        if (!r)
            return;
        r.adminNotes = ($('#adminNotes')?.value || '').trim();
        toast('Note saved.', 'success');
    }
    // ---------- Audit trail (session-only, no document contents) ----------
    const auditFields = {
        vehicles: ['name','brand','model','year','plateNumber','displacement','ratePerDay','ratePerHour','status','color','seats','transmission'],
        reservations: ['vehicleId','customerId','start','end','actualReturn','status','totalFee','overtimeFee','deliveryMethod','approvedBy','rejectReason','cancelReason','adminNotes'],
        payments: ['reservationId','paymentType','method','amount','status','submittedAt','verifiedAt','verifiedBy','rejectReason'],
        maintenanceLogs: ['vehicleId','type','title','description','damageLocation','status','cost','reportedAt','resolvedAt','resolutionNotes','resolvedBy'],
        customers: ['totalRentals']
    };
    const auditModules = {vehicles:'Vehicles',reservations:'Reservations',payments:'Payments',maintenanceLogs:'Maintenance',customers:'Customers'};
    function auditSnapshot() {
        const result = new Map();
        function add(module, id, label, fields, link, target = id) {
            result.set(`${module}:${id}`, {module,id,label,fields,link,target});
        }
        const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj?.[k] ?? null]));
        for (const [collection, keys] of Object.entries(auditFields)) {
            for (const item of state[collection]) {
                const fields = pick(item, keys);
                const module = auditModules[collection];
                let link = `#/admin/${collection === 'maintenanceLogs' ? 'maintenance' : collection}`;
                if (collection === 'reservations') link = `#/admin/reservation/${item.id}`;
                if (collection === 'maintenanceLogs') fields.photoCount = (item.photos || []).length;
                if (collection === 'payments') fields.proofAttached = Boolean(item.proofDataUrl);
                if (collection === 'customers') {
                    Object.assign(fields, pick(item.identification, ['verificationStatus','verifiedBy','verifiedAt','rejectionReason','licenseExpiry']));
                    fields.profilePhotoAttached = Boolean(item.profileImage);
                    fields.documentsAttached = ['idImage','licenseFront','licenseBack'].filter(k => item.identification?.[k]).length;
                }
                add(module,item.id,item.title || item.name && collection === 'vehicles' && item.name || item.id,fields,link);
                if (collection === 'reservations') {
                    if (item.overtime) add('Overtime',item.id,item.id,pick(item.overtime,['hours','ratePerHour','calculatedFee','finalFee','adjustmentReason','paymentStatus','assessedBy','assessedAt']),link);
                    if (item.refund) add('Refunds',item.id,item.id,pick(item.refund,['reasonType','reasonNotes','unusedDays','rate','gross','deduction','amount','status','method','assessedAt','refundedAt','receivedAt','refundedBy']),link);
                }
            }
        }
        return result;
    }
    state.activityLogs = state.activityLogs || [];
    let auditBaseline = auditSnapshot();
    function logActivity(entry, actorRole = state.role, actorId = state.currentCustomerId) {
        const isAssistant = actorRole === 'assistant' || String(entry?.actorName || '').startsWith('AI Assistant');
        if (!isAssistant && !['admin','customer'].includes(actorRole)) return;
        const actorName = entry?.actorName || (actorRole === 'admin' ? 'Admin' : isAssistant ? 'AI Assistant' : `Customer (${actorId})`);
        const resolvedRole = isAssistant ? 'assistant' : actorRole;
        const resolvedId = actorRole === 'admin' ? 'demo-admin' : (actorId || state.currentCustomerId || 'unknown');
        state.activityLogs.unshift({id:uid('act'), actorRole: resolvedRole, actorId: resolvedId, actorName, createdAt:new Date().toISOString(), ...entry, actorName});
    }

    function captureActivity(actorRole = state.role, actorId = state.currentCustomerId) {
        const next = auditSnapshot();
        for (const key of new Set([...auditBaseline.keys(), ...next.keys()])) {
            const before = auditBaseline.get(key), after = next.get(key), item = after || before;
            const changes = Object.keys({...before?.fields,...after?.fields}).filter(k => (before?.fields[k] ?? null) !== (after?.fields[k] ?? null)).map(field => ({field,previousValue:before?.fields[field] ?? null,newValue:after?.fields[field] ?? null}));
            if (!changes.length && before && after) continue;
            const status = changes.find(c => ['status','verificationStatus','paymentStatus'].includes(c.field));
            const action = !before ? 'Created' : !after ? 'Removed' : status ? `Status: ${status.newValue}` : 'Updated';
            logActivity({module:item.module,entityId:item.id,description:item.label,link:item.link,action,changes},actorRole,actorId);
        }
        auditBaseline = next;
    }
    function filteredActivity() {
        const q = (state.ui.auditQuery || '').toLowerCase();
        return state.activityLogs.filter(l => (!state.ui.auditModule || l.module === state.ui.auditModule) && (!state.ui.auditDate || toManilaDateKey(l.createdAt) === state.ui.auditDate) && (!state.ui.auditAction || l.action === state.ui.auditAction) && `${l.module} ${l.action} ${l.entityId} ${l.description} ${l.actorName}`.toLowerCase().includes(q));
    }
    function adminOnly() { return state.role === 'admin'; }
    function scheduleDateInputToISO(value, endOfDay=false) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))) return null;
        const iso = `${value}T${endOfDay ? '23:59:59' : '00:00:00'}+08:00`;
        const d = new Date(iso);
        return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    function renderAdminSchedule() {
        if (!adminOnly()) { navigate('#/'); return; }
        const OPS_DAY = 86400000;
        const raw = state.ui.opsScheduleStart || todayKey();
        const baseDate = new Date(`${raw}T00:00:00+08:00`);
        const base = Number.isFinite(baseDate.getTime()) ? baseDate.getTime() : Date.parse(`${todayKey()}T00:00:00+08:00`);
        const start = toManilaDateKey(new Date(base).toISOString());
        state.ui.opsScheduleStart = start;
        const days = Number(state.ui.fleetDays) === 7 ? 7 : 14;
        const filter = state.ui.fleetVehicle || 'all';
        const kind = state.ui.fleetKind || 'all';
        const dates = Array.from({ length: days }, (_, i) => new Date(base + i * OPS_DAY).toISOString());
        const windowEnd = new Date(base + days * OPS_DAY).toISOString();
        const shift = (n) => toManilaDateKey(new Date(base + n * OPS_DAY).toISOString());
        const fleet = state.vehicles.filter(v => filter === 'all' || v.id === filter);
        const visibleReservations = state.reservations.filter(r => fleet.some(v => v.id === r.vehicleId) && ['pending','approved','ongoing','completed'].includes(r.status) && overlaps(dates[0], windowEnd, r.start, r.actualReturn || r.end));
        const visibleServices = (state.opsServices || []).filter(m => fleet.some(v => v.id === m.vehicleId) && m.status === 'scheduled' && overlaps(dates[0], windowEnd, m.start, m.end));
        const rows = fleet.map(v => {
            const cells = dates.map(d => {
                const key = toManilaDateKey(d);
                const cellEnd = new Date(Date.parse(d) + OPS_DAY).toISOString();
                const rs = kind !== 'service' ? visibleReservations.filter(r => r.vehicleId === v.id && overlaps(d, cellEnd, r.start, r.actualReturn || r.end)) : [];
                const ms = kind !== 'rental' ? visibleServices.filter(m => m.vehicleId === v.id && overlaps(d, cellEnd, m.start, m.end)) : [];
                const down = (state.maintenanceLogs || []).some(m => m.vehicleId === v.id && m.status === 'open' && Date.parse(m.reportedAt) <= Date.parse(cellEnd) && Date.parse(m.resolvedAt || '9999-12-31T23:59:59Z') >= Date.parse(d));
                const events = rs.map(r => {
                    const cls = r.status === 'pending' ? 'ops-pending' : r.status === 'completed' ? 'ops-completed' : 'ops-approved';
                    return `<a class="ops-event ${cls}" href="#/admin/reservation/${esc(r.id)}" title="${esc(r.id.toUpperCase() + ' ' + r.customerName)}">${esc(r.customerName.split(' ')[0])} <small>${esc(r.status)}</small></a>`;
                }).concat(ms.map(m => `<span class="ops-event ops-service" title="${esc(m.title||'Service')}">Service <small>${esc(m.status)}</small></span>`));
                return `<td class="${toManilaDateKey(d)===todayKey()?'fleet-today':''}"><div class="fleet-cell">${events.join('') || (down ? '<span class="ops-event ops-service">Maintenance</span>' : '<span class="ops-free">-</span>')}</div></td>`;
            }).join('');
            return `<tr><th scope="row"><div class="fleet-moto"><strong>${esc(v.brand + ' ' + v.name)}</strong><span class="muted small">${esc(v.plateNumber || '-')} · ${esc(v.status)}</span></div></th>${cells}</tr>`;
        });
        mount(`
            <div class="page-header">
              <div><h1 class="page-title">Fleet schedule</h1><p class="page-desc">Read-only dispatch calendar based on current reservations and maintenance. Manila time.</p></div>
            </div>
            <div class="metrics mb-3">
              <div class="metric"><div class="metric-label">Pending requests</div><div class="metric-value">${visibleReservations.filter(r=>r.status==='pending').length}</div></div>
              <div class="metric"><div class="metric-label">Approved / ongoing</div><div class="metric-value">${visibleReservations.filter(r=>['approved','ongoing'].includes(r.status)).length}</div></div>
              <div class="metric"><div class="metric-label">Scheduled services</div><div class="metric-value">${visibleServices.length}</div></div>
              <div class="metric"><div class="metric-label">Motorcycles shown</div><div class="metric-value">${fleet.length}</div></div>
            </div>
            <div class="toolbar fleet-toolbar">
              <button class="btn" type="button" onclick="App.setUI('opsScheduleStart','${shift(-days)}');App.render()">Previous</button>
              <input class="input" type="date" aria-label="Schedule start" value="${esc(start)}" onchange="App.setUI('opsScheduleStart',this.value);App.render()">
              <button class="btn" type="button" onclick="App.setUI('opsScheduleStart','${todayKey()}');App.render()">Today</button>
              <button class="btn" type="button" onclick="App.setUI('opsScheduleStart','${shift(days)}');App.render()">Next</button>
              <select class="select" aria-label="Calendar range" onchange="App.setUI('fleetDays',this.value);App.render()"><option value="7" ${days===7?'selected':''}>7 days</option><option value="14" ${days===14?'selected':''}>14 days</option></select>
              <select class="select" aria-label="Motorcycle filter" onchange="App.setUI('fleetVehicle',this.value);App.render()"><option value="all">All motorcycles</option>${state.vehicles.map(v=>`<option value="${esc(v.id)}" ${v.id===filter?'selected':''}>${esc(v.brand + ' ' + v.name)} (${esc(v.plateNumber||'-')})</option>`).join('')}</select>
              <select class="select" aria-label="Event filter" onchange="App.setUI('fleetKind',this.value);App.render()">${[['all','All events'],['rental','Reservations'],['service','Service']].map(([k,l])=>`<option value="${k}" ${kind===k?'selected':''}>${l}</option>`).join('')}</select>
            </div>
            <div class="panel ops-calendar"><div class="table-wrap"><table class="table ops-fleet-table fleet-interactive" style="--fleet-days:${days}"><thead><tr><th scope="col">Motorcycle</th>${dates.map(d=>`<th scope="col" class="${toManilaDateKey(d)===todayKey()?'fleet-today':''}">${esc(new Date(d).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'short'}))}<strong>${esc(new Date(d).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}))}</strong></th>`).join('')}</tr></thead><tbody>${rows.join('') || '<tr><td colspan="'+(days+1)+'"><div class="empty">No motorcycles match this filter.</div></td></tr>'}</tbody></table></div></div>
            <div class="ops-legend mt-3"><span><i class="fleet-key ops-pending"></i>Pending</span><span><i class="fleet-key ops-approved"></i>Approved / ongoing</span><span><i class="fleet-key ops-completed"></i>Completed</span><span><i class="fleet-key ops-service"></i>Service / maintenance</span></div>
        `);
    }

    function renderActivityLog() {
        if (state.role !== 'admin') return;
        const list = filteredActivity();
        const options = (values, selected, label) => `<option value="">${label}</option>` + values.map(v => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
        mount(`<div class="page-header"><div><h1 class="page-title">Activity Log</h1><p class="page-desc">Administrative and customer changes recorded during this session.</p></div><button class="btn" onclick="App.exportActivity()">Export CSV</button></div>
          <div class="metrics mb-3"><div class="metric"><div class="metric-label">Actions today</div><div class="metric-value">${state.activityLogs.filter(l=>toManilaDateKey(l.createdAt)===todayKey()).length}</div></div><div class="metric"><div class="metric-label">Total recorded actions</div><div class="metric-value">${state.activityLogs.length}</div></div></div>
          <form class="toolbar" onsubmit="App.filterActivity(event)"><input class="input grow" name="query" placeholder="Search activities..." value="${esc(state.ui.auditQuery || '')}"><select class="select" name="module">${options([...new Set([...Object.values(auditModules),'Overtime','Refunds','Authentication','Reports'])],state.ui.auditModule,'All modules')}</select><select class="select" name="action">${options([...new Set(state.activityLogs.map(l=>l.action))],state.ui.auditAction,'All actions')}</select><input class="input" type="date" name="date" aria-label="Activity date" value="${esc(state.ui.auditDate || '')}"><button class="btn btn-primary">Filter</button></form>
          <div class="panel"><div class="panel-body flush"><div class="table-wrap"><table class="table"><thead><tr><th>Timestamp</th><th>Module</th><th>Action</th><th>Record</th><th>Actor</th><th></th></tr></thead><tbody>${list.map(l=>`<tr><td class="small">${fmtDate(l.createdAt,{time:true})}</td><td>${esc(l.module)}</td><td>${esc(l.action)}</td><td>${esc(l.description)}</td><td>${esc(l.actorName)}</td><td><button class="btn btn-sm" onclick="App.viewActivity('${l.id}')">Details</button></td></tr>`).join('')}</tbody></table></div>${list.length ? '' : '<div class="empty">No matching activity recorded yet.</div>'}</div></div>`);
    }
    function filterActivity(e) {
        e.preventDefault(); if (state.role !== 'admin') return;
        const f = e.target.elements;
        for (const k of ['query','module','action','date']) state.ui['audit'+k[0].toUpperCase()+k.slice(1)] = f.namedItem(k).value;
        renderActivityLog();
    }
    function viewActivity(id) {
        if (state.role !== 'admin') return;
        const l = state.activityLogs.find(x=>x.id===id); if (!l) return;
        const value = v => esc(v == null ? '—' : String(v));
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Activity details</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><div class="modal-body stack"><div class="kv">${Object.entries({Activity:l.id,Module:l.module,Action:l.action,Actor:l.actorName,Record:l.entityId,Timestamp:fmtDate(l.createdAt,{time:true})}).map(([k,v])=>`<div class="k">${esc(k)}</div><div class="v">${value(v)}</div>`).join('')}</div><div class="table-wrap"><table class="table"><thead><tr><th>Field</th><th>Previous</th><th>Updated</th></tr></thead><tbody>${l.changes.map(c=>`<tr><td>${esc(c.field)}</td><td style="overflow-wrap:anywhere">${value(c.previousValue)}</td><td style="overflow-wrap:anywhere">${value(c.newValue)}</td></tr>`).join('')}</tbody></table></div></div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Close</button>${l.link ? `<a class="btn btn-primary" href="${esc(l.link)}" onclick="App.closeModal()">View associated record</a>` : ''}</div></div>`);
    }
    function exportActivity() {
        if (state.role !== 'admin') return;
        const cell = v => { let s = String(v ?? ''); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
        const rows = [['Timestamp','Module','Action','Record','Actor','Field','Previous','Updated']];
        for (const l of filteredActivity()) for (const c of l.changes.length ? l.changes : [{}]) rows.push([l.createdAt,l.module,l.action,l.entityId,l.actorName,c.field,c.previousValue,c.newValue]);
        const url = URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
        const a = document.createElement('a'); a.href=url; a.download='vera-activity.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        logActivity({module:'Reports',action:'Activity CSV exported',entityId:'activity',description:'Activity log export',changes:[]}); renderActivityLog();
    }

    // ---------- Wiring ----------
    window.App = {
        filterActivity, viewActivity, exportActivity,
        loginAs, switchRole, goHome, setUI, searchVehicles, render, toggleNotifications, closeNotifications, markAllRead, markNotifRead,
        updateFeePreview, submitReservation, confirmCancelReservation, submitCancelReservation, customerCancel,
        previewProof, submitPayment,
        approveReservation, rejectReservation, openRejectReservationModal, submitRejectReservation,
        startRental, openCompleteModal, completeRental, updateOvertimePreview, openOvertimePayment, submitOvertimePayment,
        openPaymentModal, verifyPayment, rejectPayment, openRejectPaymentModal, submitRejectPayment, switchVehicleSlide,
        openVehicleModal, saveVehicle, setVehicleStatus, changeVehicleStatus,
        openMaintenanceModal, saveMaintenance, viewMaintenance, addMaintenancePhotos, removeMaintenancePhoto, resolveLog, openResolveLogModal, submitResolveLog,
        saveAdminNotes, openCustomerModal, editCustomerIdentity, saveCustomerIdentity, reviewCustomerIdentity, closeModal, _confirm: null,
        // Exposed for automated tests and inspection (no UI behavior change)
        DELIVERY_METHODS, getDeliveryMethod, getOvertimeSettings, overlaps, computeFee, computeOvertime, computeEarlyRefund, hasConflict, openRefundSelection, openAssessRefund, assessRefund, openRefundModal, recordRefund, acknowledgeRefund,
        getVehicle, getReservation, getCustomer, currentCustomer, reservationsForVehicle, notify, logActivity, captureActivity, uid,
        getTrackedVehicles: (...a)=>App.Tracking?.getTrackedVehicles?.(...a), isOverdue: (...a)=>App.Tracking?.isOverdue?.(...a), isNoSignal: (...a)=>App.Tracking?.isNoSignal?.(...a), addPing: (...a)=>App.Tracking?.addPing?.(...a),
        getDepositAmount, getNextStepBanner, nextStepBannerHTML, recommendByBudget, rangeCrossesBlocked, buildFlatpickrDisable, bookingHasLicense, getLicenseStatus, openOvertimeRulesModal
    };
    document.addEventListener('click', (e) => {
        const dd = $('#notifDropdown'), btn = $('#notifBtn');
        if (state.ui.notifOpen && dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
            state.ui.notifOpen = false;
            renderChrome();
        }
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('load', () => {
        const saved = localStorage.getItem('vera_role');
        if (['admin', 'customer'].includes(saved) && !state.role)
            state.role = saved;
        if (state.role && (!location.hash || location.hash === '#/' || location.hash === '#')) {
            navigate(state.role === 'admin' ? '#/admin/dashboard' : '#/customer/vehicles');
        }
        else {
            route();
        }
    });
})();








