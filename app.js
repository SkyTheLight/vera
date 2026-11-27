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
    // Operational occupancy is derived; mechanical condition is independently managed.
    function manualVehicleCondition(v) {
        if (!['available','maintenance','malfunction'].includes(v.manualCondition)) {
            const hasOpen = (state.maintenanceLogs || []).some(l => l.vehicleId === v.id && l.status === 'open');
            v.manualCondition = !hasOpen && ['maintenance','malfunction'].includes(v.status) ? v.status : 'available';
        }
        return v.manualCondition;
    }
    // An open record sets the minimum mechanical condition independently of a manual hold.
    function vehicleRecordCondition(v) {
        const logs = (state.maintenanceLogs || []).filter(l => l.vehicleId === v.id && l.status === 'open');
        return logs.some(l => l.type === 'incident') ? 'malfunction' : logs.length ? 'maintenance' : 'available';
    }
    function vehicleOperationalState(v, now = Date.now()) {
        const manual = manualVehicleCondition(v);
        const record = vehicleRecordCondition(v);
        const malfunction = manual === 'malfunction' || record === 'malfunction';
        const condition = malfunction ? 'malfunction' : manual === 'maintenance' || record === 'maintenance' ? 'maintenance' : 'available';
        const service = (state.opsServices || []).some(m => m.vehicleId === v.id && m.status === 'scheduled' && Date.parse(m.start) <= now && now < Date.parse(m.end));
        const rented = reservationsForVehicle(v.id).some(r => r.status === 'ongoing');
        const reserved = reservationsForVehicle(v.id).some(r => r.status === 'approved' && Date.parse(r.start) <= now && now < Date.parse(r.end));
        const maintenance = condition !== 'available' || service;
        const status = rented ? 'rented' : condition !== 'available' ? condition : service ? 'maintenance' : reserved ? 'reserved' : 'available';
        return {v, rented, reserved, malfunction, maintenance, service, condition, status, available:status === 'available'};
    }
    function syncVehicleStatus(v) {
        // Compatibility cache used by the existing assistant. Scheduled service is date-specific.
        const f = vehicleOperationalState(v);
        // Keep the public/legacy cache neutral for the customer assistant; admin uses the derived condition.
        v.status = f.rented ? 'rented' : f.condition !== 'available' ? 'maintenance' : f.reserved ? 'reserved' : 'available';
        return f;
    }
    function syncVehicleStatuses() { state.vehicles.forEach(syncVehicleStatus); }
    function isAdminVehicleView() { return state.role === 'admin' && location.hash.startsWith('#/admin/'); }
    function vehicleOperationalBadges(v, showOverdue = isAdminVehicleView()) {
        const f = vehicleOperationalState(v);
        const badges = [statusBadge(f.status, showOverdue)];
        if (showOverdue && reservationsForVehicle(v.id).some(r => rentalIsOverdue(r))) badges.push('<span class="status status-rejected">Overdue</span>');
        if (f.rented && f.condition !== 'available') badges.push(statusBadge(f.condition, showOverdue));
        else if (f.rented && f.service) badges.push(statusBadge('maintenance'));
        return `<div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px">${badges.join('')}</div>`;
    }
    function overlaps(aStart, aEnd, bStart, bEnd) {
        return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
    }
    // An overdue rental blocks today only for new bookings; physical release still requires its return.
    function rentalIsOverdue(r, now = Date.now()) {
        return r.status === 'ongoing' && Number.isFinite(Date.parse(r.end)) && Date.parse(r.end) <= now;
    }
    function reservationOccupancyEnd(r, now = Date.now()) {
        const nextDay = new Date(Date.parse(toManilaDateKey(new Date(now).toISOString()) + 'T00:00:00+08:00') + 86400000).toISOString();
        return rentalIsOverdue(r, now) ? nextDay : (r.status === 'completed' && r.actualReturn ? r.actualReturn : r.end);
    }
    function reservationOccupies(r, start, end, now = Date.now()) {
        return overlaps(start, end, r.start, reservationOccupancyEnd(r, now));
    }
    function hasConflict(vehicleId, start, end, excludeId) {
        const v = getVehicle(vehicleId);
        if (!v)
            return { conflict: true, reason: 'Vehicle not found.' };
        const condition = vehicleOperationalState(v).condition;
        if (condition !== 'available')
            return { conflict: true, reason: `Vehicle is currently marked as ${isAdminVehicleView() ? condition : 'maintenance'}.` };
        const blocking = reservationsForVehicle(vehicleId).filter(r => (r.status === 'approved' || r.status === 'ongoing') && r.id !== excludeId);
        const late = blocking.find(r => rentalIsOverdue(r) && reservationOccupies(r, start, end));
        if (late) return { conflict:true, reason: state.role === 'admin' && location.hash.startsWith('#/admin/') ? 'Motorcycle is awaiting return today. Choose a later date; release still requires the previous rental to be completed.' : 'This motorcycle is temporarily unavailable for the selected dates. Please choose another motorcycle.', conflictRes:late };
        for (const r of blocking) {
            if (reservationOccupies(r, start, end))
                return { conflict: true, reason: `Overlaps with an existing rental (${fmtDateShort(r.start)}–${fmtDateShort(r.end)}).`, conflictRes: r };
        }
        const service = (state.opsServices || []).find(m => m.vehicleId === vehicleId && m.status === 'scheduled' && overlaps(start,end,m.start,m.end));
        if (service) return { conflict:true, reason:`Overlaps scheduled service: ${service.title}.` };
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
    function statusBadge(status, revealFault = isAdminVehicleView()) {
        const labels = { pending: 'Pending', approved: 'Approved', ongoing: 'Ongoing', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected', available: 'Available', reserved: 'Reserved', rented: 'Rented', maintenance: 'Maintenance', malfunction: 'Malfunction', verified: 'Verified', open: 'Open', resolved: 'Resolved' };
        const s = status === 'malfunction' && !revealFault ? 'maintenance' : (status || 'neutral');
        return `<span class="status status-${esc(s === 'reserved' ? 'approved' : s)}">${esc(labels[s] || s)}</span>`;
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
        if (e) e.preventDefault();
        closeNotifications();
        closeModal();
        navigate('#/');
    }
    function dashboardHash() {
        return state.role === 'admin' ? '#/admin/dashboard' : '#/customer/vehicles';
    }
    function route() {
        syncVehicleStatuses();
        captureActivity();
        const parts = parseHash();
        state.ui.notifOpen = false;
        const [area, page, param, sub] = parts;
        if (!area) { renderChrome(); renderLanding(); return; }
        if (area === 'login' || area === 'register') { renderChrome(); renderAuthScreen(area); return; }
        if (!state.role) { navigate('#/'); return; }
        renderChrome();
        if (area !== state.role) {
            navigate(dashboardHash());
            return;
        }
        if (state.role === 'customer') routeCustomer(page, param, sub);
        else routeAdmin(page, param, sub);
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
            case 'account':
            case 'history': // Legacy links open the combined Account page.
                renderCustomerAccount();
                break;
            default: renderCustomerVehicles();
        }
    }
    function routeAdmin(page, param, sub) {
        if (state.role !== 'admin') { navigate('#/'); return; }
        switch (page) {
            case 'notifications':
                renderNotificationCenter();
                break;
            case 'dashboard':
                renderAdminDashboard();
                break;
            case 'map':
                if (state.role === 'admin') logActivity({module:'Tracking',action:'Viewed',entityId:'map',description:'Admin opened Live Map',link:'#/admin/map',changes:[]});
                if (App.Tracking?.renderMapPage) App.Tracking.renderMapPage(false); else mount('<div class="empty"><div class="empty-title">Map module unavailable</div></div>');
                break;
            case 'vehicles':
                renderAdminVehicles(param);
                break;
            case 'reservations':
                renderAdminReservations();
                break;
            case 'reservation':
                renderAdminReservationDetail(param);
                break;
            case 'payments':
                renderAdminPayments(param);
                break;
            case 'maintenance':
                renderAdminMaintenance();
                break;
            case 'schedule':
                renderAdminSchedule();
                break;
            case 'settings':
                renderAdminSettings();
                break;
            case 'reports':
                renderAdminReports();
                break;
            case 'activity':
                renderActivityLog();
                break;
            case 'customer':
                renderAdminCustomerProfile(param, sub);
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
              { href: '#/admin/activity', label: 'Activity Log' },
              { href: '#/admin/settings', label: 'Settings' }
          ];
      }

      return [
          { href: '#/customer/vehicles', label: 'Vehicles' },
          { href: '#/customer/reservations', label: 'Reservations' }
      ];
  }
    // The public landing page must not inherit the dashboard's constrained page width.
    function syncLandingViewport(active) {
        document.body.classList.toggle('vera-public-landing', active);
        if (document.getElementById('vera-landing-viewport-css')) return;
        const style = document.createElement('style');
        style.id = 'vera-landing-viewport-css';
        style.textContent = `
        body.vera-public-landing{margin:0!important;padding:0!important;width:100%;min-height:100vh;max-width:none!important}
        body.vera-public-landing #app,
        body.vera-public-landing #app>.app-body,
        body.vera-public-landing #main,
        body.vera-public-landing #appRoot{width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;padding:0!important;box-sizing:border-box!important;height:auto!important;max-height:none!important;overflow:visible!important}
        body.vera-public-landing #app{min-height:100vh}
        body.vera-public-landing #app>.app-body{display:block!important}
        body.vera-public-landing #topbar,
        body.vera-public-landing #sidebar,
        body.vera-public-landing #bottomNav{display:none!important}
        body.vera-public-landing .landing-page{width:100%!important;max-width:none!important;min-width:0;margin:0!important;padding:0!important;min-height:100vh;box-sizing:border-box}
        body.vera-public-landing .landing-page .landing-container{width:100%!important;max-width:none!important;margin:0 auto;box-sizing:border-box;padding-inline:clamp(16px,4vw,72px)}
        body.vera-public-landing .landing-page .landing-hero-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
        body.vera-public-landing .landing-page .landing-hero-grid>*{min-width:0}
        body.vera-public-landing .landing-page .landing-hero h1{max-width:100%;overflow-wrap:anywhere}
        @media(max-width:800px){body.vera-public-landing .landing-page .landing-hero-grid{grid-template-columns:minmax(0,1fr)}}
        `;
        document.head.appendChild(style);
    }
    function renderChrome() {
        const topbar = $('#topbar'), sidebar = $('#sidebar'), bottomNav = $('#bottomNav');
        const [area] = parseHash();
        const landingMode = !area;
        const loggedIn = !!state.role;
        syncLandingViewport(landingMode);
        $('#main').classList.toggle('main-landing', landingMode);
        $('#main').classList.toggle('main-auth', !loggedIn && !landingMode);
        topbar.classList.toggle('hidden', landingMode);
        sidebar.classList.toggle('hidden', landingMode || !loggedIn);
        bottomNav.classList.toggle('hidden', landingMode || !loggedIn);
        if (landingMode || !loggedIn) {
            $('#notifDropdown')?.classList.add('hidden');
            if (landingMode) return;
            return;
        }
        topbar.classList.remove('hidden');
        sidebar.classList.remove('hidden');
        bottomNav.classList.remove('hidden');
        $('#roleBtnCustomer').classList.toggle('active', state.role === 'customer');
        $('#roleBtnAdmin').classList.toggle('active', state.role === 'admin');
        const accountBtn = document.getElementById('accountBtn');
        if (accountBtn) {
            accountBtn.classList.toggle('hidden', state.role !== 'customer');
            accountBtn.classList.toggle('active', ['#/customer/account', '#/customer/history'].includes(location.hash));
             accountBtn.setAttribute('href', '#/customer/account');
             accountBtn.onclick = e => { e.preventDefault(); navigate('#/customer/account'); };
        }
        if (state.role === 'admin' && App.Tracking?.preloadLeaflet) { try { App.Tracking.preloadLeaflet(); } catch (_) {} }
        const items = navItems();
        const hash = location.hash || '#/';
        $('#sidebarNav').innerHTML = items.map(it => `<a href="${it.href}" class="nav-link ${(hash.startsWith(it.href) || (it.href==='#/admin/customers' && hash.startsWith('#/admin/customer/'))) ? 'active' : ''}"><span class="nav-dot"></span><span>${esc(it.label)}</span></a>`).join('');
        $('#bottomNavInner').innerHTML = items.map(it => `<a href="${it.href}" class="${(hash.startsWith(it.href) || (it.href==='#/admin/customers' && hash.startsWith('#/admin/customer/'))) ? 'active' : ''}"><span class="bn-dot"></span><span>${esc(it.label)}</span></a>`).join('');
        const roleNotifs = notificationInbox();
        const unread = roleNotifs.filter(n => !n.isRead).length;
        const badge = $('#notifBadge');
        if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');
        $('#notifViewAll').href = '#/'+state.role+'/notifications';
        $('#notifViewAll').onclick = e => {e.preventDefault(); ncViewAll();};
        $('#notifList').innerHTML = roleNotifs.length ? roleNotifs.slice(0, 6).map(n => `
      <a href="${esc(notificationDestination(n)||'#/'+state.role+'/notifications')}" class="notif-item ${n.isRead ? '' : 'unread'}" data-id="${esc(n.id)}" onclick="event.preventDefault(); App.ncOpen(this.dataset.id)">
        <div class="notif-item-title">${esc(n.title)}</div>
        <div class="notif-item-body">${esc(n.body)}</div>
        <div class="notif-item-time">${fmtDate(n.createdAt, { time: true })}</div>
      </a>`).join('') : `<div class="notif-item"><div class="notif-item-body">No notifications.</div></div>`;
        $('#notifDropdown').classList.toggle('hidden', !state.ui.notifOpen);
    }
    function mount(html) {
        const root = $('#appRoot') || $('#app');
        if (root)
            root.innerHTML = html;
        if (window.scrollTo) window.scrollTo({ top: 0 });
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
    function renderAuthScreen(mode) {
        const isRegister = mode === 'register';
        mount(`
      <div class="auth-wrap">
        <div class="auth-main">
          <div class="auth-box">
            <a href="#/" class="btn btn-ghost btn-sm" style="margin-bottom:12px;">← Back to home</a>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
              <span class="brand-mark" style="width:32px;height:32px;"><img src="images/Logo.png" alt="V.E.R.A. logo" class="brand-logo"></span>
              <div><div style="font-weight:600;font-size:16px;">V.E.R.A.</div><div class="muted small">Vehicle Enterprise Rental Assistant</div></div>
            </div>
            <h1 style="font-size:22px;font-weight:600;margin-bottom:6px;">${isRegister ? 'Create demo account' : 'Sign in to continue'}</h1>
            <p class="muted small" style="margin-bottom:20px;">${isRegister ? 'Prototype demo: choose a role to continue. No real account is created.' : 'Select a view to access the rental management workspace.'}</p>
            <div class="panel"><div class="panel-body"><div class="stack">
              <div><div class="field-label" style="margin-bottom:6px;">Customer view</div><p class="small muted" style="margin-bottom:8px;">Browse vehicles, check availability, and manage your reservations.</p><button class="btn btn-primary btn-block" onclick="App.loginAs('customer')">Continue as Customer</button></div>
              <div class="divider"></div>
              <div><div class="field-label" style="margin-bottom:6px;">Administrator view</div><p class="small muted" style="margin-bottom:8px;">Review requests, verify payments, and manage fleet operations.</p><button class="btn btn-block" onclick="App.loginAs('admin')">Continue as Administrator</button></div>
            </div></div></div>
            <p class="faint small" style="margin-top:14px;">Signed-in state is stored locally on this device for convenience.</p>
          </div>
        </div>
        <div class="auth-aside"><h2>Rental operations in one place</h2><p>Manage vehicle availability, reservations, payments, and maintenance records with clear status tracking.</p></div>
      </div>`);
    }

    // ---------- Landing ----------
    function landingLayoutStyles() {
        return `<style>
        .landing-page .landing-media{position:relative;overflow:hidden;display:block;padding:0;box-sizing:border-box;min-height:0;min-width:0}
        .landing-page .landing-media>img{display:block;width:100%;height:100%;object-fit:contain;object-position:center;background:#fff;position:static;margin:0}
        .landing-page .landing-media-fallback[hidden]{display:none!important}
        .landing-page .landing-media-fallback:not([hidden]){position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:var(--panel,#161b22);text-align:center}
        .landing-page .landing-hero-media{height:auto;aspect-ratio:16/10;border-radius:12px;background:#fff}
        .landing-page .landing-card-media{height:auto;aspect-ratio:16/10;background:#fff;border-radius:0}
        .landing-page #landing-promos .landing-promo-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:stretch;margin:0}
        .landing-page #landing-promos .landing-promo-card{display:flex;flex-direction:column;min-width:0;width:auto;max-width:none;margin:0;overflow:hidden;border-radius:10px}
        .landing-page #landing-promos .landing-promo-card>.panel-body{display:flex;flex-direction:column;align-items:flex-start;flex:1;gap:10px;padding:18px;min-width:0;overflow-wrap:anywhere}
        .landing-page #landing-promos .landing-promo-card h3{margin:0;font-size:17px;line-height:1.35}
        .landing-page #landing-promos .landing-promo-card p{margin:0;line-height:1.5}
        .landing-page #landing-promos .landing-promo-card .promo-description{flex:1}
        .landing-page #landing-promos .landing-promo-card .promo-validity{padding-top:12px;border-top:1px solid var(--border,#30363d);width:100%;box-sizing:border-box}
        .landing-page #landing-promos .landing-ads-title{margin:30px 0 12px;font-size:17px;font-weight:600}
        .landing-page #landing-promos .landing-ads-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin:0;align-items:stretch}
        .landing-page #landing-promos .landing-ad{grid-column:auto;min-width:0;margin:0;border-radius:10px;overflow:hidden}
        .landing-page #landing-promos .landing-ad-body{display:grid;grid-template-columns:minmax(0,38%) minmax(0,1fr);align-items:center;gap:16px;padding:16px;height:100%;box-sizing:border-box}
        .landing-page #landing-promos .landing-ad-media{width:100%;height:auto;min-height:0;max-width:none;aspect-ratio:16/10;border-radius:7px;background:#fff}
        .landing-page #landing-promos .landing-ad-body>div:last-child{min-width:0;overflow-wrap:anywhere}
        .landing-page #landing-promos .landing-ad h3{margin:6px 0;font-size:16px}
        .landing-page #landing-promos .landing-ad p{margin:0 0 8px;line-height:1.45}
        @media(max-width:950px){.landing-page #landing-promos .landing-promo-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:700px){.landing-page #landing-promos .landing-promo-row,.landing-page #landing-promos .landing-ads-grid{grid-template-columns:minmax(0,1fr)}}
        @media(max-width:380px){.landing-page #landing-promos .landing-ad-body{grid-template-columns:minmax(0,1fr)}}
        </style>`;
    }
    function landingImage(src, alt, cls, fallbackEmoji='🏍️', fallbackText='Image coming soon') {
        const safeSrc = esc(src || '');
        const safeAlt = esc(alt || '');
        const fb = esc(fallbackEmoji);
        const txt = esc(fallbackText);
        return `<div class="landing-media ${esc(cls||'')}">
          ${safeSrc ? `<img src="${safeSrc}" alt="${safeAlt}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.hidden=false;">` : ''}
          <div class="landing-media-fallback" ${safeSrc ? 'hidden' : ''}><span aria-hidden="true">${fb}</span><small>${txt}</small></div>
        </div>`;
    }
    function getLandingPromos() {
        const promos = Array.isArray(state.landing?.promos) ? state.landing.promos : [];
        const today = todayKey();
        return promos.filter(p => p && (!p.validUntil || String(p.validUntil).slice(0,10) >= today));
    }
    function getFeaturedLandingVehicles() {
        const count = Math.max(1, Number(state.landing?.featuredCount) || 4);
        const list = [...(state.vehicles || [])];
        list.sort((a,b) => {
            const av = ({available:0,rented:1,maintenance:2,malfunction:3}[String(a.status||'').toLowerCase()] ?? 9);
            const bv = ({available:0,rented:1,maintenance:2,malfunction:3}[String(b.status||'').toLowerCase()] ?? 9);
            return av - bv || (Number(a.ratePerDay)||0) - (Number(b.ratePerDay)||0);
        });
        return list.slice(0, count);
    }
    function scrollLandingTo(id) {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
    function toggleLandingMenu() {
        const menu = document.getElementById('landingNavLinks');
        const btn = document.getElementById('landingMenuBtn');
        if (!menu || !btn) return;
        const open = menu.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(open));
    }
    function dismissLandingBanner() { state.ui.landingBannerDismissed = true; renderLanding(); }
    function renderLanding() {
        try {
            const loggedIn = !!state.role;
            const continueHref = dashboardHash();
            const browseHref = state.role === 'customer' ? '#/customer/vehicles' : (state.role === 'admin' ? '#/admin/vehicles' : '#/login');
            const loginHref = '#/login';
            const signupHref = '#/register';
            const featured = getFeaturedLandingVehicles();
            const promos = getLandingPromos();
            const ads = Array.isArray(state.landing?.ads) ? state.landing.ads : [];
            const wideAd = ads.find(a => a.slot === 'wide') || ads[0] || null;
            const cardAd = ads.find(a => a !== wideAd && a.slot === 'card') || ads.find(a => a !== wideAd) || null;
            const deposit = getDepositAmount();
            const bannerHidden = !!state.ui.landingBannerDismissed;
            const faq = [
                ['Do I pay before approval?', 'No. Submit a request first. After admin approval, you upload GCash or Other payment proof. There is no in-app payment gateway in this prototype.'],
                ['How does the deposit work?', `A refundable security deposit of ${fmtPHP(deposit)} is shown in the booking estimate. Refund/adjustment is handled by admin in the prototype flow.`],
                ['What delivery options are available?', 'You can choose Guest Pickup & Guest Return, Guest Pickup & Host Collection, Host Delivery & Guest Return, or Host Delivery & Host Collection. Availability/schedule is confirmed in the rental flow.'],
                ['Is GPS tracking used?', 'Yes. GPS tracking consent is required during booking for ongoing rentals. Live map monitoring is an admin feature in this prototype.'],
                ['What happens if I return late?', 'Overtime is calculated at return using the configured overtime rules. You can review the overtime rules from the booking flow.'],
                ['What payment methods are accepted?', 'After approval, customers upload payment proof for GCash or Other/manual proof. Payment is verified by admin.']
            ];
            mount(`
      <div class="landing-page">
        ${landingLayoutStyles()}
        ${bannerHidden ? '' : `<div class="landing-banner" role="status"><div class="landing-container landing-banner-inner"><span><strong>Prototype notice:</strong> Promo details are shown for the prototype. Final price follows the booking estimate.</span><button class="icon-btn" aria-label="Dismiss announcement" onclick="App.dismissLandingBanner()">×</button></div></div>`}
        <header class="landing-header">
          <div class="landing-container landing-header-inner">
            <a class="landing-brand" href="#/" onclick="App.goHome(event)"><span class="brand-mark"><img src="images/Logo.png" alt="V.E.R.A. logo" class="brand-logo"></span><span><strong>V.E.R.A.</strong><small>Vehicle Enterprise Rental Assistant</small></span></a>
            <button id="landingMenuBtn" class="btn btn-ghost landing-menu-btn" type="button" aria-expanded="false" aria-controls="landingNavLinks" onclick="App.toggleLandingMenu()">Menu</button>
            <nav id="landingNavLinks" class="landing-nav-links" aria-label="Landing navigation">
              <button type="button" class="link-btn" onclick="App.scrollLandingTo('landing-hero')">Home</button>
              <button type="button" class="link-btn" onclick="App.scrollLandingTo('landing-vehicles')">Vehicles</button>
              <button type="button" class="link-btn" onclick="App.scrollLandingTo('landing-promos')">Promos</button>
              <button type="button" class="link-btn" onclick="App.scrollLandingTo('landing-how')">How it works</button>
              <button type="button" class="link-btn" onclick="App.scrollLandingTo('landing-faq')">FAQ</button>
              ${loggedIn ? `<a class="btn btn-primary btn-sm" href="${continueHref}">Continue to dashboard</a>` : `<a class="btn btn-ghost btn-sm" href="${loginHref}">Login</a><a class="btn btn-primary btn-sm" href="${signupHref}">Sign up</a>`}
            </nav>
          </div>
        </header>

        <section id="landing-hero" class="landing-hero">
          <div class="landing-container landing-hero-grid">
            <div>
              <p class="landing-eyebrow">Motorcycle rentals, managed clearly</p>
              <h1>Ride the right motorcycle with a clear, approval-first rental flow.</h1>
              <p class="landing-lead">V.E.R.A. helps customers browse motorcycles, request bookings, and track rental steps while admins handle approval, payment verification, and operations.</p>
              <div class="landing-cta-row">
                <button class="btn btn-primary" type="button" onclick="App.scrollLandingTo('landing-vehicles')">Browse vehicles</button>
                <button class="btn" type="button" onclick="App.scrollLandingTo('landing-how')">How it works</button>
              </div>
              <div class="landing-trust"><span>Admin approval before payment</span><span>GCash / Other proof upload</span><span>GPS consent for ongoing rentals</span></div>
            </div>
            <div class="landing-hero-media-wrap">${landingImage('images/vehicles/zx6r-2025-front-angle.jpg', 'Motorcycle rental hero image', 'landing-hero-media', '🏍️', 'Vehicle image')}</div>
          </div>
        </section>

        <section id="landing-vehicles" class="landing-section">
          <div class="landing-container">
            <div class="section-head"><div><p class="landing-eyebrow">Featured vehicles</p><h2>Popular motorcycles ready to request</h2></div><a class="btn btn-ghost btn-sm" href="${browseHref}">View all vehicles</a></div>
            <div class="landing-vehicle-grid">
              ${featured.map(v => {
                const avail = vehicleAvailabilityLabel(v);
                return `<article class="panel landing-card">
                  ${landingImage(v.imageUrl || v.imageUrlAlt || '', `${v.brand} ${v.name}`, 'landing-card-media', '🏍️', 'Vehicle image')}
                  <div class="panel-body">
                    <div class="landing-card-top"><div><h3>${esc(v.brand)} ${esc(v.name)}</h3><p class="muted small">${esc(String(v.displacement||''))}cc · ${esc(v.transmission||'Manual')}</p></div><span class="status ${avail.tone === 'success' ? 'status-available' : avail.tone === 'danger' ? 'status-malfunction' : 'status-pending'}">${esc(avail.label)}</span></div>
                    <div class="landing-price">${fmtPHP(v.ratePerDay)} <span class="muted small">/ day</span></div>
                    <a class="btn btn-primary btn-block" href="${state.role==='customer'?`#/customer/vehicle/${esc(v.id)}`:`#/login`}">View details</a>
                  </div>
                </article>`;
              }).join('') || '<div class="empty">No vehicles available.</div>'}
            </div>
          </div>
        </section>

        <section id="landing-promos" class="landing-section landing-section-alt">
          <div class="landing-container">
            <div class="section-head"><div><p class="landing-eyebrow">Promos</p><h2>Current offers and announcements</h2></div></div>
            <p class="small muted mb-3">Promo details are shown for the prototype. Final price follows the booking estimate.</p>
            <div class="landing-promo-row">
              ${promos.map(p => `<article class="panel landing-promo-card">
                ${landingImage(p.imageUrl, p.title, 'landing-card-media', '🎁', 'Promo image')}
                <div class="panel-body">
                  <span class="landing-badge">${esc(p.badge || 'Promo')}</span>
                  <h3>${esc(p.title)}</h3>
                  <p class="muted small promo-description">${esc(p.description || '')}</p>
                  <p class="small promo-validity"><strong>Valid:</strong> ${esc(fmtDateShort(p.validFrom))} – ${esc(fmtDateShort(p.validUntil))}</p>
                  <p class="faint small">Terms: ${esc(p.terms || 'Prototype display only.')}</p>
                </div>
              </article>`).join('') || '<div class="empty">No active promos.</div>'}
            </div>
            ${wideAd || cardAd ? '<h3 class="landing-ads-title">Partners &amp; sponsored offers</h3>' : ''}
            <div class="landing-ads-grid">
              ${wideAd ? `<article class="panel landing-ad"><div class="panel-body landing-ad-body">${landingImage(wideAd.imageUrl, wideAd.title, 'landing-ad-media', '📣', 'Ad image')}<div><span class="landing-sponsored">${esc(wideAd.label||'Sponsored')}</span><h3>${esc(wideAd.title||'Partner')}</h3><p class="muted small">${esc(wideAd.description||'Demo partner placement.')}</p><span class="faint small">${esc(wideAd.cta||'Demo content')}</span></div></div></article>` : ''}
              ${cardAd ? `<article class="panel landing-ad"><div class="panel-body landing-ad-body">${landingImage(cardAd.imageUrl, cardAd.title, 'landing-ad-media', '🤝', 'Ad image')}<div><span class="landing-sponsored">${esc(cardAd.label||'Partner')}</span><h3>${esc(cardAd.title||'Partner')}</h3><p class="muted small">${esc(cardAd.description||'Demo partner placement.')}</p><span class="faint small">${esc(cardAd.cta||'Demo content')}</span></div></div></article>` : ''}
            </div>
          </div>
        </section>

        <section id="landing-how" class="landing-section">
          <div class="landing-container">
            <div class="section-head"><div><p class="landing-eyebrow">How it works</p><h2>Simple rental flow</h2></div></div>
            <div class="landing-steps">
              ${[['1','Choose model','Browse motorcycles and check availability.'],['2','Pick dates & delivery','Select dates, times, and delivery option in the booking form.'],['3','Request (admin approval)','Submit your request and wait for admin approval.'],['4','Pay after approval','Upload GCash/Other payment proof after approval.'],['5','Pickup, return, deposit refund','Complete rental; overtime/deposit handled per prototype rules.']].map(s=>`<div class="panel landing-step"><div class="panel-body"><div class="landing-step-num">${s[0]}</div><h3>${s[1]}</h3><p class="muted small">${s[2]}</p></div></div>`).join('')}
            </div>
          </div>
        </section>

        <section id="landing-requirements" class="landing-section landing-section-alt">
          <div class="landing-container landing-two-col">
            <div class="panel"><div class="panel-body">
              <p class="landing-eyebrow">Requirements</p><h2>Before you book</h2>
              <ul class="landing-list">
                <li>LTO driver's license with Restriction Code A or A1.</li>
                <li>Valid government ID and complete account details.</li>
                <li>GPS tracking consent is required during booking.</li>
                <li>Admin approval is required before payment upload.</li>
              </ul>
            </div></div>
            <div class="panel"><div class="panel-body">
              <p class="landing-eyebrow">Pricing notes</p><h2>Clear estimate</h2>
              <ul class="landing-list">
                <li>Rental fee follows the booking estimate (${esc('App.computeFee')} formula).</li>
                <li>Refundable security deposit: <strong>${fmtPHP(deposit)}</strong> (from system settings).</li>
                <li>Total to prepare = rental fee + refundable deposit.</li>
                <li>Overtime is calculated at return. <button type="button" class="link-btn" onclick="App.openOvertimeRulesModal()">View overtime rules</button>.</li>
              </ul>
            </div></div>
          </div>
        </section>

        <section id="landing-faq" class="landing-section">
          <div class="landing-container">
            <div class="section-head"><div><p class="landing-eyebrow">FAQ</p><h2>Common questions</h2></div></div>
            <div class="landing-faq">
              ${faq.map(([q,a],i)=>`<details class="panel landing-faq-item" ${i===0?'open':''}><summary><span>${esc(q)}</span><span aria-hidden="true">+</span></summary><div class="landing-faq-body muted small">${esc(a)}</div></details>`).join('')}
            </div>
          </div>
        </section>

        <footer class="landing-footer">
          <div class="landing-container landing-footer-grid">
            <div><strong>V.E.R.A.</strong><p class="muted small">Vehicle Enterprise Rental Assistant</p><p class="faint small">Prototype for academic defense. Demo data only.</p></div>
            <div><div class="field-label">Contact</div><p class="small muted">Email: vera.rentals@example.com</p><p class="small muted">Phone: +63 900 000 0000</p><p class="small muted">Cainta, Rizal (placeholder)</p></div>
            <div><div class="field-label">Social</div><p class="small muted">Facebook · Instagram · TikTok (placeholders)</p></div>
          </div>
        </footer>
      </div>`);
            if (window.matchMedia && typeof IntersectionObserver === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                document.querySelectorAll('.landing-card,.landing-promo-card,.landing-step,.landing-faq-item,.landing-ad').forEach(el => {
                    el.classList.add('landing-fade');
                    const obs = new IntersectionObserver((entries,o)=>{ entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); o.unobserve(e.target); } }); }, {threshold:.12});
                    obs.observe(el);
                });
            }
        } catch (err) {
            console.error('Landing render failed', err);
            mount(`<div class="auth-wrap"><div class="auth-main"><div class="auth-box"><h1>V.E.R.A.</h1><p class="muted">The landing page encountered an issue.</p><div class="stack">${state.role ? `<a class="btn btn-primary" href="${dashboardHash()}">Continue to dashboard</a>` : `<a class="btn btn-primary" href="#/login">Login</a>`}</div></div></div></div>`);
        }
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
        const f = vehicleOperationalState(v);
        const label = f.status.charAt(0).toUpperCase() + f.status.slice(1);
        if (f.condition !== 'available') return {label: f.rented ? 'Rented · Maintenance' : 'Maintenance', tone:'warning', bookable:false};
        if (f.service) return {label:f.rented ? 'Rented · Service' : 'Scheduled service',tone:'warning',bookable:true};
        return {label,tone:f.available?'success':'warning',bookable:true};
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
            <p class="page-desc">Step 1: Choose a motorcycle. Rented motorcycles may be reserved for future dates, subject to availability.</p>
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
                    ? `<a class="btn btn-primary btn-block" href="#/customer/vehicle/${v.id}" data-ai-target="book-vehicle-${esc(v.id)}">${v.status === 'rented' ? 'Reserve future dates' : 'View details & reserve'}</a>`
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

    function isVehicleBookable(v) { return vehicleAvailabilityLabel(v).bookable; }
    function getBlockedRanges(vehicleId, excludeId) {
        return reservationsForVehicle(vehicleId)
            .filter(r => (r.status === 'approved' || r.status === 'ongoing') && r.id !== excludeId)
            .concat((state.opsServices || []).filter(m => m.vehicleId === vehicleId && m.status === 'scheduled'))
            .map(r => { const end = reservationOccupancyEnd(r); return { from: new Date(r.start), to: new Date(end), start: r.start, end, overdue: rentalIsOverdue(r) }; });
    }
    function rangeCrossesBlocked(start, end, blockedRanges) {
        const s = new Date(start), e = new Date(end);
        if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime()) || e <= s) return false;
        return (blockedRanges || []).some(b => overlaps(s, e, b.from, b.to));
    }
    function buildFlatpickrDisable(vehicleId, excludeId) {
        const blocked = getBlockedRanges(vehicleId, excludeId);
        const disable = blocked.map(b => ({ from: toManilaDateKey(b.start), to: toManilaDateKey(new Date(b.to.getTime() - 1).toISOString()) }));
        const v = getVehicle(vehicleId);
        if (v && vehicleOperationalState(v).condition !== 'available') disable.push(() => true);
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
    function licenseUploadTarget() { return '#/customer/account'; }

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

    // Customer booking workspace: draft is scoped to the customer and motorcycle.
    const bookingDrafts = new Map();
    let activeBooking = null;
    const bkDay = 86400000;
    function bkShift(key, days) { return toManilaDateKey(new Date(Date.parse(key+'T00:00:00+08:00')+days*bkDay).toISOString()); }
    function bkKey(v) { return String(currentCustomer()?.id || 'guest')+':'+v.id; }
    function bkDates(d) { return {start:manilaDateTimeToISO(d.pickupDate,d.pickupTime),end:manilaDateTimeToISO(d.returnDate,d.returnTime)}; }
    function bkProblem(v,d) {
        const {start,end}=bkDates(d);
        if(!start||!end) return 'Choose your pickup and return dates and times.';
        if(Date.parse(start)<Date.now()) return 'Choose a pickup time in the future.';
        if(Date.parse(end)<=Date.parse(start)) return 'Return must be after pickup.';
        if(hasConflict(v.id,start,end).conflict) return 'These dates are unavailable. Choose another period or motorcycle.';
        return '';
    }
    function bkStyles(){return `<style>
      .bk-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,1fr);gap:22px;align-items:start}.bk-layout>*{min-width:0}.bk-photo{aspect-ratio:16/10;background:#fff;border-radius:9px;overflow:hidden;display:grid;place-items:center}.bk-photo img{width:100%;height:100%;object-fit:contain}.bk-photo .vehicle-photo-placeholder{color:#333}.bk-title{font-size:25px;margin:0}.bk-specs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.bk-spec{border:1px solid var(--border);border-radius:7px;padding:10px;display:grid;gap:4px}.bk-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:18px}.bk-step{padding:9px 4px;border-bottom:2px solid var(--border);color:var(--text-muted);text-align:center;font-size:12px}.bk-step.active{border-color:var(--accent);color:var(--accent);font-weight:600}.bk-step.done{border-color:var(--success)}.bk-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.bk-day{min-height:34px;padding:4px 0;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);cursor:pointer}.bk-day:disabled{cursor:not-allowed;color:var(--text-faint);opacity:.65}.bk-day.blocked{background:var(--danger-soft);color:var(--danger)}.bk-day.selected{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}.bk-day.today{outline:1px solid var(--accent)}.bk-heading{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.bk-summary{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px}.bk-price-row{display:flex;justify-content:space-between;gap:12px;margin:7px 0}.bk-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}.bk-options label{border:1px solid var(--border);border-radius:7px;padding:10px;display:flex;align-items:center;gap:7px;cursor:pointer}.bk-options label:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}.bk-form .field{margin:0}.bk-booking{position:sticky;top:72px}.bk-booking .panel-body{padding:18px}.bk-note{font-size:12px;color:var(--text-muted)}.bk-alts{display:flex;gap:8px;flex-wrap:wrap}.bk-check{display:flex;align-items:flex-start;gap:10px}.bk-check input{margin-top:4px}.bk-layout [hidden]{display:none!important}.bk-calendar button:focus-visible{outline:2px solid var(--accent)}
      @media(max-width:1000px){.bk-layout{grid-template-columns:1fr}.bk-booking{position:static}}@media(max-width:480px){.bk-options,.bk-specs{grid-template-columns:1fr}.bk-booking .panel-body{padding:12px}.bk-step{font-size:11px}}
    </style>`;}
    function renderCustomerVehicleDetail(id) {
        const v=getVehicle(id); if(!v)return mount('<div class="empty">Vehicle not found. <a href="#/customer/vehicles">Back to motorcycles</a></div>');
        const cust=currentCustomer(), key=bkKey(v), pre=state.ui.bookingPrefill;
        let d=bookingDrafts.get(key)||{step:1,pickupDate:'',returnDate:'',pickupTime:'09:00',returnTime:'09:00',pickup:'guest',dropoff:'guest',deliveryAddress:'',collectionAddress:'',consent:false,month:todayKey().slice(0,7),selectingEnd:false};
        if(pre?.vehicleId===id && Number.isFinite(Date.parse(pre.start)) && Number.isFinite(Date.parse(pre.end))){const a=fmtDateTimeInput(pre.start),b=fmtDateTimeInput(pre.end);Object.assign(d,{pickupDate:a.slice(0,10),returnDate:b.slice(0,10),pickupTime:a.slice(11,16),returnTime:b.slice(11,16),month:a.slice(0,7),step:1});state.ui.bookingPrefill=null;}
        bookingDrafts.set(key,d);activeBooking={v,d,key};
        const blocked=!isVehicleBookable(v),specs=[['Displacement',displacementLabel(v.displacement)],['Transmission',v.transmission],['Capacity',v.seats+' seats'],['Plate number',v.plateNumber]];
        const options=(name,items)=>`<div class="bk-options">${items.map(([value,label])=>`<label><input type="radio" name="${name}" value="${value}" ${d[name]===value?'checked':''}>${label}</label>`).join('')}</div>`;
        const dateField=(name,label,type)=>`<label class="field"><span class="field-label">${label}</span><input class="input" type="${type}" name="${name}" value="${esc(d[name])}" ${type==='date'?`min="${todayKey()}"`:''}></label>`;
        const offers=getLandingPromos().filter(p=>!p.validFrom||String(p.validFrom).slice(0,10)<=todayKey());
        mount(`${bkStyles()}<div class="mb-3"><a href="#/customer/vehicles" class="btn btn-ghost btn-sm" data-ai-target="browse-vehicles-link">&larr; Back to motorcycles</a></div>
        <div class="bk-layout"><div class="stack"><div class="bk-photo">${vehicleImage(v)}</div><div class="bk-heading"><h1 class="bk-title">${esc(v.brand)} ${esc(v.name)}</h1>${vehicleOperationalBadges(v,false)}</div><p class="muted">${esc(v.year)} &middot; ${esc(v.color)}</p><div class="bk-specs">${specs.map(([k,val])=>`<div class="bk-spec"><span class="small muted">${k}</span><strong>${esc(val)}</strong></div>`).join('')}</div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Availability calendar</div></div><div class="panel-body stack"><div class="bk-heading"><button type="button" class="btn btn-sm" onclick="App.bkMonth(-1)" aria-label="Previous month">&larr;</button><strong id="bkMonthLabel"></strong><button type="button" class="btn btn-sm" onclick="App.bkMonth(1)" aria-label="Next month">&rarr;</button></div><div class="bk-calendar" id="bkCalendar"></div><div class="small muted">Select pickup, then return. Red dates are unavailable; blue dates are selected. Times use Philippine time.</div></div></div>
        ${offers.length?`<div class="panel"><div class="panel-body stack"><strong>Current offers</strong>${offers.map(p=>`<div><strong>${esc(p.title||p.name||'Promotion')}</strong><p class="small muted">${esc(p.description||p.terms||'Ask the rental provider for details.')}</p></div>`).join('')}<p class="small muted">Offers are subject to confirmation; no automatic discount is applied.</p></div></div>`:''}</div>
        <div class="panel bk-booking"><div class="panel-body stack"><div class="bk-heading"><div><p class="muted small">Book this motorcycle</p><strong style="font-size:27px">${fmtPHP(v.ratePerDay)}</strong> <span class="muted">/ day</span></div></div>
        ${blocked?`<div class="callout danger">This motorcycle is under maintenance and cannot accept bookings.</div><a class="btn" href="#/customer/vehicles">Browse other motorcycles</a>`:`${vehicleOperationalState(v).rented?'<div class="callout small">Currently rented. You can request available future dates.</div>':''}
        <div class="bk-steps" aria-label="Booking progress">${['Rental details','Requirements','Review & submit'].map((s,i)=>`<div id="bkStep${i+1}" class="bk-step">${i+1}. ${s}</div>`).join('')}</div>
        <form id="reqForm" class="stack bk-form" data-ai-target="booking-form" onsubmit="App.bkSubmit(event,'${esc(id)}')" oninput="App.bkSync()" onchange="App.bkSync()" novalidate>
        <input type="hidden" name="start" id="start"><input type="hidden" name="end" id="end"><input type="hidden" name="deliveryMethod" id="deliveryMethod">
        <section class="stack bk-stage" id="bkStage1"><h3>Rental period</h3><div class="grid-2">${dateField('pickupDate','Pickup date','date')}${dateField('pickupTime','Pickup time','time')}${dateField('returnDate','Return date','date')}${dateField('returnTime','Return time','time')}</div><div id="rangeSummary" class="small muted"></div><div id="conflictMsg" aria-live="polite"></div><div id="bkAlternatives" class="bk-alts"></div><h3>Pickup method</h3>${options('pickup',[['guest','Guest pickup'],['host','Host delivery']])}<label class="field bk-address" id="bkDelivery"><span class="field-label">Delivery address</span><textarea class="textarea" name="deliveryAddress" maxlength="500" rows="2">${esc(d.deliveryAddress)}</textarea></label><h3>Return method</h3>${options('dropoff',[['guest','Guest return'],['host','Host collection']])}<label class="field bk-address" id="bkCollection"><span class="field-label">Collection address</span><textarea class="textarea" name="collectionAddress" maxlength="500" rows="2">${esc(d.collectionAddress)}</textarea></label></section>
        <section class="stack bk-stage" id="bkStage2" hidden><h3>Rental requirements</h3><div>${cust?customerAvatar(cust)+` <strong>${esc(cust.name)}</strong>`:''}</div><div class="bk-spec"><span class="small muted">Identity verification</span>${cust?identityBadge(cust):'Account required'}<a href="${licenseUploadTarget()}" data-ai-target="upload-license-link">Manage identification in Account</a><span class="small muted">Administrator reviews identity before release.</span></div><div id="bkLicense" class="callout small"></div><div id="bkRestriction"></div><label class="bk-check"><input type="checkbox" name="trackingConsent" id="trackingConsent" ${d.consent?'checked':''}><span>I agree that the motorcycle may be tracked by GPS during my rental period.</span></label></section>
        <section class="stack bk-stage" id="bkStage3" hidden><h3>Review your reservation</h3><div id="reviewSummary" class="bk-summary"></div><p class="small muted">Your request will be reviewed before payment is requested. Availability is subject to administrator confirmation.</p></section>
        <div id="feePreview" class="bk-summary" aria-live="polite"></div><button type="button" class="link-btn" onclick="App.openOvertimeRulesModal()">View overtime and additional charge rules</button>
        <div class="bk-heading"><button type="button" id="bkBack" class="btn" onclick="App.bkAdvance(-1)">Back</button><button type="button" id="bkNext" class="btn btn-primary" onclick="App.bkAdvance(1)">Continue</button><button type="submit" id="bkSubmit" class="btn btn-primary" data-ai-target="booking-submit" hidden>Submit reservation request</button></div><p class="bk-note" style="text-align:center">No payment required until approval.</p></form>`}</div></div></div>`);
        bkRenderCalendar();if(!blocked){bkSync();bkShowStep();}
    }
    function bkRenderCalendar(){const box=$('#bkCalendar'),title=$('#bkMonthLabel');if(!box||!activeBooking)return;const {v,d}=activeBooking;const first=new Date(d.month+'-01T00:00:00Z');const year=first.getUTCFullYear(),month=first.getUTCMonth(),n=new Date(Date.UTC(year,month+1,0)).getUTCDate();title.textContent=first.toLocaleDateString('en-PH',{month:'long',year:'numeric',timeZone:'UTC'});const blocked=getBlockedRanges(v.id);box.innerHTML=['S','M','T','W','T','F','S'].map(x=>`<span class="small muted" style="text-align:center">${x}</span>`).join('')+'<span></span>'.repeat(first.getUTCDay())+Array.from({length:n},(_,i)=>{const key=d.month+'-'+String(i+1).padStart(2,'0'),a=manilaDateTimeToISO(key,'00:00'),b=manilaDateTimeToISO(bkShift(key,1),'00:00');const off=!isVehicleBookable(v)||rangeCrossesBlocked(a,b,blocked),past=key<todayKey(),selected=d.pickupDate&&key>=d.pickupDate&&key<=(d.returnDate||d.pickupDate);return `<button type="button" class="bk-day ${off?'blocked':''} ${selected?'selected':''} ${key===todayKey()?'today':''}" ${off||past?'disabled':''} aria-label="${key}${off?' unavailable':''}" onclick="App.bkChooseDate('${key}')">${i+1}</button>`;}).join('');}
    function bkMonth(delta){if(!activeBooking)return;const d=activeBooking.d,f=new Date(d.month+'-01T00:00:00Z');f.setUTCMonth(f.getUTCMonth()+delta);d.month=f.toISOString().slice(0,7);bkRenderCalendar();}
    function bkChooseDate(key){const f=$('#reqForm');if(!f||!activeBooking)return;const d=activeBooking.d;if(!d.selectingEnd||!d.pickupDate||key<d.pickupDate){f.elements.pickupDate.value=key;f.elements.returnDate.value=key;d.selectingEnd=true;}else{f.elements.returnDate.value=key;d.selectingEnd=false;}d.step=1;bkSync();bkShowStep();}
    function bkSync(){const f=$('#reqForm');if(!f||!activeBooking)return;const {v,d}=activeBooking;const previousPickup=d.pickupDate;for(const k of ['pickupDate','returnDate','pickupTime','returnTime','pickup','dropoff','deliveryAddress','collectionAddress'])d[k]=f.elements[k].value;if(d.pickupDate&&d.pickupDate!==previousPickup)d.month=d.pickupDate.slice(0,7);d.consent=f.elements.trackingConsent.checked;const {start,end}=bkDates(d);f.elements.start.value=start||'';f.elements.end.value=end||'';f.elements.deliveryMethod.value=DELIVERY_METHODS[(d.pickup==='host'?2:0)+(d.dropoff==='host'?1:0)];$('#bkDelivery').hidden=d.pickup!=='host';$('#bkCollection').hidden=d.dropoff!=='host';const problem=bkProblem(v,d),fee=computeFee(v.id,start,end),deposit=getDepositAmount();$('#rangeSummary').textContent=fee.days?`${fee.days} billable day(s) · Philippine time`:'';$('#conflictMsg').innerHTML=start&&end?`<div class="callout small ${problem?'danger':'success'}">${esc(problem||'Selected dates are available for request.')}</div>`:'';$('#feePreview').innerHTML=`<strong>Price breakdown</strong><div class="bk-price-row"><span class="muted">Rental${fee.days?' · '+fee.days+' day(s)':''}</span><strong>${fee.days?fmtPHP(fee.total):'—'}</strong></div><div class="bk-price-row"><span class="muted">Refundable deposit</span><strong>${fmtPHP(deposit)}</strong></div><div class="divider"></div><div class="bk-price-row"><strong>Total to prepare</strong><strong style="font-size:20px;color:var(--accent)">${fee.days?fmtPHP(fee.total+deposit):'—'}</strong></div><p class="small muted">Delivery charges or offers, if applicable, require confirmation.</p>`;
        const lic=getLicenseStatus(currentCustomer(),{end});$('#bkLicense').innerHTML=bookingHasLicense(currentCustomer())&&lic.status==='Valid'?`<strong>Driver’s license on file</strong><div>${esc(lic.detail)}</div>`:`<strong>Valid driver’s license required</strong><div>${esc(lic.detail)}. <a href="${licenseUploadTarget()}">Update Account</a></div>`;const restriction=customerRestriction(currentCustomer());$('#bkRestriction').innerHTML=restriction?`<div class="callout danger small">${esc(restriction)}</div>`:'';
        $('#reviewSummary').innerHTML=`<strong>${esc(v.brand)} ${esc(v.name)}</strong><div class="bk-price-row"><span class="muted">Pickup</span><span>${start?fmtDate(start,{time:true}):'—'}</span></div><div class="bk-price-row"><span class="muted">Return</span><span>${end?fmtDate(end,{time:true}):'—'}</span></div><p>${esc(f.elements.deliveryMethod.value)}</p>${d.pickup==='host'?`<p class="small">Delivery: ${esc(d.deliveryAddress)}</p>`:''}${d.dropoff==='host'?`<p class="small">Collection: ${esc(d.collectionAddress)}</p>`:''}<p class="small muted">GPS tracking consent: ${d.consent?'Accepted':'Not accepted'}</p>`;
        const alt=$('#bkAlternatives');alt.innerHTML='';if(problem&&start&&end&&Date.parse(end)>Date.parse(start)){const similar=state.vehicles.filter(x=>x.id!==v.id&&String(x.displacement)===String(v.displacement)&&isVehicleBookable(x)&&!hasConflict(x.id,start,end).conflict).slice(0,2);let next=null;for(let i=1;i<=30;i++){const a=bkShift(d.pickupDate,i),b=bkShift(d.returnDate,i);if(!bkProblem(v,{...d,pickupDate:a,returnDate:b})){next=[a,b];break;}}alt.innerHTML=(next?`<button class="btn btn-sm" type="button" onclick="App.bkAlternative('${next[0]}','${next[1]}')">Try ${next[0]} – ${next[1]}</button>`:'')+similar.map(x=>`<button class="btn btn-sm" type="button" onclick="App.bkSimilar('${esc(x.id)}')">Try ${esc(x.name)} · ${esc(x.plateNumber)}</button>`).join('');}bkRenderCalendar();}
    function bkAlternative(a,b){const f=$('#reqForm');if(!f)return;f.elements.pickupDate.value=a;f.elements.returnDate.value=b;activeBooking.d.month=a.slice(0,7);bkSync();}
    function bkSimilar(id){if(!activeBooking)return;const {start,end}=bkDates(activeBooking.d);state.ui.bookingPrefill={vehicleId:id,start,end};navigate('#/customer/vehicle/'+id);}
    function bkShowStep(){if(!activeBooking||!$('#reqForm'))return;const d=activeBooking.d;for(let i=1;i<=3;i++){$('#bkStage'+i).hidden=d.step!==i;$('#bkStep'+i).className='bk-step'+(d.step===i?' active':d.step>i?' done':'');}$('#bkBack').hidden=d.step===1;$('#bkNext').hidden=d.step===3;$('#bkNext').textContent=d.step===1?'Continue to requirements':'Review reservation';$('#bkSubmit').hidden=d.step!==3;}
    function bkValidate(step){const {v,d}=activeBooking;const p=bkProblem(v,d);if(p)return p;if(d.pickup==='host'&&!d.deliveryAddress.trim())return 'Enter a delivery address.';if(d.dropoff==='host'&&!d.collectionAddress.trim())return 'Enter a collection address.';if(step>=2){const c=currentCustomer(),r=customerRestriction(c),{end}=bkDates(d);if(r)return r;if(!bookingHasLicense(c)||getLicenseStatus(c,{end}).status!=='Valid')return 'A valid driver’s license through your return date is required.';if(!d.consent)return 'Accept GPS tracking consent to continue.';}return '';}
    function bkAdvance(delta){if(!activeBooking)return;bkSync();const d=activeBooking.d;if(delta>0){const p=bkValidate(d.step);if(p)return toast(p,'error');}d.step=Math.max(1,Math.min(3,d.step+delta));bkShowStep();}
    function bkSubmit(e,id){e.preventDefault();if(!activeBooking||activeBooking.v.id!==id||state.role!=='customer')return;if(activeBooking.d.step!==3)return bkAdvance(1);bkSync();const p=bkValidate(3);if(p)return toast(p,'error');submitReservation(e,id);}

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
                    <div class="delivery-options">${delivery('Pickup method', pickup)}${delivery('Return method', dropoff)}</div>${r.deliveryAddress?`<p class="small">Delivery address: ${esc(r.deliveryAddress)}</p>`:''}${r.collectionAddress?`<p class="small">Collection address: ${esc(r.collectionAddress)}</p>`:''}
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
            ${!admin && state.ui.bookingSuccess===r.id && r.status==='pending' ? `<div class="panel mb-3"><div class="panel-body stack"><h2 style="color:var(--success)">Reservation request submitted</h2><strong>${esc(r.id.toUpperCase())}</strong><p>We received your request. Next: wait for approval, submit payment proof, then prepare for pickup.</p><p class="small muted">No payment is due before approval.</p></div></div>` : ''}
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
                    ${finDepositPanel(r, admin)}
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
    // Shared notification center. Scope each inbox and its mutations to the current role/account.
    function notificationOwned(n) {
        if (!n || n.role !== state.role || !['admin','customer'].includes(state.role)) return false;
        if (state.role === 'admin') return true;
        const c = currentCustomer();
        if (!c) return false;
        if (n.customerId) return n.customerId === c.id;
        // Legacy personal notices with a reservation link can be safely attributed.
        const match = String(n.link || '').match(/^#\/customer\/reservation\/([^/]+)(?:\/|$)/);
        return !!(match && getReservation(match[1]) && ownsReservation(getReservation(match[1])));
    }
    function notificationInbox(includeArchived = false) {
        return (state.notifications || []).filter(n => notificationOwned(n) && (includeArchived || !n.archivedAt)).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
    }
    function notificationSettings() {
        const key = state.role === 'admin' ? 'admin' : 'customer:'+ (currentCustomer()?.id || 'none');
        state.ui.notificationCenter ||= {};
        return state.ui.notificationCenter[key] ||= {view:'all',category:'all',query:''};
    }
    const notificationCategories = {all:'All categories',reservations:'Reservations',payments:'Payments & refunds',customers:'Customers & identity',fleet:'Fleet & tracking',other:'Other'};
    function notificationCategory(n) {
        const title = String(n.title || '').toLowerCase(), link = String(n.link || '');
        if (/payment|overtime|refund|deposit|receipt|charge/.test(title) || /\/payments(?:\/|$)/.test(link)) return 'payments';
        if (/identification|identity|license|licence|profile|verification|account/.test(title) || /^#\/admin\/customers?(?:\/|$)/.test(link)) return 'customers';
        if (/overdue|maintenance|malfunction|tracking|gps|signal|service|log entry/.test(title) || /\/(map|maintenance|vehicles|schedule)(?:\/|$)/.test(link)) return 'fleet';
        if (/reservation|rental|booking|return|pickup/.test(title) || /\/reservation[s]?(?:\/|$)/.test(link)) return 'reservations';
        return 'other';
    }
    function notificationUrgent(n) {
        return state.role === 'admin' && /overdue|no signal|missing signal|malfunction|urgent/i.test(n.title || '');
    }
    function notificationDestination(n) {
        const link = String(n.link || '');
        if (!link.startsWith('#/'+state.role+'/') || /[\s<>"']/.test(link)) return '';
        if (state.role === 'customer') {
            const m = link.match(/^#\/customer\/reservation\/([^/]+)(?:\/|$)/);
            if (m && (!getReservation(m[1]) || !ownsReservation(getReservation(m[1])))) return '';
        }
        return link;
    }
    function notificationAction(n) {
        const link = notificationDestination(n);
        if (!link) return '';
        if (/\/reservation\//.test(link)) return /\/pay$/.test(link) ? 'Upload payment' : 'View reservation';
        if (/\/payments/.test(link)) return 'Review payments';
        if (/\/customer\//.test(link) && state.role==='admin') return 'Review customer';
        if (/\/map$/.test(link)) return 'Open Live Map';
        if (/\/maintenance/.test(link)) return 'View maintenance';
        return 'Open details';
    }
    function renderCustomerNotifications() { renderNotificationCenter(); }
    function renderNotificationCenter() {
        if (!['admin','customer'].includes(state.role)) return;
        const inbox = notificationInbox(true), f = notificationSettings();
        const active = inbox.filter(n=>!n.archivedAt), unread = active.filter(n=>!n.isRead).length;
        const counts = {all:active.length,unread,archived:inbox.length-active.length};
        const query = f.query.trim().toLowerCase();
        const list = inbox.filter(n=> (f.view==='archived' ? !!n.archivedAt : !n.archivedAt && (f.view!=='unread'||!n.isRead)) && (f.category==='all'||notificationCategory(n)===f.category) && (!query||[n.title,n.body,n.link,notificationCategories[notificationCategory(n)]].join(' ').toLowerCase().includes(query)));
        const yesterday = toManilaDateKey(new Date(Date.now()-86400000).toISOString());
        let previous = null;
        const icons = {reservations:'▣',payments:'₱',customers:'✓',fleet:'!',other:'•'};
        const cards = list.map(n=>{
            const day = Number.isFinite(Date.parse(n.createdAt)) ? toManilaDateKey(n.createdAt) : 'unknown';
            const heading = day!==previous ? `<h2 class="nc-date">${esc(day===todayKey()?'Today':day===yesterday?'Yesterday':day==='unknown'?'Unknown date':fmtDateShort(n.createdAt))}</h2>` : '';
            previous=day;
            const category=notificationCategory(n),urgent=notificationUrgent(n),action=notificationAction(n);
            return heading+`<article class="nc-card ${!n.isRead&&!n.archivedAt?'nc-unread':''}"><div class="nc-icon ${urgent?'nc-urgent':''}" aria-hidden="true">${icons[category]}</div><div class="nc-content"><div class="nc-meta"><span>${esc(notificationCategories[category])}</span>${urgent?'<span class="nc-priority">Urgent</span>':''}${!n.isRead&&!n.archivedAt?'<span class="nc-dot" aria-label="Unread"></span>':''}</div><h3>${esc(n.title||'Notification')}</h3><p>${esc(n.body||'')}</p><div class="small muted">${Number.isFinite(Date.parse(n.createdAt))?esc(fmtDate(n.createdAt,{time:true})):'—'}</div></div><div class="nc-actions">${action?`<button class="btn btn-primary btn-sm" data-id="${esc(n.id)}" onclick="App.ncOpen(this.dataset.id)">${esc(action)}</button>`:''}${n.archivedAt?`<button class="btn btn-sm" data-id="${esc(n.id)}" onclick="App.ncArchive(this.dataset.id,false)">Restore</button>`:`<button class="btn btn-sm" data-id="${esc(n.id)}" onclick="App.ncRead(this.dataset.id,${!n.isRead})">Mark ${n.isRead?'unread':'read'}</button><button class="btn btn-ghost btn-sm" data-id="${esc(n.id)}" onclick="App.ncArchive(this.dataset.id,true)">Archive</button>`}</div></article>`;
        }).join('');
        mount(`<style>
        .nc-center{max-width:1100px;margin:0 auto}.nc-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.nc-center .nc-tabs button{min-height:32px}.nc-search{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}.nc-search .input{flex:1 1 220px;width:auto;min-width:0}.nc-search .select{width:auto;max-width:100%}.nc-date{font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin:20px 0 8px}.nc-card{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:start;gap:14px;padding:16px;margin-bottom:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.nc-card.nc-unread{border-left:3px solid var(--accent);background:linear-gradient(90deg,var(--accent-soft),var(--surface) 38%)}.nc-icon{width:40px;height:40px;border-radius:8px;display:grid;place-items:center;background:var(--surface-alt);color:var(--accent);font-size:20px;font-weight:600}.nc-icon.nc-urgent{color:var(--danger);background:var(--danger-soft)}.nc-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--text-muted);font-size:11px;margin-bottom:3px}.nc-priority{color:var(--danger);font-weight:600}.nc-dot{width:7px;height:7px;background:var(--accent);border-radius:50%;display:inline-block}.nc-content h3{font-size:14px;margin-bottom:4px;overflow-wrap:anywhere}.nc-content p{font-size:13px;color:var(--text-muted);margin-bottom:7px;overflow-wrap:anywhere}.nc-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;align-items:center;max-width:270px}.nc-actions .btn{min-height:30px}.nc-summary{margin-bottom:14px;color:var(--text-muted);font-size:13px}@media(max-width:800px){.nc-card{grid-template-columns:36px minmax(0,1fr);gap:10px}.nc-icon{width:36px;height:36px}.nc-actions{grid-column:2;justify-content:flex-start;max-width:none}}@media(max-width:420px){.nc-card{padding:11px}.nc-search .select{flex:1 1 150px}}
        </style><section class="nc-center"><div class="page-header"><div><h1 class="page-title">Notifications</h1><p class="page-desc">${state.role==='admin'?'Stay updated on rental operations.':'Updates about your account, bookings and payments.'}</p></div><button class="btn" onclick="App.markAllRead()" ${unread?'':'disabled'}>Mark all as read</button></div><div class="nc-summary">${unread} unread · ${active.length} in inbox · ${counts.archived} archived</div><div class="nc-tabs" aria-label="Notification views">${[['all','All'],['unread','Unread'],['archived','Archived']].map(([k,label])=>`<button class="chip ${f.view===k?'active':''}" aria-pressed="${f.view===k}" onclick="App.ncView('${k}')">${label} (${counts[k]})</button>`).join('')}</div><form class="nc-search" onsubmit="App.ncSearch(event)"><input class="input" name="query" aria-label="Search notifications" placeholder="Search notifications..." value="${esc(f.query)}"><select name="category" class="select" aria-label="Notification category" onchange="App.ncSearch({preventDefault(){},target:this.form})">${Object.entries(notificationCategories).map(([k,label])=>`<option value="${k}" ${f.category===k?'selected':''}>${esc(label)}</option>`).join('')}</select><button class="btn btn-primary">Search</button><button type="button" class="btn btn-ghost" onclick="App.ncReset()">Clear filters</button></form><div aria-live="polite" class="small muted">${list.length} matching notification${list.length===1?'':'s'}</div>${cards||'<div class="empty"><div class="empty-title">No matching notifications</div><div>Try another filter or search.</div></div>'}</section>`);
    }
    function ncRefresh(){ if (!['admin','customer'].includes(state.role)) return; renderChrome(); if (parseHash()[1]==='notifications') renderNotificationCenter(); }
    function ncView(view){if(!['admin','customer'].includes(state.role)||!['all','unread','archived'].includes(view))return;notificationSettings().view=view;ncRefresh();}
    function ncSearch(e){e.preventDefault();if(!['admin','customer'].includes(state.role))return;const f=notificationSettings(),fields=e.target.elements;f.query=String(fields.query.value||'').slice(0,200);f.category=Object.hasOwn(notificationCategories,fields.category.value)?fields.category.value:'all';ncRefresh();}
    function ncReset(){if(!['admin','customer'].includes(state.role))return;Object.assign(notificationSettings(),{category:'all',query:''});ncRefresh();}
    function ncRead(id,read){const n=notificationInbox(true).find(n=>n.id===id);if(!n||n.archivedAt)return;n.isRead=!!read;ncRefresh();}
    function ncArchive(id,archive){const n=notificationInbox(true).find(n=>n.id===id);if(!n)return;if(archive){n.archivedAt=new Date().toISOString();n.isRead=true;}else delete n.archivedAt;ncRefresh();}
    function ncOpen(id){const n=notificationInbox(true).find(n=>n.id===id);if(!n)return;const link=notificationDestination(n);if(!link){n.isRead=true;ncViewAll();return;}n.isRead=true;state.ui.notifOpen=false;if(location.hash===link)render();else {renderChrome();navigate(link);}}
    function ncViewAll(){state.ui.notifOpen=false;if(!['admin','customer'].includes(state.role))return;Object.assign(notificationSettings(),{view:'all',category:'all',query:''});const link='#/'+state.role+'/notifications';if(location.hash===link)ncRefresh();else {renderChrome();navigate(link);}}
    function renderCustomerAccount() {
        const cust = currentCustomer();
        if (!cust) return;
        const allMine = state.reservations.filter(r => ownsReservation(r) && ['completed','cancelled','rejected'].includes(r.status)).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        const completed = allMine.filter(r => r.status === 'completed');
        const spent = completed.reduce((sum,r) => sum + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r),0);
        mount(`
          <div class="page-header"><div><h1 class="page-title">Account</h1><p class="page-desc">Your profile information and rental history.</p></div></div>
          <div class="account-layout" style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;">
            <div class="account-profile" style="flex:1 1 280px;min-width:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;">
              <div class="panel">
                <div class="panel-header"><div class="panel-title">Profile</div><button class="btn btn-sm" data-ai-target="edit-profile" onclick="App.editCustomerIdentity('${cust.id}')">Edit profile</button></div>
                <div class="panel-body">
                  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">${customerAvatar(cust)}${identityBadge(cust)}</div>
                  <div class="kv" style="grid-template-columns:70px minmax(0,1fr);overflow-wrap:anywhere;">
                    <div class="k">Name</div><div class="v">${esc(cust.name)}</div>
                    <div class="k">Email</div><div class="v">${esc(cust.email)}</div>
                    <div class="k">Phone</div><div class="v">${esc(cust.phone)}</div>
                    <div class="k">Joined</div><div class="v">${fmtDateShort(cust.joinedAt)}</div>
                  </div>
                </div>
              </div>
              <div class="panel">
                <div class="panel-header"><div class="panel-title">Identification documents</div></div>
                <div class="panel-body">${customerDocuments(cust, true)}${cust.identification?.rejectionReason ? `<div class="callout danger mt-2">${esc(cust.identification.rejectionReason)}</div>` : ''}</div>
              </div>
            </div>
            <div class="account-history" style="flex:3 1 540px;min-width:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;">
              <div class="account-metrics" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
                <div class="metric" style="min-width:0;"><div class="metric-label">Completed rentals</div><div class="metric-value">${completed.length}</div></div>
                <div class="metric" style="min-width:0;"><div class="metric-label">Total spent</div><div class="metric-value sm" style="overflow-wrap:anywhere;">${fmtPHP(spent)}</div></div>
              </div>
              <div class="panel" style="min-width:0;">
                <div class="panel-header"><div class="panel-title">Rental history</div></div>
                <div class="panel-body flush" style="min-width:0;">
                  ${allMine.length ? `<div class="table-wrap" style="overflow-x:auto;"><table class="table"><thead><tr><th>Vehicle</th><th>Period</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${allMine.map(r => {
                    const v = getVehicle(r.vehicleId);
                    return `<tr><td><div class="cell-main">${esc(v ? v.name : r.vehicleId)}</div><div class="cell-sub">${esc(v ? v.plateNumber : '')}</div></td><td class="small">${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}</td><td>${fmtPHP(r.totalFee + (r.overtimeFee || 0))}</td><td>${statusBadge(r.status)}</td><td class="text-right"><a class="btn btn-sm btn-ghost" href="#/customer/reservation/${r.id}">View</a></td></tr>`;
                  }).join('')}</tbody></table></div>` : `<div class="empty"><div class="empty-title">No rental history</div><div>Completed and past rentals will appear here.</div></div>`}
                </div>
              </div>
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
    // Dashboard occupancy and operational events are derived from records, not cached labels.
    function dashboardFleet(now = Date.now()) {
        return state.vehicles.map(v => vehicleOperationalState(v, now));
    }

    function dashboardEvents() {
        const events = [];
        for (const r of state.reservations) {
            if (!['approved','ongoing','completed'].includes(r.status)) continue;
            const method = getDeliveryMethod(r).split(' & ');
            if (Number.isFinite(Date.parse(r.start))) events.push({ r, date:r.start, kind:'pickup', method:method[0], done:r.status !== 'approved' });
            const returned = r.status === 'completed' && r.actualReturn;
            if (Number.isFinite(Date.parse(returned || r.end))) events.push({ r, date:returned || r.end, kind:'return', method:method[1] || 'Not specified', done:r.status === 'completed' });
        }
        return events.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
    }
    function dashboardLink(target) {
        if (!adminOnly()) return;
        const links = {pending:'reservations',ongoing:'reservations',available:'vehicles/available',pickups:'schedule',returns:'map',upcoming:'schedule',overdue:'map',signal:'map',payments:'payments/pending',maintenance:'maintenance',verification:'customers',fleet:'vehicles',activity:'activity',reports:'reports',settings:'settings'};
        if (!links[target]) return;
        if (['pending','ongoing'].includes(target)) state.ui.adminResTab=target;
        if (['pickups','upcoming'].includes(target)) Object.assign(state.ui,{opsScheduleStart:todayKey(),fleetDays:7,fleetVehicle:'all',fleetKind:'rental'});
        if (['overdue','signal','returns'].includes(target)) {
            state.ui.tracking=state.ui.tracking||{};
            state.ui.tracking.filter=target==='returns'?'returns':target==='overdue'?'overdue':'all';
            state.ui.tracking.selectedVehicleId=null;
            if (target==='returns') {
                const rows=state.reservations.filter(r=>r.status==='ongoing' && Number.isFinite(Date.parse(r.end)) && toManilaDateKey(r.end)===todayKey());
                state.ui.tracking.panelCollapsed=false;
                if (rows.length===1) state.ui.tracking.selectedVehicleId=rows[0].vehicleId;
            }
        }
        if (target==='payments') Object.assign(state.ui,{finTab:'queue',finQuery:'',finStatus:'all',finMethod:'all'});
        if (target==='maintenance') state.ui.maintenanceTileFilter='attention';
        if (target==='verification') Object.assign(state.ui,{cmFilter:'pending',cmQuery:'',cmPage:1});
        navigate('#/admin/'+links[target]);
    }
    function dashboardTime(iso) { return new Date(iso).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',hour12:true}); }
    function dashboardEventHTML(e, today=false) {
        const r=e.r,v=getVehicle(r.vehicleId),c=getCustomer(r.customerId);
        const late=!e.done && Date.parse(e.date)<Date.now();
        const status=e.done?(e.kind==='pickup'?'Released':'Returned'):late?(e.kind==='pickup'?'Pickup due':'Overdue'):'Upcoming';
        return `<a class="dash-event" href="#/admin/reservation/${esc(r.id)}"><div class="dash-event-time">${today?'':`<span>${esc(fmtDateShort(e.date))}</span>`}<strong>${esc(dashboardTime(e.date))}</strong><span>${e.kind==='pickup'?'Pickup':'Return'}</span></div><div class="dash-bike">${v?vehicleImage(v):'—'}</div><div class="dash-event-main"><strong>${esc(v?.name||r.vehicleId)}</strong><span class="small muted">${esc(v?.plateNumber||'')}</span><div class="dash-person">${c?customerAvatar(c):''}<span>${esc(c?.name||r.customerName)}</span></div><span class="small muted">${esc(e.method)}</span></div><span class="status status-${e.done?'completed':late?'open':'approved'}">${status}</span></a>`;
    }
    function dashboardStyles() {return `<style>
    .vera-dash{display:grid;gap:16px;container-type:inline-size}.vera-dash .page-header{margin:0}.dash-date{text-align:right}.dash-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.dash-metric{background:var(--surface,#161b22);border:1px solid var(--border,#30363d);border-radius:8px;display:grid;text-align:left;gap:7px;padding:15px;cursor:pointer;color:var(--text);min-width:0}.dash-metric:hover,.dash-alert:hover,.dash-event:hover{background:var(--surface-alt,#21262d);text-decoration:none}.dash-metric:focus-visible,.dash-alert:focus-visible,.dash-event:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.dash-metric-top{display:flex;justify-content:space-between;align-items:center;gap:8px}.dash-number{font-size:28px;line-height:1.1;font-weight:650;letter-spacing:-.03em}.dash-icon{font-size:19px}.dash-section-title{font-size:15px;font-weight:600}.dash-alert{display:flex;align-items:center;gap:12px;width:100%;background:transparent;border:0;border-bottom:1px solid var(--border);text-align:left;padding:12px 14px;color:var(--text);cursor:pointer}.dash-alert:last-child{border-bottom:0}.dash-alert-icon{border-radius:7px;background:var(--surface-alt);display:grid;place-items:center;width:36px;height:36px;flex:0 0 36px;font-size:18px}.dash-alert-copy{flex:1;min-width:0}.dash-alert-copy strong,.dash-alert-copy span{display:block}.dash-schedule{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dash-schedule-col{min-width:0;border:1px solid var(--border);border-radius:6px;overflow:hidden}.dash-schedule-col h3{font-size:13px;padding:12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between}.dash-event{display:grid;grid-template-columns:76px 72px minmax(0,1fr) auto;gap:10px;align-items:center;color:var(--text);padding:12px;border-bottom:1px solid var(--border);min-width:0}.dash-event:last-child{border-bottom:0}.dash-event-time,.dash-event-main{display:grid;gap:3px;min-width:0;overflow-wrap:anywhere}.dash-event-time span{font-size:11px;color:var(--text-muted)}.dash-event-time strong{font-size:13px}.dash-bike{height:54px;background:#fff;border-radius:5px;overflow:hidden;display:grid;place-items:center}.dash-bike img{width:100%;height:100%;object-fit:contain}.dash-person{display:flex;align-items:center;gap:6px;font-size:12px}.dash-person>div{width:24px!important;height:24px!important;flex:0 0 24px!important;font-size:10px}.dash-overview{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dash-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dash-stat{padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;min-width:0}.dash-stat strong{display:block;font-size:22px;margin-top:4px}.dash-activity{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text);overflow-wrap:anywhere}.dash-activity:last-child{border-bottom:0}.dash-activity div{min-width:0;flex:1}.dash-activity time{font-size:11px;color:var(--text-muted);text-align:right}.dash-empty{padding:22px 12px;text-align:center;color:var(--text-muted);font-size:13px}.dash-list{max-height:390px;overflow:auto}.dash-head-link{color:var(--accent);font-size:12px}.dash-sub{font-size:12px;color:var(--text-muted)}
    @container (max-width:1000px){.dash-schedule .dash-event{grid-template-columns:64px 56px minmax(0,1fr)}.dash-schedule .dash-event>.status{grid-column:3;justify-self:start}}
    @container (max-width:730px){.dash-schedule,.dash-overview{grid-template-columns:1fr}.dash-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dash-date{text-align:left}.dash-event{grid-template-columns:70px 60px minmax(0,1fr)}.dash-event>.status{grid-column:3;justify-self:start}}
    @container (max-width:400px){.dash-stats{grid-template-columns:1fr}.dash-metric{padding:12px}.dash-event,.dash-schedule .dash-event{grid-template-columns:58px 48px minmax(0,1fr);gap:7px}.dash-activity{flex-wrap:wrap}}
    </style>`;}
    function renderAdminDashboard() {
        const now=Date.now(), today=todayKey();
        const dayStart=Date.parse(today+'T00:00:00+08:00');
        const fleet=dashboardFleet(now), active=state.reservations.filter(r=>r.status==='ongoing');
        const pending=state.reservations.filter(r=>r.status==='pending').length;
        const overdue=active.filter(r=>Date.parse(r.end)<now).length;
        const available=fleet.filter(x=>x.available).length;
        const events=dashboardEvents();
        const todays=events.filter(e=>toManilaDateKey(e.date)===today);
        const pickups=todays.filter(e=>e.kind==='pickup'),returns=todays.filter(e=>e.kind==='return');
        const upcoming=events.filter(e=>!e.done&&Date.parse(e.date)>=dayStart+86400000&&Date.parse(e.date)<dayStart+8*86400000);
        const payments=state.payments.filter(p=>p.status==='pending').length;
        const verification=state.customers.filter(c=>identityStatus(c)==='pending').length;
        const faults=fleet.filter(x=>x.malfunction).length;
        const maintenance=fleet.filter(x=>x.malfunction||x.maintenance).length;
        const due=state.vehicles.filter(v=>['Due','Due soon'].includes(maintenanceDue(v))).length;
        const tracking=typeof App.Tracking?.getTrackedVehicles==='function'?App.Tracking.getTrackedVehicles('all'):null;
        const noSignal=tracking?tracking.filter(x=>x.noSignal).length:null;
        const connected=tracking?tracking.filter(x=>!x.noSignal).length:null;
        const pickupDue=pickups.filter(e=>!e.done).length;
        const returnsDue=returns.filter(e=>e.r.status==='ongoing').length;
        const recent=(state.activityLogs||[]).slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,6);
        const metrics=[['Pending requests',pending,'▤','var(--warning)','pending','Awaiting approval'],['Active rentals',active.length,'◉','var(--accent)','ongoing','Currently ongoing'],['Available vehicles',available,'✓','var(--success)','available','Free for immediate release'],['Pickups today',pickups.length,'↗','var(--accent)','pickups',`${pickupDue} awaiting release`],['Returns today',returnsDue,'↙','var(--success)','returns',`${returnsDue} awaiting return · View map`],['Overdue rentals',overdue,'!','var(--danger)','overdue','Past expected return']];
        const alerts=[['Overdue rentals',overdue,'!','var(--danger)','overdue','Past scheduled return time'],['GPS signal missing',noSignal,'⌖','var(--danger)','signal','No recent location update'],['Motorcycle malfunctions',faults,'!','var(--danger)','maintenance','Review open issues'],['Pickups awaiting release today',pickupDue,'↗','var(--warning)','pickups','Review today’s handovers'],['Payments awaiting verification',payments,'▤','var(--warning)','payments','Review submitted proof'],['Pending reservation requests',pending,'▤','var(--warning)','pending','Review booking requests'],['Preventive service due or due soon',due,'⚙','var(--warning)','maintenance','Review service dates and odometers'],['Customers awaiting verification',verification,'✓','var(--accent)','verification','Review submitted identification']].filter(a=>a[1]>0);
        const link=(target,label)=>`<button type="button" class="link-btn dash-head-link" onclick="App.dashboardLink('${target}')">${label}</button>`;
        const panel=(title,target,label,body)=>`<section class="panel"><div class="panel-header"><h2 class="dash-section-title">${title}</h2>${link(target,label)}</div>${body}</section>`;
        const stat=(label,value,color)=>`<div class="dash-stat"><span class="small muted">${label}</span><strong style="color:${color}">${value}</strong></div>`;
        const col=(label,items)=>`<div class="dash-schedule-col"><h3>${label}<span class="muted">${items.length}</span></h3><div class="dash-list">${items.length?items.map(e=>dashboardEventHTML(e,true)).join(''):`<div class="dash-empty">No ${label.toLowerCase()} scheduled today.</div>`}</div></div>`;
        mount(`${dashboardStyles()}<div class="vera-dash"><div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-desc">Fleet and rental operations overview</p></div><div class="dash-date"><strong>${esc(new Date(now).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric'}))}</strong><div class="small muted">${esc(dashboardTime(now))} PHT · Snapshot</div></div></div>
        <div class="dash-metrics">${metrics.map(([label,count,icon,color,target,hint])=>`<button type="button" class="dash-metric" onclick="App.dashboardLink('${target}')"><div class="dash-metric-top"><span class="metric-label">${label}</span><span aria-hidden="true" class="dash-icon" style="color:${color}">${icon}</span></div><span class="dash-number" style="color:${color}">${count}</span><span class="dash-sub">${hint}</span></button>`).join('')}</div>
        ${panel('Requires attention','activity','Activity log',alerts.length?`<div>${alerts.map(([label,count,icon,color,target,hint])=>`<button class="dash-alert" type="button" onclick="App.dashboardLink('${target}')"><span class="dash-alert-icon" aria-hidden="true" style="color:${color}">${icon}</span><span class="dash-alert-copy"><strong>${count} · ${label}</strong><span class="small muted">${hint}</span></span><span aria-hidden="true">›</span></button>`).join('')}</div>`:'<div class="dash-empty">No operational alerts requiring attention.</div>')}
        ${panel("Today's schedule",'pickups','Fleet schedule',`<div class="panel-body dash-schedule">${col('Pickups',pickups)}${col('Returns',returns)}</div>`)}
        ${panel('Upcoming schedule · next 7 days','upcoming','Fleet schedule',`<div class="dash-list">${upcoming.length?upcoming.map(e=>dashboardEventHTML(e)).join(''):'<div class="dash-empty">No confirmed upcoming pickups or returns.</div>'}</div>`)}
        <div class="dash-overview">${panel('Fleet overview','fleet','View vehicles',`<div class="panel-body"><div class="dash-stats">${stat('Available',available,'var(--success)')}${stat('Rented',fleet.filter(x=>x.rented).length,'var(--accent)')}${stat('Mechanical holds',maintenance,'var(--warning)')}</div><p class="small muted mt-2">Mechanical holds can overlap with rental occupancy. ${fleet.filter(x=>x.reserved&&!x.rented).length} reserved for a current approved booking.</p></div>`)}${panel('GPS overview','signal','Live map',`<div class="panel-body"><div class="dash-stats">${stat('Recent signal',connected??'—','var(--success)')}${stat('No signal',noSignal??'—','var(--danger)')}${stat('Overdue',overdue,'var(--warning)')}</div><p class="small muted mt-2">${tracking?'Tracking data may be simulated. Signal and overdue indicators can overlap.':'Tracking module unavailable.'}</p></div>`)}</div>
        ${panel('Recent activity','activity','View activity log',`<div>${recent.length?recent.map(a=>`<div class="dash-activity"><div><strong>${esc(a.action||'Activity')} · ${esc(a.module||'System')}</strong><div class="small muted">${esc(a.description||'')} · ${esc(a.actorName||'')}</div></div><time>${esc(fmtDate(a.createdAt,{time:true}))}</time><button class="btn btn-sm" onclick="App.viewActivity('${esc(a.id)}')">Details</button></div>`).join(''):'<div class="dash-empty">No activity recorded yet.</div>'}</div>`)}
        </div>`);
    }
    function renderAdminSettings() {
        mount(`<div class="page-header"><div><h1 class="page-title">Settings</h1><p class="page-desc">Current rental contract configuration.</p></div></div><div class="stack">${renderOvertimeRulesPanel()}<div class="panel"><div class="panel-header"><div class="panel-title">Security deposit</div></div><div class="panel-body"><strong>${fmtPHP(getDepositAmount())}</strong><p class="small muted">Refundable security deposit · read-only prototype configuration.</p></div></div></div>`);
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
    
function renderAdminVehicles(filter) {
    const visibleFleet = filter === 'available' ? dashboardFleet().filter(x=>x.available).map(x=>x.v) : state.vehicles;
    const statuses = ['available', 'maintenance', 'malfunction'];

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

        ${filter==='available'?`<div class="toolbar"><span class="muted">${visibleFleet.length} vehicle(s) available for immediate release</span><a href="#/admin/vehicles" class="btn btn-sm">Show all vehicles</a></div>${visibleFleet.length?'':'<div class="empty">No vehicles available for immediate release.</div>'}`:''}
        <div class="vehicle-grid">

            ${visibleFleet.map(vehicle => {
                const f = vehicleOperationalState(vehicle);
                const selectedCondition = f.condition !== 'available' ? f.condition : f.service ? 'maintenance' : 'available';
                const recordCondition = vehicleRecordCondition(vehicle);
                const minimumCondition = recordCondition === 'malfunction' ? 'malfunction' : recordCondition === 'maintenance' || f.service ? 'maintenance' : 'available';
                return `
                <article class="fleet-card">

                    <div class="fleet-image">
                        ${vehicleImage(vehicle)}

                        <div class="fleet-status">
                            ${vehicleOperationalBadges(vehicle)}
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

                        <p class="small muted" style="margin-top:10px">Mechanical condition · Rental status is automatic</p>
                        <div class="fleet-card-actions">

                            <select
                                class="select"
                                aria-label="Mechanical condition" title="Mechanical condition only; rental status is automatic"
                                onchange="App.changeVehicleStatus(
                                    '${vehicle.id}',
                                    this.value
                                )"
                            >
                                ${statuses.map(status => `
                                    <option
                                        value="${status}"
                                        ${selectedCondition === status ? 'selected' : ''}
                                        ${statuses.indexOf(status) < statuses.indexOf(minimumCondition) ? 'disabled' : ''}
                                    >
                                        ${status === 'available' ? 'Serviceable' : status.charAt(0).toUpperCase() + status.slice(1)}
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
                        ${minimumCondition !== 'available' ? `<div class="small muted" style="margin-top:8px">${recordCondition !== 'available' ? 'An open maintenance or incident record sets the minimum condition.' : 'A scheduled service is currently active.'} <button type="button" class="link-btn" onclick="App.openMaintenanceHistory('${esc(vehicle.id)}')">Review records</button> · <a href="#/admin/maintenance">Maintenance</a></div>` : ''}
                    </div>
                </article>
            `; }).join('')}

        </div>

        ${state.vehicles.length === 0
            ? '<div class="empty">No vehicles registered.</div>'
            : ''}
    `);
}

    // ---------- Admin: Reservations ----------
    function adminReservationCardStyles() {
        return `<style>
        .vera-reservations{min-width:0}
        .vera-reservations .res-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 16px;padding:0;border:0;overflow:visible}
        .vera-reservations .res-tab{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border,#30363d);border-radius:20px;background:var(--surface,#161b22);color:var(--text-muted,#9da7b3);padding:7px 12px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
        .vera-reservations .res-tab.active{border-color:var(--accent,#58a6ff);color:var(--accent,#58a6ff);background:var(--accent-soft,#172c42)}
        .vera-reservations .res-tab-count{font-variant-numeric:tabular-nums;font-weight:600}
        .vera-reservations .res-list{display:grid;gap:14px}
        .vera-reservations .res-card{min-width:0;border:1px solid var(--border,#30363d);border-radius:10px;background:var(--surface,#161b22);overflow:hidden}
        .vera-reservations .res-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--border,#30363d)}
        .vera-reservations .res-id{font-size:12px;color:var(--text-muted,#9da7b3);font-weight:600;letter-spacing:.025em}
        .vera-reservations .res-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:16px;padding:16px}
        .vera-reservations .res-section{min-width:0;display:flex;flex-direction:column;gap:10px}
        .vera-reservations .res-label{color:var(--text-muted,#9da7b3);font-size:11px;letter-spacing:.045em;text-transform:uppercase;font-weight:600}
        .vera-reservations .res-person,.vera-reservations .res-bike{display:flex;gap:12px;align-items:center;min-width:0}
        .vera-reservations .res-person-copy,.vera-reservations .res-bike-copy{min-width:0;display:grid;gap:4px;justify-items:start;overflow-wrap:anywhere}
        .vera-reservations .res-name{font-size:15px;font-weight:600;line-height:1.35;color:var(--text,#e6edf3);overflow-wrap:anywhere}
        .vera-reservations .res-avatar{position:relative;display:grid;place-items:center;width:64px;height:64px;flex:0 0 64px;border-radius:50%;overflow:hidden;background:var(--surface-alt,#21262d);border:1px solid var(--border,#30363d);font-size:20px;font-weight:600}
        .vera-reservations .res-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
        .vera-reservations .res-bike-thumb{position:relative;display:grid;place-items:center;width:120px;height:86px;flex:0 0 120px;background:#fff;border-radius:6px;overflow:hidden;color:#667085;text-align:center;font-size:11px}
        .vera-reservations .res-bike-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
        .vera-reservations .res-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
        .vera-reservations .res-date{display:grid;align-content:start;gap:3px;min-width:0;background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);border-radius:6px;padding:10px}
        .vera-reservations .res-date strong{font-size:13px;line-height:1.35;overflow-wrap:anywhere}
        .vera-reservations .res-date .res-time{font-size:13px;color:var(--accent,#58a6ff);font-weight:500}
        .vera-reservations .res-delivery{display:flex;flex-wrap:wrap;gap:5px 12px;line-height:1.45}
        .vera-reservations .res-footer{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;border-top:1px solid var(--border,#30363d);padding:12px 16px}
        .vera-reservations .res-finance{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
        .vera-reservations .res-finance-item{display:grid;gap:4px;justify-items:start}
        .vera-reservations .res-price{font-size:20px;line-height:1.25;font-weight:600;font-variant-numeric:tabular-nums}
        .vera-reservations .res-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .vera-reservations .res-actions .btn{min-height:36px;justify-content:center;padding:7px 13px}
        .vera-reservations .res-actions .btn-primary{min-width:100px}
        @media(max-width:640px){.vera-reservations .res-body{padding:12px;gap:18px}.vera-reservations .res-head,.vera-reservations .res-footer{padding:12px}.vera-reservations .res-actions{width:100%}.vera-reservations .res-actions .btn{flex:1 1 auto}.vera-reservations .res-bike-thumb{width:108px;flex-basis:108px}}
        </style>`;
    }
    function adminReservationDate(label, iso) {
        const d = new Date(iso);
        const valid = !!iso && Number.isFinite(d.getTime());
        const time = valid ? d.toLocaleTimeString('en-PH', {timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',hour12:true}) : '—';
        return `<div class="res-date"><span class="res-label">${esc(label)}</span><strong>${valid ? esc(fmtDateShort(iso)) : '—'}</strong><span class="res-time">${esc(time)}</span></div>`;
    }
    function adminReservationCard(r) {
        const v = getVehicle(r.vehicleId);
        const c = getCustomer(r.customerId) || state.customers.find(item => !r.customerId && item.email === r.customerEmail);
        const p = getPaymentByReservation(r.id);
        const name = c?.name || r.customerName || 'Unknown customer';
        const initials = name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('') || '?';
        const photo = safeCustomerImage(c?.profileImage);
        const bikePhoto = v?.imageUrlAlt || v?.imageUrl;
        const duration = Date.parse(r.end) - Date.parse(r.start);
        const billableDays = Number.isFinite(duration) && duration > 0 ? Math.ceil(duration / 86400000) : null;
        const paymentLabels = {pending:'Awaiting verification',verified:'Payment verified',rejected:'Proof rejected'};
        const paymentStatus = p ? (paymentLabels[p.status] || p.status || 'Unknown') : 'No payment recorded';
        const paymentClass = p && ['pending','verified','rejected'].includes(p.status) ? p.status : 'neutral';
        const [pickupMethod, returnMethod] = getDeliveryMethod(r).split(' & ');
        const id = esc(r.id);
        return `<article class="res-card">
            <div class="res-head"><span class="res-id">RESERVATION #${esc(String(r.id).toUpperCase())}</span>${statusBadge(r.status)}</div>
            <div class="res-body">
                <section class="res-section"><span class="res-label">Customer</span><div class="res-person">
                    <div class="res-avatar"><span aria-hidden="true">${esc(initials)}</span>${photo ? `<img src="${photo}" alt="${esc(name)} profile photo" onerror="this.remove()">` : ''}</div>
                    <div class="res-person-copy"><div class="res-name">${esc(name)}</div><div class="small muted">${esc(c?.email || r.customerEmail || '—')}</div>${c ? identityBadge(c) : '<span class="small muted">Profile unavailable</span>'}</div>
                </div></section>
                <section class="res-section"><span class="res-label">Motorcycle</span><div class="res-bike">
                    <div class="res-bike-thumb"><span>Image unavailable</span>${bikePhoto ? `<img src="${esc(bikePhoto)}" alt="${esc(v.name || 'Motorcycle')}" loading="lazy" onerror="this.remove()">` : ''}</div>
                    <div class="res-bike-copy"><div class="res-name">${esc(v ? [v.brand,v.name].filter(Boolean).join(' ') : r.vehicleId)}</div><div class="small muted">${esc([v?.year,v?.plateNumber].filter(Boolean).join(' · ') || '—')}</div>${v?.displacement ? `<div class="small muted">${esc(v.displacement)}cc</div>` : ''}</div>
                </div></section>
                <section class="res-section"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="res-label">Rental schedule (PHT)</span>${billableDays ? `<span class="small muted">${billableDays} billable day${billableDays === 1 ? '' : 's'}</span>` : ''}</div>
                    <div class="res-dates">${adminReservationDate('Pickup',r.start)}${adminReservationDate('Return',r.end)}</div>
                    <div class="res-delivery small muted">${returnMethod ? `<span>${esc(pickupMethod)}</span><span>· ${esc(returnMethod)}</span>` : `<span>${esc(pickupMethod)}</span>`}</div>
                </section>
            </div>
            <div class="res-footer"><div class="res-finance"><div class="res-finance-item"><span class="res-label">Rental fee</span><strong class="res-price">${fmtPHP(r.totalFee)}</strong>${r.overtimeFee ? `<span class="small muted">+ ${fmtPHP(r.overtimeFee)} overtime</span>` : ''}</div><div class="res-finance-item"><span class="res-label">Payment</span><span class="status status-${paymentClass}">${esc(paymentStatus)}</span></div></div>
            <div class="res-actions"><a href="#/admin/reservation/${id}" class="btn btn-primary">View details</a>
            </div></div>
        </article>`;
    }
    function renderAdminReservations() {
        const tab = state.ui.adminResTab || 'pending';
        const tabs = [['pending','Pending'],['approved','Approved'],['ongoing','Ongoing'],['completed','Completed'],['cancelled','Cancelled'],['rejected','Rejected']];
        const list = state.reservations.filter(r => r.status === tab).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        mount(`<div class="vera-reservations">${adminReservationCardStyles()}
            <div class="page-header"><div><h1 class="page-title">Reservations</h1><p class="page-desc">Review booking requests and manage rentals.</p></div></div>
            <div class="res-tabs" role="group" aria-label="Reservation status">${tabs.map(([k,l]) => `<button type="button" class="res-tab ${tab === k ? 'active' : ''}" aria-pressed="${tab === k}" onclick="App.setUI('adminResTab','${k}'); App.render()">${l}<span class="res-tab-count">${state.reservations.filter(r => r.status === k).length}</span></button>`).join('')}</div>
            ${list.length ? `<div class="res-list">${list.map(adminReservationCard).join('')}</div>` : `<div class="empty"><div class="empty-title">No ${esc(tab)} reservations</div><div>Reservations with this status will appear here.</div></div>`}
        </div>`);
    }
    function renderAdminReservationDetail(id) {
        renderReservationDetail(id, true);
    }
    // ---------- Admin: Payments ----------
    // ---------- Financial workspace (admin) ----------
    const finNum = n => Number.isFinite(Number(n)) ? Number(n) : 0;
    const finSum = (rows, f) => rows.reduce((n,x)=>n+finNum(f(x)),0);
    const finType = p => p.paymentType || 'rental';
    const finRef = x => String(x || '').trim().toUpperCase();
    const finDate = x => Number.isFinite(Date.parse(x)) ? fmtDate(x,{time:true}) : '—';
    const finExpected = p => {const r=getReservation(p.reservationId);return r ? finNum(finType(p)==='overtime'?r.overtimeFee:r.totalFee) : null;};
    const finPaid = (r,type) => finSum(state.payments.filter(p=>p.reservationId===r.id&&finType(p)===type&&p.status==='verified'),p=>p.amount);
    const finDue = r => Math.max(0,['approved','ongoing','completed'].includes(r.status)?finNum(r.totalFee)-finPaid(r,'rental'):0)+Math.max(0,r.status==='completed'?finNum(r.overtimeFee)-finPaid(r,'overtime'):0);
    const finDeposit = r => r.securityDeposit || null;
    const finDepositEligible = r => ['approved','ongoing','completed'].includes(r.status)||!!finDeposit(r);
    const finDepositStatus = r => finDeposit(r)?.status || 'awaiting collection';
    const finLabel = r => `${r.customerName || 'Unknown'} · ${getVehicle(r.vehicleId)?.name || r.vehicleId} · ${String(r.id).toUpperCase()}`;
    const finMetric = (l,v) => `<div class="metric"><div class="metric-label">${esc(l)}</div><div class="metric-value sm">${esc(v)}</div></div>`;
    const finEmpty = '<div class="empty">No matching records.</div>';
    function finTable(headers,rows){return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>${rows.length?'':finEmpty}</div>`;}
    function finTabs(items,active,key){return `<div class="chip-group mb-3">${items.map(([k,l])=>`<button class="chip ${active===k?'active':''}" onclick="App.setUI('${key}','${k}');App.render()">${esc(l)}</button>`).join('')}</div>`;}
    function finExport(name,rows){if(!adminOnly())return;const cell=v=>'"'+String(v??'').replace(/^\s*[=+\-@]/,m=>"'"+m).replace(/"/g,'""')+'"';const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);logActivity({module:'Reports',action:'Exported',entityId:name,description:'CSV export: '+name,changes:[]});}
    function finFilter(e){e.preventDefault();if(!adminOnly())return;const f=e.target.elements;Object.assign(state.ui,{finQuery:f.query.value.trim(),finMethod:f.method.value,finStatus:f.status.value});render();}
    function finPaymentRows(){const q=(state.ui.finQuery||'').toLowerCase(),m=state.ui.finMethod||'all',s=state.ui.finStatus||'all',tab=state.ui.finTab||'queue';return state.payments.filter(p=>{const r=getReservation(p.reservationId);return (tab!=='queue'||p.status==='pending')&&(m==='all'||p.method===m)&&(tab==='queue'||s==='all'||p.status===s)&&[p.id,p.referenceNumber,p.reservationId,p.method,r&&finLabel(r)].join(' ').toLowerCase().includes(q);}).sort((a,b)=>Date.parse(b.submittedAt)-Date.parse(a.submittedAt));}
    function finReservations(){const q=(state.ui.finQuery||'').toLowerCase();return state.reservations.filter(r=>[finLabel(r),r.customerEmail,r.refund?.referenceNumber,finDeposit(r)?.referenceNumber,finDeposit(r)?.returnReference].join(' ').toLowerCase().includes(q));}
    function finPaymentCard(p){const r=getReservation(p.reservationId),c=r&&getCustomer(r.customerId),v=r&&getVehicle(r.vehicleId),expected=finExpected(p);return `<div class="panel"><div class="panel-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><div style="display:flex;gap:12px;align-items:center;flex:1;min-width:190px">${c?customerAvatar(c):''}<div><strong>${esc(r?.customerName||'Unknown')}</strong><div class="small muted">${esc(v?.name||'—')} · ${esc(String(p.reservationId).toUpperCase())}</div><div class="small muted">${esc(finType(p))} · ${esc(p.method)}</div></div></div><div style="flex:1;min-width:150px"><div class="small muted">Submitted ${finDate(p.submittedAt)}</div>${statusBadge(p.status)}<div class="small muted">Ref: ${esc(p.referenceNumber||'Not recorded')}</div></div><div style="min-width:120px"><strong style="font-size:19px">${fmtPHP(p.amount)}</strong><div class="small muted">Expected ${expected===null?'—':fmtPHP(expected)}</div>${expected!==null&&finNum(p.amount)!==expected?'<div style="color:var(--danger)" class="small">Amount mismatch</div>':''}</div><div class="btn-group"><button class="btn ${p.status==='pending'?'btn-primary':''}" onclick="App.openPaymentModal('${esc(p.id)}')">${p.status==='pending'?'Review proof':'View proof'}</button>${p.status==='pending'?`<button class="btn btn-danger" onclick="App.openRejectPaymentModal('${esc(p.id)}')">Reject</button>`:''}</div></div></div>`;}
    function renderAdminPayments(filter){if(!adminOnly())return;if(filter==='pending'&&state.ui.finRoute!==location.hash)state.ui.finTab='queue';state.ui.finRoute=location.hash;const tab=state.ui.finTab||'queue',payments=state.payments,rs=finReservations(),rows=finPaymentRows(),refunds=state.reservations.filter(r=>r.refund?.status==='pending'),held=state.reservations.filter(r=>finDeposit(r)?.status==='held');let content='';const opt=(items,val)=>items.map(x=>`<option value="${esc(x)}" ${x===val?'selected':''}>${esc(x==='all'?'All':x)}</option>`).join('');
      if(tab==='queue')content=`<div class="stack">${rows.map(finPaymentCard).join('')||finEmpty}</div>`;
      if(tab==='transactions')content=`<div class="panel">${finTable(['Customer / reservation','Type','Method','Reference','Amount','Status','Action'],rows.map(p=>{const r=getReservation(p.reservationId);return [esc(r?finLabel(r):p.reservationId),esc(finType(p)),esc(p.method),esc(p.referenceNumber||'—'),fmtPHP(p.amount),statusBadge(p.status),`<button class="btn btn-sm" onclick="App.openPaymentModal('${esc(p.id)}')">Review</button>`];}))}</div>`;
      if(tab==='outstanding')content=`<div class="panel">${finTable(['Customer / rental','Rental due','Overtime due','Total due','Action'],rs.filter(r=>finDue(r)>0).map(r=>[esc(finLabel(r)),fmtPHP(Math.max(0,finNum(r.totalFee)-finPaid(r,'rental'))),fmtPHP(Math.max(0,finNum(r.overtimeFee)-finPaid(r,'overtime'))),fmtPHP(finDue(r)),`<a class="btn btn-sm" href="#/admin/reservation/${esc(r.id)}">View reservation</a>`]))}</div><p class="small muted mt-2">Approved, ongoing and completed rental charges only. Submitted but unverified proof is not a receipt.</p>`;
      if(tab==='refunds')content=`<div class="toolbar"><button class="btn btn-primary" onclick="App.openRefundSelection()">Assess refund</button></div><div class="panel">${finTable(['Customer / rental','Reason','Responsibility','Refund','Status','Action'],rs.filter(r=>r.refund?.amount>0).map(r=>[esc(finLabel(r)),esc(refundReasonLabel(r.refund)),esc(refundResponsibility(r.refund)),fmtPHP(r.refund.amount),esc(({pending:'Awaiting disbursement',disbursed:'Disbursed',received:'Acknowledged'})[r.refund.status]||r.refund.status),`<a class="btn btn-sm" href="#/admin/reservation/${esc(r.id)}">View</a> ${r.refund.status==='pending'?`<button class="btn btn-primary btn-sm" onclick="App.openRefundModal('${esc(r.id)}')">Record refund</button>`:''}`]))}</div>`;
      if(tab==='deposits')content=`<div class="callout small mb-3">Deposits are recorded separately from rental receipts. Only record money actually received or returned. Historical rentals with no deposit record are not assumed paid.</div><div class="panel">${finTable(['Customer / rental','Deposit','Status','Reference','Action'],rs.filter(finDepositEligible).map(r=>{const d=finDeposit(r);return [esc(finLabel(r)),fmtPHP(d?.amount??getDepositAmount()),esc(finDepositStatus(r)),esc(d?.referenceNumber||'—'),!d&&['approved','ongoing'].includes(r.status)?`<button class="btn btn-sm btn-primary" onclick="App.finDepositModal('${esc(r.id)}')">Record collection</button>`:d?.status==='held'&&['completed','cancelled'].includes(r.status)?`<button class="btn btn-sm btn-primary" onclick="App.finDepositModal('${esc(r.id)}')">Settle deposit</button>`:`<a class="btn btn-sm" href="#/admin/reservation/${esc(r.id)}">View</a>`];}))}</div>`;
      mount(`<div class="page-header"><div><h1 class="page-title">Payments &amp; Refunds</h1><p class="page-desc">Review proofs, reconcile balances and record refunds and deposits.</p></div><button class="btn" onclick="App.finExportPayments()">Export CSV</button></div><div class="metrics mb-3">${finMetric('Awaiting verification',payments.filter(p=>p.status==='pending').length)}${finMetric('Verified payments · all time',fmtPHP(finSum(payments.filter(p=>p.status==='verified'),p=>p.amount)))}${finMetric('Outstanding balances',fmtPHP(finSum(state.reservations,finDue)))}${finMetric('Pending refunds',fmtPHP(finSum(refunds,r=>r.refund.amount)))}</div>${finTabs([['queue','Verification queue'],['transactions','Transactions'],['outstanding','Outstanding'],['refunds','Refunds'],['deposits','Security deposits']],tab,'finTab')}<form class="toolbar" onsubmit="App.finFilter(event)"><input name="query" class="input grow" placeholder="Search customer, reservation, reference..." value="${esc(state.ui.finQuery||'')}"><select class="select" name="method" ${['queue','transactions'].includes(tab)?'':'disabled'}>${opt(['all',...new Set(payments.map(p=>p.method))],state.ui.finMethod||'all')}</select><select class="select" name="status" ${tab==='transactions'?'':'disabled'}>${opt(['all','pending','verified','rejected'],tab==='queue'?'all':state.ui.finStatus||'all')}</select><button class="btn">Filter</button></form>${tab==='deposits'?`<p class="muted small mb-3">Currently held: ${fmtPHP(finSum(held,r=>finDeposit(r).amount))}</p>`:''}${content}`);
    }
    function finExportPayments(){const tab=state.ui.finTab||'queue',rs=finReservations();let rows;if(tab==='refunds')rows=[['Reservation','Customer','Amount','Status','Reference'],...rs.filter(r=>r.refund?.amount>0).map(r=>[r.id,r.customerName,r.refund.amount,r.refund.status,r.refund.referenceNumber])];else if(tab==='outstanding')rows=[['Reservation','Customer','Outstanding'],...rs.filter(r=>finDue(r)>0).map(r=>[r.id,r.customerName,finDue(r)])];else if(tab==='deposits')rows=[['Reservation','Customer','Deposit','Status','Returned','Applied to overtime'],...rs.filter(finDepositEligible).map(r=>[r.id,r.customerName,finDeposit(r)?.amount??getDepositAmount(),finDepositStatus(r),finDeposit(r)?.returnedAmount,finDeposit(r)?.appliedOvertime])];else rows=[['Payment','Reservation','Type','Method','Amount','Status','Reference','Verified at'],...finPaymentRows().map(p=>[p.id,p.reservationId,finType(p),p.method,p.amount,p.status,p.referenceNumber,p.verifiedAt])];finExport('vera-'+tab,rows);}
    function finDuplicate(p,ref){return !!finRef(ref)&&(state.payments.some(x=>x.id!==p.id&&x.status!=='rejected'&&finRef(x.referenceNumber)===finRef(ref))||state.reservations.some(r=>[finDeposit(r)?.referenceNumber,finDeposit(r)?.returnReference,r.refund?.referenceNumber].some(x=>finRef(x)===finRef(ref))));}
    function openPaymentModal(pid){if(!adminOnly())return;const p=state.payments.find(x=>x.id===pid);if(!p)return;const r=getReservation(p.reservationId),expected=finExpected(p),pending=p.status==='pending',match=expected!==null&&expected===finNum(p.amount);openModal(`<div class="modal" style="width:min(900px,96vw);max-width:900px"><div class="modal-header"><div class="modal-title">Review payment</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><form onsubmit="App.finVerify(event,'${esc(pid)}')"><div class="modal-body stack"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px"><div><div class="proof-preview" style="min-height:180px">${p.proofDataUrl?`<img src="${esc(p.proofDataUrl)}" alt="Payment proof" style="max-height:420px;object-fit:contain;max-width:100%">`:'<span class="muted">No proof image recorded</span>'}</div>${p.proofDataUrl?`<a class="btn btn-sm mt-2" href="${esc(p.proofDataUrl)}" target="_blank" rel="noopener">Open image</a>`:''}</div><div class="stack"><strong>${esc(r?finLabel(r):p.reservationId)}</strong>${statusBadge(p.status)}<div>Method: ${esc(p.method)}</div><div>Expected: <strong>${expected===null?'Unknown':fmtPHP(expected)}</strong></div><div>Submitted: <strong>${fmtPHP(p.amount)}</strong></div><div class="small muted">Submitted ${finDate(p.submittedAt)}</div>${!match?'<div class="callout danger">Amount does not match the charge.</div>':''}${p.rejectReason?`<div class="callout danger">${esc(p.rejectReason)}</div>`:''}${pending?`<label class="field"><span class="field-label">Transaction reference (from receiving account)</span><input class="input" name="reference" value="${esc(p.referenceNumber||'')}" required maxlength="100"></label><label><input type="checkbox" name="amountChecked" required> Amount and reference checked</label><label><input type="checkbox" name="received" required> Funds confirmed in receiving account</label><p class="small muted">Duplicate references are checked automatically.</p>`:`<div>Reference: ${esc(p.referenceNumber||'Not recorded')}</div><div class="small muted">Verified by ${esc(p.verifiedBy||'—')} · ${finDate(p.verifiedAt)}</div>`}</div></div></div><div class="modal-footer">${pending?`<button type="button" class="btn btn-danger" onclick="App.openRejectPaymentModal('${esc(pid)}')">Reject</button><button type="submit" class="btn btn-primary" ${match&&p.proofDataUrl?'':'disabled'}>Verify payment</button>`:'<button type="button" class="btn" onclick="App.closeModal()">Close</button>'}</div></form></div>`);}
    function verifyPayment(pid){openPaymentModal(pid);}
    function finVerify(e,pid){e.preventDefault();if(!adminOnly())return;const p=state.payments.find(x=>x.id===pid),f=e.target.elements,r=p&&getReservation(p.reservationId),ref=f.reference.value.trim();if(!p||!r||p.status!=='pending'||!p.proofDataUrl||!ref||!f.amountChecked.checked||!f.received.checked)return toast('Complete the verification checks.','error');if(finExpected(p)!==finNum(p.amount)||finNum(p.amount)<=0)return toast('Amount does not match.','error');if(finDuplicate(p,ref))return toast('Duplicate payment reference.','error');if(finPaid(r,finType(p))>0)return toast('This charge is already settled.','error');if(finType(p)==='rental'&&r.status!=='approved'||finType(p)==='overtime'&&r.status!=='completed')return toast('Reservation is not eligible for this payment.','error');Object.assign(p,{referenceNumber:ref,status:'verified',verifiedAt:new Date().toISOString(),verifiedBy:'Admin',rejectReason:''});if(finType(p)==='overtime'&&r.overtime)r.overtime.paymentStatus='paid';notify('customer','Payment verified',`Your ${finType(p)} payment has been verified.`,`#/customer/reservation/${r.id}`,r.customerId);closeModal();toast('Payment verified.','success');render();}
    function finDepositPanel(r,admin){const d=finDeposit(r);if(!finDepositEligible(r))return '';return reservationPanel('Security deposit',`<div class="kv"><div class="k">Amount</div><div>${fmtPHP(d?.amount??getDepositAmount())}</div><div class="k">Status</div><div>${esc(finDepositStatus(r))}</div>${d?.status==='settled'?`<div class="k">Returned</div><div>${fmtPHP(d.returnedAmount)}</div><div class="k">Applied to overtime</div><div>${fmtPHP(d.appliedOvertime)}</div>`:''}</div>${admin&&(!d&&['approved','ongoing'].includes(r.status)||d?.status==='held'&&['completed','cancelled'].includes(r.status))?`<button class="btn btn-block mt-2" onclick="App.finDepositModal('${esc(r.id)}')">${d?'Settle deposit':'Record collection'}</button>`:''}<p class="muted small mt-2">Refundable deposit is separate from rental payment.</p>`);}
    function finDepositModal(id){if(!adminOnly())return;const r=getReservation(id);if(!r)return;const d=finDeposit(r),settle=d?.status==='held';if(d&&!settle||settle&&!['completed','cancelled'].includes(r.status)||!d&&!['approved','ongoing'].includes(r.status))return;const ot=r.status==='completed'&&['unpaid','rejected'].includes(overtimeStatus(r))?finNum(r.overtimeFee):0;openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${settle?'Settle deposit':'Record deposit collection'}</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><form onsubmit="App.finSaveDeposit(event,'${esc(id)}')"><div class="modal-body stack"><strong>${esc(finLabel(r))}</strong><div>Deposit: ${fmtPHP(d?.amount??getDepositAmount())}</div>${settle&&ot>0&&ot<=d.amount?`<label><input type="checkbox" name="apply"> Apply ${fmtPHP(ot)} to the full unpaid overtime charge (includes assessed add-ons)</label>`:''}<label class="field"><span class="field-label">${settle?'Return / settlement':'Collection'} reference</span><input class="input" name="reference" required maxlength="100"></label><label class="field"><span class="field-label">Notes / justification</span><textarea class="input" name="notes" required maxlength="500"></textarea></label><label><input type="checkbox" name="confirmed" required> ${settle?'I confirm the remaining deposit has been returned externally, or the entire amount was applied to the charge.':'I confirm the deposit was actually received.'}</label><p class="small muted">No automatic money transfer. Partial overtime payments are not supported.</p></div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Record</button></div></form></div>`);}
    function finSaveDeposit(e,id){e.preventDefault();if(!adminOnly())return;const r=getReservation(id),f=e.target.elements,ref=f.reference.value.trim(),notes=f.notes.value.trim(),now=new Date().toISOString();if(!r||!ref||!notes||!f.confirmed.checked)return;const d=finDeposit(r);if(finDuplicate({id:null},ref))return toast('Deposit reference already recorded.','error');if(!d&&['approved','ongoing'].includes(r.status)){r.securityDeposit={amount:getDepositAmount(),status:'held',referenceNumber:ref,notes,collectedAt:now,collectedBy:'Admin'};}else if(d?.status==='held'&&['completed','cancelled'].includes(r.status)){let applied=0;if(f.apply?.checked){applied=finNum(r.overtimeFee);if(r.status!=='completed'||!['unpaid','rejected'].includes(overtimeStatus(r))||applied<=0||applied>d.amount)return toast('Overtime no longer eligible.','error');const p=getPaymentByReservation(id,'overtime'),values={reservationId:id,paymentType:'overtime',method:'Security deposit',amount:applied,status:'verified',submittedAt:now,verifiedAt:now,verifiedBy:'Admin',referenceNumber:'DEPOSIT-'+ref,rejectReason:'',proofDataUrl:''};if(p)Object.assign(p,values);else state.payments.unshift({id:uid('p'),...values});if(r.overtime)r.overtime.paymentStatus='paid';}Object.assign(d,{status:'settled',returnedAmount:d.amount-applied,appliedOvertime:applied,returnReference:ref,settlementNotes:notes,settledAt:now,settledBy:'Admin'});}else return;logActivity({module:'Payments',action:d?'Deposit settled':'Deposit collected',entityId:id,description:finLabel(r),link:'#/admin/reservation/'+id,changes:[]});closeModal();toast('Deposit record saved.','success');render();}
    // ---------- Admin: Maintenance ----------
    function maintenanceDue(v) {
        const date = v.serviceDueDate || '', km = v.serviceDueMileage;
        if (!date && km == null) return 'Not configured';
        if ((date && date <= todayKey()) || (km != null && v.odometer != null && v.odometer >= km)) return 'Due';
        if ((date && Date.parse(date + 'T00:00:00+08:00') - Date.parse(todayKey() + 'T00:00:00+08:00') <= 7 * 86400000) || (km != null && v.odometer != null && km - v.odometer <= 500)) return 'Due soon';
        return 'Up to date';
    }
    function maintenanceTileStyles() {
        return `<style>
        .vera-maint .maint-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
        .vera-maint .maint-filter{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px}
        .vera-maint .maint-count{margin-left:3px}
        .vera-maint .maint-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:stretch}
        .vera-maint .maint-tile{display:flex;flex-direction:column;min-width:0;border:1px solid var(--border,#30363d);border-radius:6px;background:var(--panel,#161b22);overflow:hidden}
        .vera-maint .maint-attention{border-top:2px solid #e3b341}
        .vera-maint .maint-bike-heading{display:flex;gap:12px;padding:14px;align-items:center;border-bottom:1px solid var(--border,#30363d);min-height:124px;box-sizing:border-box}
        .vera-maint .maint-bike-image{width:116px;height:84px;flex:0 0 116px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:#fff;overflow:hidden}
        .vera-maint .maint-bike-image img{display:block;width:100%;height:100%;object-fit:contain}
        .vera-maint .maint-bike-name{min-width:0;display:flex;flex-direction:column;gap:4px;align-items:flex-start}
        .vera-maint .maint-bike-name h2{font-size:18px;line-height:1.25;margin:0;overflow-wrap:anywhere}
        .vera-maint .maint-bike-name p{margin:0}
        .vera-maint .maint-bike-name .mono{font-size:11px}
        .vera-maint .maint-tile-body{padding:14px;flex:1;display:flex;flex-direction:column;gap:10px}
        .vera-maint .maint-section-head,.maint-history-modal .maint-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
        .vera-maint .maint-specs{margin:0;display:grid;gap:6px;font-size:12px}
        .vera-maint .maint-specs>div{display:flex;justify-content:space-between;gap:10px}
        .vera-maint .maint-specs dt{color:var(--muted,#8babc6)}
        .vera-maint .maint-specs dd{margin:0;text-align:right}
        .vera-maint .maint-mini{background:var(--bg,#0f141a);border:1px solid var(--border,#30363d);border-radius:4px;padding:10px;margin:0;overflow-wrap:anywhere}
        .vera-maint .maint-mini p{margin:4px 0}
        .vera-maint .maint-mini-footer{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:8px}
        .vera-maint .maint-alert{color:#e3b341}
        .vera-maint .maint-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px 14px;border-top:1px solid var(--border,#30363d)}
        .vera-maint .maint-actions .btn{width:100%;white-space:normal;min-height:34px}
        .maint-history-modal{width:min(720px,94vw);max-width:720px}
        .maint-history-modal .modal-body{max-height:65vh;overflow:auto}
        .vera-maint .maint-record,.maint-history-modal .maint-record{border:1px solid var(--border,#30363d);border-radius:5px;padding:12px;display:grid;gap:8px;overflow-wrap:anywhere}
        .vera-maint .maint-record-top,.maint-history-modal .maint-record-top,.vera-maint .maint-record-meta,.maint-history-modal .maint-record-meta{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
        .vera-maint .maint-description,.maint-history-modal .maint-description{margin:0;white-space:pre-wrap}
        @media(max-width:1150px){.vera-maint .maint-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:700px){.vera-maint .maint-grid{grid-template-columns:minmax(0,1fr)}.vera-maint .maint-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
        </style>`;
    }
    function maintenanceTileData(vehicle) {
        const logs = state.maintenanceLogs.filter(l => l.vehicleId === vehicle.id)
            .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
        const open = logs.filter(l => l.status === 'open');
        const services = state.opsServices.filter(s => s.vehicleId === vehicle.id)
            .sort((a, b) => new Date(a.start) - new Date(b.start));
        const scheduled = services.filter(s => s.status === 'scheduled');
        const due = maintenanceDue(vehicle);
        const needsAttention = open.length > 0 || ['Due', 'Due soon'].includes(due) ||
            vehicleOperationalState(vehicle).condition !== 'available' || vehicleOperationalState(vehicle).service;
        return { vehicle, logs, open, services, scheduled, due, needsAttention };
    }

    function maintenancePlanBadge(due) {
        const cls = { 'Due': 'open', 'Due soon': 'pending', 'Up to date': 'available', 'Not configured': 'neutral' };
        return `<span class="status status-${cls[due] || 'neutral'}">${esc(due)}</span>`;
    }

    function maintenanceKm(value) {
        return value == null || value === '' ? '—' : `${Number(value).toLocaleString('en-PH')} km`;
    }

    function maintenanceRecordHTML(log) {
        return `<div class="maint-record">
            <div class="maint-record-top"><span class="status ${log.type === 'incident' ? 'status-malfunction' : 'status-approved'}">${esc(log.type)}</span>${statusBadge(log.status)}</div>
            <strong>${esc(log.title)}</strong>
            <p class="muted small maint-description">${esc(log.description)}</p>
            <div class="maint-record-meta"><span>${fmtDate(log.reportedAt, {time:true})}</span><span>${fmtPHP(log.cost || 0)}</span></div>
            <div class="small muted">Damage: ${esc(damageLabel(log.damageLocation))} · ${(log.photos || []).length} photo(s)${log.resolvedAt ? ` · Resolved ${fmtDateShort(log.resolvedAt)}` : ''}</div>
            <button class="btn btn-sm" onclick="App.viewMaintenance('${esc(log.id)}')">View record</button>
        </div>`;
    }

    function maintenanceTileHTML(item) {
        const { vehicle: v, open, logs, scheduled, due, needsAttention } = item;
        const next = scheduled[0];
        const latest = open[0] || logs[0];
        const id = esc(v.id);
        return `<article class="maint-tile ${needsAttention ? 'maint-attention' : ''}">
            <div class="maint-bike-heading">
                <div class="maint-bike-image">${vehicleImage(v)}</div>
                <div class="maint-bike-name"><h2>${esc(v.name)}</h2><p class="muted small">${esc(v.brand)} · ${esc(v.year)}</p><span class="mono muted">${esc(v.plateNumber)}</span>${vehicleOperationalBadges(v)}</div>
            </div>
            <div class="maint-tile-body">
                <div class="maint-section-head"><strong>Service plan</strong>${maintenancePlanBadge(due)}</div>
                <dl class="maint-specs">
                    <div><dt>Odometer</dt><dd>${maintenanceKm(v.odometer)}</dd></div>
                    <div><dt>Next service date</dt><dd>${v.serviceDueDate ? fmtDateShort(v.serviceDueDate + 'T00:00:00+08:00') : '—'}</dd></div>
                    <div><dt>Next service odometer</dt><dd>${maintenanceKm(v.serviceDueMileage)}</dd></div>
                </dl>
                <div class="maint-section-head"><strong>Scheduled service</strong><span class="muted small">${scheduled.length} planned</span></div>
                ${next ? `<div class="maint-mini"><strong>${esc(next.title)}</strong><p class="small muted">${fmtDate(next.start,{time:true})}</p><div class="maint-mini-footer"><span class="muted small">${fmtDateShort(next.end)}</span><button class="btn btn-sm" onclick="App.openServiceModal('${id}','','${esc(next.id)}')">Manage</button></div></div>` : '<p class="small muted maint-mini">No upcoming service scheduled.</p>'}
                <div class="maint-section-head"><strong>${open.length ? 'Open issues' : 'Latest record'}</strong><span class="${open.length ? 'maint-alert' : 'muted'} small">${open.length} open · ${logs.length} total</span></div>
                ${latest ? `<div class="maint-mini"><strong>${esc(latest.title)}</strong><p class="small muted">${fmtDateShort(latest.reportedAt)} · ${fmtPHP(latest.cost || 0)}</p><div class="maint-mini-footer">${statusBadge(latest.status)}<button class="btn btn-sm" onclick="App.viewMaintenance('${esc(latest.id)}')">View</button></div></div>` : '<p class="small muted maint-mini">No maintenance records yet.</p>'}
            </div>
            <div class="maint-actions">
                <button class="btn" onclick="App.openServicePlan('${id}')">Service plan</button>
                <button class="btn" onclick="App.openServiceModal('${id}')">Schedule service</button>
                <button class="btn" onclick="App.openMaintenanceHistory('${id}')">History</button>
                <button class="btn btn-primary" onclick="App.openMaintenanceModal(null, '${id}')">Log entry</button>
            </div>
        </article>`;
    }

    function renderAdminMaintenance() {
        if (!adminOnly()) return;
        const items = state.vehicles.map(maintenanceTileData);
        const attention = items.filter(x => x.needsAttention);
        const scheduled = items.filter(x => x.scheduled.length);
        const unconfigured = items.filter(x => x.due === 'Not configured');
        const filters = [
            ['all', 'All motorcycles', items],
            ['attention', 'Needs attention', attention],
            ['scheduled', 'Scheduled', scheduled],
            ['unconfigured', 'No service plan', unconfigured]
        ];
        const selected = filters.find(([key]) => key === state.ui.maintenanceTileFilter) || filters[0];
        const visible = selected[2].slice().sort((a,b) => Number(b.needsAttention) - Number(a.needsAttention));
        const orphanLogs = state.maintenanceLogs.filter(l => !getVehicle(l.vehicleId));
        mount(`${maintenanceTileStyles()}<section class="vera-maint"><div class="page-header"><div><h1 class="page-title">Maintenance and incidents</h1><p class="page-desc">Manage service plans, scheduled work and motorcycle condition in one place.</p></div><div class="btn-group"><button class="btn" onclick="App.openServiceModal()">Schedule service</button><button class="btn btn-primary" onclick="App.openMaintenanceModal()">Log entry</button></div></div>
            <div class="metrics maint-metrics mb-3">${[
                ['Motorcycles', items.length], ['Needs attention', attention.length],
                ['Open records', state.maintenanceLogs.filter(l => l.status === 'open').length],
                ['Scheduled jobs', state.opsServices.filter(s => s.status === 'scheduled').length]
            ].map(([label,value]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('')}</div>
            <div class="maint-filter chip-group" aria-label="Filter maintenance vehicles">${filters.map(([key,label,list]) => `<button class="chip ${selected[0] === key ? 'active' : ''}" aria-pressed="${selected[0] === key}" onclick="App.setUI('maintenanceTileFilter','${key}'); App.render()">${label} <span class="maint-count">${list.length}</span></button>`).join('')}</div>
            ${visible.length ? `<div class="maint-grid">${visible.map(maintenanceTileHTML).join('')}</div>` : '<div class="empty"><div class="empty-title">No motorcycles match this filter</div>Choose another filter to see the fleet.</div>'}
            ${orphanLogs.length ? `<section class="section mt-3"><h2 class="section-title mb-2">Records without a matching motorcycle</h2><div class="stack">${orphanLogs.map(maintenanceRecordHTML).join('')}</div></section>` : ''}</section>`);
    }

    function openMaintenanceHistory(id) {
        if (state.role !== 'admin') return;
        const vehicle = getVehicle(id);
        if (!vehicle) return;
        const { logs, services } = maintenanceTileData(vehicle);
        openModal(`<div class="modal maint-history-modal"><div class="modal-header"><div><div class="modal-title">${esc(vehicle.name)} — maintenance history</div><div class="muted small">${esc(vehicle.plateNumber)}</div></div><button class="icon-btn" aria-label="Close" onclick="App.closeModal()">&times;</button></div>
            <div class="modal-body stack"><div class="maint-section-head"><h3>Scheduled service</h3></div>
            ${services.length ? services.map(s => `<div class="maint-record"><div class="maint-record-top"><strong>${esc(s.title)}</strong><span class="status status-${s.status === 'scheduled' ? 'approved' : s.status === 'completed' ? 'completed' : 'neutral'}">${esc(s.status)}</span></div><div class="small muted">${fmtDate(s.start,{time:true})} – ${fmtDate(s.end,{time:true})}</div>${s.status === 'scheduled' ? `<div class="btn-group"><button class="btn btn-sm btn-primary" onclick="App.openServiceModal('${esc(s.vehicleId)}','','${esc(s.id)}')">Manage / complete</button><button class="btn btn-sm btn-danger" onclick="App.finishService('${esc(s.id)}','cancelled')">Cancel</button></div>` : ''}</div>`).join('') : '<p class="muted small">No scheduled service records.</p>'}
            <div class="divider"></div><h3>Maintenance and incident records</h3>
            ${logs.length ? logs.map(maintenanceRecordHTML).join('') : '<p class="muted small">No records yet.</p>'}</div>
            <div class="modal-footer"><button class="btn" onclick="App.closeModal()">Close</button><button class="btn btn-primary" onclick="App.openMaintenanceModal(null, '${esc(id)}')">Log entry</button></div></div>`);
    }
    // ---------- Admin: Reports ----------
    // ---------- Reports & analytics ----------
    function reportPeriod(){const now=Date.now(),tk=todayKey(),[y,m]=tk.split('-').map(Number),day=86400000,month=(yy,mm)=>Date.UTC(yy,mm-1,1)-8*3600000;let a=month(y,m),b=Math.min(month(y,m+1),now),range=state.ui.reportRange||'month';if(range==='last'){a=month(y,m-1);b=month(y,m);}if(range==='all'){const stamps=[...state.reservations.flatMap(r=>[r.createdAt,r.start]),...state.payments.map(p=>p.verifiedAt),...state.maintenanceLogs.map(l=>l.reportedAt)].map(Date.parse).filter(x=>Number.isFinite(x)&&x<=now);a=stamps.length?Date.parse(toManilaDateKey(new Date(Math.min(...stamps)).toISOString())+'T00:00:00+08:00'):Date.parse(tk+'T00:00:00+08:00');b=now;}if(range==='custom'){const x=Date.parse((state.ui.reportFrom||tk)+'T00:00:00+08:00'),z=Date.parse((state.ui.reportTo||tk)+'T00:00:00+08:00')+day;if(Number.isFinite(x)&&Number.isFinite(z)&&x<z){a=x;b=Math.min(z,now);}}return {a,b:Math.max(a,b),now,range};}
    function reportIn(x,a,b){const t=Date.parse(x);return Number.isFinite(t)&&t>=a&&t<b;}
    function reportUnion(intervals,a,b){let total=0,end=a;for(const [s,e] of intervals.map(([s,e])=>[Math.max(a,s),Math.min(b,e)]).filter(([s,e])=>Number.isFinite(s)&&Number.isFinite(e)&&e>s).sort((x,y)=>x[0]-y[0])){total+=Math.max(0,e-Math.max(s,end));end=Math.max(end,e);}return total/86400000;}
    function reportStats(a,b){const inR=x=>reportIn(x,a,b),now=Date.now(),rs=state.reservations,pay=state.payments.filter(p=>p.status==='verified'&&inR(p.verifiedAt)),completed=rs.filter(r=>r.status==='completed'&&inR(r.actualReturn||r.end)),created=rs.filter(r=>inR(r.createdAt)),refunds=rs.filter(r=>refundDeducted(r)>0&&inR(r.refund.refundedAt)),logs=state.maintenanceLogs.filter(l=>l.status==='resolved'&&inR(l.resolvedAt)),rental=finSum(pay.filter(p=>finType(p)==='rental'),p=>p.amount),ot=finSum(pay.filter(p=>finType(p)==='overtime'),p=>p.amount),applied=finSum(pay.filter(p=>p.method==='Security deposit'),p=>p.amount),ref=finSum(refunds,r=>r.refund.amount),cost=finSum(logs,l=>l.cost),fleet=state.vehicles.map(v=>{const own=rs.filter(r=>r.vehicleId===v.id),paid=pay.filter(p=>getReservation(p.reservationId)?.vehicleId===v.id),days=reportUnion(own.filter(r=>['ongoing','completed'].includes(r.status)).map(r=>[Date.parse(r.startedAt||r.start),r.status==='ongoing'?now:Date.parse(r.actualReturn||r.end)]),a,b),downtime=reportUnion(state.maintenanceLogs.filter(l=>l.vehicleId===v.id).map(l=>[Date.parse(l.reportedAt),l.status==='open'?now:Date.parse(l.resolvedAt)]),a,b);return {v,days,downtime,pct:b>a?days/((b-a)/86400000)*100:0,receipts:finSum(paid,p=>p.amount),cost:finSum(logs.filter(l=>l.vehicleId===v.id),l=>l.cost),count:completed.filter(r=>r.vehicleId===v.id).length};}),newCustomers=state.customers.filter(c=>inR(c.joinedAt)),renters=[...new Set(completed.map(r=>r.customerId).filter(Boolean))],repeat=renters.filter(id=>rs.filter(r=>r.customerId===id&&r.status==='completed'&&Date.parse(r.actualReturn||r.end)<b).length>=2).length,late=completed.filter(r=>Date.parse(r.actualReturn)>Date.parse(r.end)).length;return {pay,completed,created,refunds,logs,rental,ot,applied,ref,cost,net:rental+ot-ref,fleet,newCustomers,renters,repeat,late,billed:finSum(completed,r=>r.totalFee),assessed:finSum(completed,r=>r.overtimeFee),depositIn:finSum(rs.filter(r=>inR(finDeposit(r)?.collectedAt)),r=>finDeposit(r).amount),depositOut:finSum(rs.filter(r=>inR(finDeposit(r)?.settledAt)),r=>finDeposit(r).returnedAmount)};}
    function reportBars(title,rows,format=x=>String(x)){const max=Math.max(1,...rows.map(r=>Math.max(0,r[1])));return reservationPanel(title,rows.length?rows.map(([label,n])=>`<div class="bar-row"><div class="bar-label"><span>${esc(label)}</span><strong>${esc(format(n))}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,n)/max*100}%"></div></div></div>`).join(''):finEmpty);}
    const reportBike=v=>`${v.name} · ${v.plateNumber}`;
    const reportPct=(n,d)=>d?`${(100*n/d).toFixed(1)}%`:'—';
    function reportMetrics(items){return `<div class="metrics mb-3">${items.map(([l,v])=>finMetric(l,v)).join('')}</div>`;}
    function reportRangeChange(e){e.preventDefault();const f=e.target.elements;if(!f.from.value||!f.to.value||f.from.value>f.to.value||f.from.value>todayKey())return toast('Select a valid date range.','error');Object.assign(state.ui,{reportFrom:f.from.value,reportTo:f.to.value,reportRange:'custom'});render();}
    function reportRows(tab,s){switch(tab){case 'fleet':return [['Motorcycle','Plate','Completed rentals','Occupied days','Utilization %','Estimated mechanical hold days','Verified receipts','Maintenance cost'],...s.fleet.map(x=>[x.v.name,x.v.plateNumber,x.count,x.days.toFixed(2),x.pct.toFixed(1),x.downtime.toFixed(2),x.receipts,x.cost])];case 'reservations':return [['Reservation','Customer','Vehicle','Created','Status','Start','End'],...s.created.map(r=>[r.id,r.customerName,getVehicle(r.vehicleId)?.name,r.createdAt,r.status,r.start,r.end])];case 'customers':return [['Customer','Joined','Verification','Completed rentals in range'],...state.customers.filter(c=>s.renters.includes(c.id)||s.newCustomers.includes(c)).map(c=>[c.name,c.joinedAt,identityStatus(c),s.completed.filter(r=>r.customerId===c.id).length])];case 'maintenance':return [['Record','Vehicle','Type','Cost','Resolved'],...s.logs.map(l=>[l.title,getVehicle(l.vehicleId)?.name,l.type,l.cost,l.resolvedAt])];default:return [['Metric','PHP'],['Billed completed rental',s.billed],['Rental receipts',s.rental],['Overtime assessed on completed rentals',s.assessed],['Overtime settled',s.ot],['Of which applied from deposit',s.applied],['Refunds disbursed',s.ref],['Net operating receipts',s.net],['Resolved maintenance cost',s.cost],['Contribution after recorded maintenance',s.net-s.cost],['Deposit collected',s.depositIn],['Deposit returned',s.depositOut]];}}
    function reportExport(){const p=reportPeriod(),tab=state.ui.reportTab||'financial';finExport('vera-report-'+tab,reportRows(tab,reportStats(p.a,p.b)));}
    function renderAdminReports(){if(!adminOnly())return;const p=reportPeriod(),s=reportStats(p.a,p.b),tab=state.ui.reportTab||'financial',fmt=n=>fmtPHP(n),day=86400000,avg=s.completed.length?finSum(s.completed,r=>Math.max(0,(Date.parse(r.actualReturn||r.end)-Date.parse(r.startedAt||r.start))/day))/s.completed.length:0,util=s.fleet.length&&p.b>p.a?finSum(s.fleet,x=>x.pct)/s.fleet.length:0;let content='',insights=[];const compare=state.ui.reportCompare&&p.range!=='all'?reportStats(p.a-(p.b-p.a),p.a):null;const groups=Object.keys(DISPLACEMENT_CLASSES).map(k=>[k+'cc',s.created.filter(r=>String(getVehicle(r.vehicleId)?.displacement)===k).length]);const top=groups.slice().sort((a,b)=>b[1]-a[1])[0],high=s.fleet.slice().sort((a,b)=>b.cost-a.cost)[0];if(top?.[1])insights.push(`Highest request volume: ${top[0]} (${top[1]} requests). Review fleet allocation before expanding.`);if(high?.cost>0)insights.push(`${reportBike(high.v)} has the highest resolved maintenance cost (${fmt(high.cost)}). Review cost relative to receipts.`);if(s.late)insights.push(`${s.late} completed rentals returned late in this period. Consider pickup scheduling buffers.`);const due=finSum(state.reservations,finDue);if(due>0)insights.push(`${fmt(due)} in current outstanding balances. Review the Outstanding tab.`);
      if(tab==='financial'){const trend=[];let cursor=new Date(p.a+8*3600000);cursor=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth(),1));for(let i=0;i<240&&cursor.getTime()-8*3600000<p.b;i++){const a=Math.max(p.a,cursor.getTime()-8*3600000),next=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1)),b=Math.min(p.b,next.getTime()-8*3600000);if(b>a)trend.push([cursor.toLocaleString('en-PH',{month:'short',year:'numeric',timeZone:'UTC'}),reportStats(a,b).net]);cursor=next;}content=reportMetrics([['Rental receipts',fmt(s.rental)],['Overtime settled',fmt(s.ot)],['Refunds disbursed',fmt(s.ref)],['Net operating receipts',fmt(s.net)]])+reportMetrics([['Billed completed rentals',fmt(s.billed)],['Overtime assessed',fmt(s.assessed)],['Recorded maintenance costs',fmt(s.cost)],['Contribution after maintenance',fmt(s.net-s.cost)]])+`<div class="grid-2 mb-3">${reportBars('Net operating receipts by month',trend,fmt)}${reportBars('Verified receipts by motorcycle',s.fleet.map(x=>[reportBike(x.v),x.receipts]).sort((a,b)=>b[1]-a[1]),fmt)}</div>${reservationPanel('Security deposit movements',`<div class="kv"><div class="k">Collected</div><div>${fmt(s.depositIn)}</div><div class="k">Returned</div><div>${fmt(s.depositOut)}</div><div class="k">Applied to overtime</div><div>${fmt(s.applied)}</div></div><p class="small muted mt-2">Deposit collections and returns are not rental revenue. Applied deposits are included in overtime settled once, as an internal allocation.</p>`)}<p class="small muted mt-2">Receipts use verification dates; refunds use disbursement dates. Contribution is not profit; other expenses and taxes are not recorded. Negative monthly values are labeled, not drawn as positive bars.</p>`;}
      if(tab==='fleet')content=reportMetrics([['Fleet utilization',util.toFixed(1)+'%'],['Average completed rental',avg.toFixed(1)+' days'],['Estimated mechanical hold days',finSum(s.fleet,x=>x.downtime).toFixed(1)],['Completed rentals',s.completed.length]])+`<div class="grid-2 mb-3">${reportBars('Occupied time by motorcycle',s.fleet.map(x=>[reportBike(x.v),x.pct]),x=>x.toFixed(1)+'%')}${reportBars('Completed rentals by motorcycle',s.fleet.map(x=>[reportBike(x.v),x.count]))}</div><div class="panel">${finTable(['Motorcycle','Occupied days','Utilization','Hold days','Receipts / occupied day'],s.fleet.map(x=>[esc(reportBike(x.v)),x.days.toFixed(1),x.pct.toFixed(1)+'%',x.downtime.toFixed(1),x.days?fmt(x.receipts/x.days):'—']))}</div><p class="muted small mt-2">Occupancy uses actual return when available, scheduled start as fallback, and clips overlapping intervals to the elapsed period. Mechanical record duration estimates downtime; it may overlap occupancy.</p>`;
      if(tab==='reservations'){const statuses=['pending','approved','ongoing','completed','cancelled','rejected'];const weekday=Array.from({length:7},(_,i)=>[['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i],s.created.filter(r=>new Date(Date.parse(r.start)+8*3600000).getUTCDay()===i).length]);content=reportMetrics([['Requests created',s.created.length],['Completed share',reportPct(s.created.filter(r=>r.status==='completed').length,s.created.length)],['Cancellation share',reportPct(s.created.filter(r=>r.status==='cancelled').length,s.created.length)],['Late returns',reportPct(s.late,s.completed.length)]])+`<div class="grid-2 mb-3">${reportBars('Current status of requests created in period',statuses.map(k=>[k,s.created.filter(r=>r.status===k).length]))}${reportBars('Demand by displacement',groups)}${reportBars('Requested pickup weekday',weekday)}${reportBars('Rejection reasons',Object.entries(s.created.filter(r=>r.status==='rejected').reduce((a,r)=>(a[r.rejectReason||'Not recorded']=(a[r.rejectReason||'Not recorded']||0)+1,a),Object.create(null))))}</div>`;}
      if(tab==='customers')content=reportMetrics([['New customers',s.newCustomers.length],['Customers completing rentals',s.renters.length],['Returning renters',s.repeat],['Repeat renter share',reportPct(s.repeat,s.renters.length)]])+`<div class="grid-2">${reportBars('Renters by history',[['Returning',s.repeat],['First recorded rental',s.renters.length-s.repeat]])}${reportBars('Current verification status (all customers)',Object.entries(state.customers.reduce((a,c)=>(a[identityStatus(c)]=(a[identityStatus(c)]||0)+1,a),Object.create(null))))}</div><p class="small muted mt-2">Returning means at least two completed rentals by the end of the selected period. Verification is a current snapshot.</p>`;
      if(tab==='maintenance')content=reportMetrics([['Resolved maintenance costs',fmt(s.cost)],['Resolved records',s.logs.length],['Current open records',state.maintenanceLogs.filter(l=>l.status==='open').length],['Mean resolution time',s.logs.length?(finSum(s.logs,l=>Math.max(0,(Date.parse(l.resolvedAt)-Date.parse(l.reportedAt))/day))/s.logs.length).toFixed(1)+' days':'—']])+`<div class="grid-2">${reportBars('Resolved cost by motorcycle',s.fleet.map(x=>[reportBike(x.v),x.cost]),fmt)}${reportBars('Cost by record type',[['Maintenance',finSum(s.logs.filter(l=>l.type==='maintenance'),l=>l.cost)],['Incident / corrective',finSum(s.logs.filter(l=>l.type==='incident'),l=>l.cost)]],fmt)}</div>`;
      const range=p.range;mount(`<style>@media print{#sidebar,#topbar,#bottomNav,.report-tools,.report-tabs,.customer-footer,#veraAssistantBtn{display:none!important}body,.panel,.metric{background:white!important;color:black!important}.main,#appRoot{width:100%!important;max-width:none!important;padding:0!important}.metric-value,.metric-label,h1,h2,.panel-title,.muted,.bar-label{color:black!important}.panel,.metric{break-inside:avoid;border-color:#bbb!important}}</style><div class="page-header"><div><h1 class="page-title">Reports &amp; Analytics</h1><p class="page-desc">Financial and operational performance · Philippine time</p></div><div class="btn-group report-tools"><button class="btn" onclick="App.reportExport()">Export CSV</button><button class="btn" onclick="window.print()">Print</button></div></div><div class="toolbar report-tools"><select class="select" onchange="App.setUI('reportRange',this.value);App.render()">${[['month','This month'],['last','Last month'],['all','All time'],['custom','Custom range']].map(([k,l])=>`<option value="${k}" ${range===k?'selected':''}>${l}</option>`).join('')}</select>${range==='custom'?`<form class="toolbar" style="margin:0" onsubmit="App.reportRangeChange(event)"><input aria-label="From" name="from" type="date" class="input" value="${esc(state.ui.reportFrom||todayKey())}" required><input aria-label="To" name="to" type="date" class="input" value="${esc(state.ui.reportTo||todayKey())}" required><button class="btn">Apply</button></form>`:''}<label><input type="checkbox" ${state.ui.reportCompare?'checked':''} ${range==='all'?'disabled':''} onchange="App.setUI('reportCompare',this.checked);App.render()"> Compare previous equal-length period</label></div><p class="small muted mb-3">${fmtDateShort(new Date(p.a).toISOString())} – ${fmtDateShort(new Date(Math.max(p.a,p.b-1)).toISOString())}</p><div class="report-tabs">${finTabs([['financial','Financial'],['fleet','Fleet'],['reservations','Reservations'],['customers','Customers'],['maintenance','Maintenance']],tab,'reportTab')}</div>${compare?reportMetrics([['Previous net receipts',fmt(compare.net)],['Net receipts change',fmt(s.net-compare.net)],['Previous completed rentals',compare.completed.length],['Completed rental change',s.completed.length-compare.completed.length]]):''}${content}<div class="mt-3">${reservationPanel('Business insights',insights.length?insights.map(x=>`<div class="callout info small mb-2">${esc(x)}</div>`).join(''):'<p class="muted">Not enough data for recommendations in this period.</p>')}</div>`);}
    // ---------- Admin: Customer management ----------
    function customerReservationsFor(c) {
        return state.reservations.filter(r => r.customerId === c.id || (!r.customerId && r.customerEmail === c.email));
    }
    function customerIncidents(c) {
        const ids = new Set(customerReservationsFor(c).map(r=>r.id));
        return state.maintenanceLogs.filter(m=>m.type==='incident' && ids.has(m.reservationId));
    }
    function customerOutstanding(c) {
        return customerReservationsFor(c).filter(r=>r.status==='completed' && ['unpaid','pending','rejected'].includes(overtimeStatus(r))).reduce((n,r)=>n+(Number(r.overtimeFee)||0),0);
    }
    function customerMetrics(c) {
        const mine=customerReservationsFor(c), completed=mine.filter(r=>r.status==='completed');
        const ids=new Set(mine.map(r=>r.id));
        const paid=state.payments.filter(p=>ids.has(p.reservationId)&&p.status==='verified').reduce((n,p)=>n+(Number(p.amount)||0),0);
        return {c,mine,count:mine.length,completed:completed.length,spent:paid-mine.reduce((n,r)=>n+refundDeducted(r),0),active:mine.some(r=>r.status==='ongoing'),outstanding:customerOutstanding(c)};
    }
    function customerRestriction(c) {
        if(!c) return 'Customer account not found.';
        if(c.accountStatus==='suspended'||c.accountStatus==='archived') return 'Customer account is '+c.accountStatus+'.';
        if(customerOutstanding(c)>0) return 'Customer must settle outstanding overtime first.';
        if(customerIncidents(c).some(m=>m.status==='open')) return 'Customer has an unresolved linked rental incident. Review the incident before proceeding.';
        return '';
    }
    function customerEligibility(c,r) {
        return [
            ['Identity verified',identityStatus(c)==='verified'&&identityComplete(c.identification||{})],
            ['Valid driving license',bookingHasLicense(c)&&getLicenseStatus(c,r).status==='Valid'],
            ['No outstanding overtime',customerOutstanding(c)===0],
            ['No unresolved linked incidents',!customerIncidents(c).some(m=>m.status==='open')],
            ['Account active',!['suspended','archived'].includes(c.accountStatus)]
        ];
    }
    function customerModuleStyle(){return `<style>
    .cm-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.cm-stat{padding:15px;background:var(--surface);border:1px solid var(--border);border-radius:8px;min-width:0}.cm-stat strong{display:block;font-size:23px;margin-top:5px;overflow-wrap:anywhere}.cm-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.cm-toolbar .input{flex:1 1 220px;min-width:0}.cm-scroll{overflow-x:auto}.cm-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}.cm-tabs .active{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}.cm-profile{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}.cm-heading{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.cm-heading>div:nth-child(2){flex:1;min-width:160px}.cm-heading>div:first-child{width:68px!important;height:68px!important;flex-basis:68px!important}.cm-check{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)}.cm-check:last-child{border-bottom:0}.cm-timeline{border-left:2px solid var(--border);padding-left:14px;margin-left:5px}.cm-timeline-item{position:relative;padding:0 0 16px;overflow-wrap:anywhere}.cm-timeline-item:before{content:'';position:absolute;left:-20px;top:6px;width:9px;height:9px;border-radius:50%;background:var(--accent)}.cm-pagebar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px;flex-wrap:wrap}.cm-profile .kv{overflow-wrap:anywhere}.cm-profile .panel{min-width:0}.cm-muted{color:var(--text-muted)}@media(max-width:900px){.cm-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.cm-profile{grid-template-columns:1fr}}@media(max-width:480px){.cm-toolbar>*{flex:1 1 100%}.cm-stat strong{font-size:19px}}
    </style>`;}
    function cmStats(items){return `<div class="cm-summary">${items.map(([label,value])=>`<div class="cm-stat"><div class="small muted">${esc(label)}</div><strong>${esc(value)}</strong></div>`).join('')}</div>`;}
    function cmPanel(title,body){return `<section class="panel"><div class="panel-header"><div class="panel-title">${esc(title)}</div></div><div class="panel-body">${body}</div></section>`;}
    function cmTable(head,rows){return `<div class="cm-scroll"><table class="table"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${head.length}" class="muted">No records found.</td></tr>`}</tbody></table></div>`;}
    function customerDirectoryRows(){
        const q=String(state.ui.cmQuery||'').toLowerCase().trim(), filter=state.ui.cmFilter||'all', sort=state.ui.cmSort||'name';
        return state.customers.map(customerMetrics).filter(({c,active})=>[c.name,c.email,c.phone,c.id].join(' ').toLowerCase().includes(q)&&(
            filter==='all'||(filter==='unverified'&&identityStatus(c)!=='verified')||(filter==='active'&&active)||(filter==='restricted'&&!!customerRestriction(c))||identityStatus(c)===filter))
            .sort((a,b)=>sort==='spent'?b.spent-a.spent:sort==='rentals'?b.count-a.count:sort==='newest'?Date.parse(b.c.joinedAt)-Date.parse(a.c.joinedAt):a.c.name.localeCompare(b.c.name));
    }
    function renderAdminCustomers(){
        const all=state.customers.map(customerMetrics);
        mount(`${customerModuleStyle()}<div class="page-header"><div><h1 class="page-title">Customers</h1><p class="page-desc">Manage customer profiles, verification and rental records.</p></div><button class="btn btn-primary" onclick="App.cmAddCustomer()">+ Add customer</button></div>
        ${cmStats([['Total customers',all.length],['Verified',all.filter(x=>identityStatus(x.c)==='verified').length],['Unverified',all.filter(x=>identityStatus(x.c)!=='verified').length],['Active renters',all.filter(x=>x.active).length]])}
        <div class="cm-toolbar"><input class="input" id="cmSearch" placeholder="Search name, email, phone or ID…" aria-label="Search customers" value="${esc(state.ui.cmQuery||'')}" oninput="App.cmFilter('cmQuery',this.value)"><select class="select" aria-label="Filter customers" onchange="App.cmFilter('cmFilter',this.value)">${[['all','All statuses'],['verified','Verified'],['unverified','Unverified'],['pending','Pending verification'],['expired','Expired license'],['active','Active renters'],['restricted','Restricted accounts']].map(([k,l])=>`<option value="${k}" ${(state.ui.cmFilter||'all')===k?'selected':''}>${l}</option>`).join('')}</select><select class="select" aria-label="Sort customers" onchange="App.cmFilter('cmSort',this.value)">${[['name','Name A–Z'],['newest','Newest first'],['rentals','Most reservations'],['spent','Highest total spent']].map(([k,l])=>`<option value="${k}" ${(state.ui.cmSort||'name')===k?'selected':''}>${l}</option>`).join('')}</select><button class="btn" onclick="App.cmExport()">Export CSV</button></div><div id="cmDirectory" class="panel"></div>`);cmRenderRows();
    }
    function cmFilter(key,value){if(!adminOnly()||!['cmQuery','cmFilter','cmSort'].includes(key))return;state.ui[key]=value;state.ui.cmPage=1;cmRenderRows();}
    function cmPage(delta){if(!adminOnly())return;state.ui.cmPage=(state.ui.cmPage||1)+delta;cmRenderRows();}
    function cmRenderRows(){const root=$('#cmDirectory');if(!root)return;const all=customerDirectoryRows(), pages=Math.max(1,Math.ceil(all.length/10)), page=Math.min(pages,Math.max(1,state.ui.cmPage||1));state.ui.cmPage=page;
        root.innerHTML=cmTable(['Customer','Contact','Verification','Reservations','Total spent','Actions'],all.slice((page-1)*10,page*10).map(({c,count,spent})=>`<tr><td><div style="display:flex;gap:10px;align-items:center">${customerAvatar(c)}<div><strong>${esc(c.name)}</strong><div class="cell-sub">${esc(c.id.toUpperCase())} · ${customerReservationsFor(c).some(r=>r.status==='completed')?'Returning':'New / no completed rentals'}</div></div></div></td><td>${esc(c.email)}<div class="cell-sub">${esc(c.phone)}</div></td><td>${identityBadge(c)}${['suspended','archived'].includes(c.accountStatus)?`<div class="small" style="color:var(--danger)">${esc(c.accountStatus)}</div>`:''}</td><td>${count}</td><td><strong>${fmtPHP(spent)}</strong></td><td><a class="btn btn-sm" href="#/admin/customer/${esc(c.id)}">View profile</a></td></tr>`))+`<div class="cm-pagebar"><span class="small muted">${all.length?`Showing ${(page-1)*10+1}–${Math.min(page*10,all.length)} of ${all.length}`:'0 customers'}</span><div class="btn-group"><button class="btn btn-sm" ${page===1?'disabled':''} onclick="App.cmPage(-1)">Previous</button><span class="small muted">${page} / ${pages}</span><button class="btn btn-sm" ${page===pages?'disabled':''} onclick="App.cmPage(1)">Next</button></div></div>`;
    }
    function cmAddCustomer(){if(!adminOnly())return;openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Add customer</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><form onsubmit="App.cmSaveCustomer(event)"><div class="modal-body stack">${[['name','Full name','text'],['email','Email','email'],['phone','Phone','tel']].map(([key,label,type])=>`<label class="field"><span class="field-label">${label}</span><input name="${key}" type="${type}" class="input" required maxlength="150"></label>`).join('')}<p class="small muted">Add a demo customer record. Identity verification is completed separately; no login credentials are created.</p></div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Add customer</button></div></form></div>`);}
    function cmSaveCustomer(e){e.preventDefault();if(!adminOnly())return;const f=e.target.elements,name=f.name.value.trim(),email=f.email.value.trim(),phone=f.phone.value.trim();if(!name||!email||!phone)return toast('Complete all contact fields.','error');if(state.customers.some(c=>c.email.toLowerCase()===email.toLowerCase()))return toast('Email already in use.','error');const c={id:uid('c'),name,email,phone,joinedAt:new Date().toISOString(),totalRentals:0,profileImage:'',accountStatus:'active',identification:{verificationStatus:'not_submitted'}};state.customers.push(c);closeModal();toast('Customer added.','success');navigate('#/admin/customer/'+c.id);}
    function cmExport(){if(!adminOnly())return;const cell=x=>'"'+String(x??'').replace(/^[\s]*[=+\-@]/,m=>"'"+m).replace(/"/g,'""')+'"';const rows=[['Customer ID','Name','Email','Phone','Verification','Account status','Reservations','Verified net receipts'],...customerDirectoryRows().map(({c,count,spent})=>[c.id,c.name,c.email,c.phone,identityStatus(c),c.accountStatus||'active',count,spent])];const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='vera-customers.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);logActivity({module:'Customers',action:'Directory exported',entityId:'directory',description:'Filtered customer CSV export',changes:[]});}
    function cmStatusModal(id){if(!adminOnly())return;const c=getCustomer(id);if(!c)return;openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Account status · ${esc(c.name)}</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><form onsubmit="App.cmSaveStatus(event,'${esc(id)}')"><div class="modal-body stack"><label class="field"><span class="field-label">Status</span><select name="status" class="select">${['active','suspended','archived'].map(s=>`<option ${(c.accountStatus||'active')===s?'selected':''}>${s}</option>`).join('')}</select></label><label class="field"><span class="field-label">Reason / review decision</span><textarea class="input" name="reason" required maxlength="500"></textarea></label><p class="small muted">Suspension and archiving prevent new bookings and vehicle release, but preserve records, payments and existing returns.</p></div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Save status</button></div></form></div>`);}
    function cmSaveStatus(e,id){e.preventDefault();if(!adminOnly())return;const c=getCustomer(id),status=e.target.elements.status.value,reason=e.target.elements.reason.value.trim();if(!c||!['active','suspended','archived'].includes(status)||!reason)return toast('A reason is required.','error');Object.assign(c,{accountStatus:status,accountStatusReason:reason,accountStatusAt:new Date().toISOString()});closeModal();toast('Account status saved.','success');render();}
    function cmSaveNote(e,id){e.preventDefault();if(!adminOnly())return;const c=getCustomer(id),note=e.target.elements.note.value.trim();if(!c||!note)return;c.adminCustomerNotes=c.adminCustomerNotes||[];c.adminCustomerNotes.unshift({id:uid('note'),text:note,createdAt:new Date().toISOString()});logActivity({module:'Customers',action:'Internal note added',entityId:id,description:'Customer note added',changes:[]});toast('Note saved.','success');render();}
    function cmLinkIncident(e,id){e.preventDefault();if(!adminOnly())return;const c=getCustomer(id),f=e.target.elements,m=state.maintenanceLogs.find(x=>x.id===f.incident.value),r=getReservation(f.reservation.value);if(!c||!m||m.type!=='incident'||m.reservationId||!r||!customerReservationsFor(c).includes(r)||m.vehicleId!==r.vehicleId||!['ongoing','completed'].includes(r.status)||!f.confirm.checked)return toast('Select a matching rental and incident, then confirm the link.','error');m.reservationId=r.id;toast('Incident linked to reservation.','success');render();}
    function cmUnlinkIncident(id,mid){if(!adminOnly())return;const c=getCustomer(id),m=c&&customerIncidents(c).find(x=>x.id===mid);if(!m)return;openConfirm({title:'Remove incident link?',body:'The maintenance record will remain intact. Only the customer association is removed.',confirmLabel:'Remove link',onConfirm:()=>{if(!adminOnly())return;delete m.reservationId;closeModal();toast('Incident link removed.','success');render();}});}
    function cmTimeline(c,mine){const ev=[];const add=(date,title,detail='')=>{if(date&&Number.isFinite(Date.parse(date)))ev.push({date,title,detail});};add(c.joinedAt,'Customer record created');add(c.identification?.verifiedAt,'Identification verified');add(c.accountStatusAt,'Account status: '+(c.accountStatus||'active'),c.accountStatusReason||'');for(const r of mine){const label=getVehicle(r.vehicleId)?.name||r.vehicleId;add(r.createdAt,'Reservation submitted',label+' · '+r.id.toUpperCase());add(r.actualReturn,'Vehicle returned',label);for(const p of state.payments.filter(p=>p.reservationId===r.id)){add(p.submittedAt,'Payment proof submitted',fmtPHP(p.amount)+' · '+label);add(p.verifiedAt,'Payment verified',fmtPHP(p.amount));}}for(const a of state.activityLogs||[]){if((a.module==='Customers'&&a.entityId===c.id)||mine.some(r=>r.id===a.entityId))add(a.createdAt,a.action,a.module);}return `<div class="cm-timeline">${ev.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).map(a=>`<div class="cm-timeline-item"><strong>${esc(a.title)}</strong><div class="small muted">${fmtDate(a.date,{time:true})}${a.detail?' · '+esc(a.detail):''}</div></div>`).join('')||'<div class="muted">No activity recorded.</div>'}</div>`;}
    function renderAdminCustomerProfile(id,tab){if(!adminOnly())return;const c=getCustomer(id);if(!c)return mount('<div class="empty">Customer not found. <a href="#/admin/customers">Back to customers</a></div>');const m=customerMetrics(c),mine=m.mine.slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)),d=c.identification||{},tabs=['overview','identification','rentals','payments','incidents','notes','activity'];tab=tabs.includes(tab)?tab:'overview';const route='#/admin/customer/'+esc(c.id),check=customerEligibility(c),eligible=check.every(x=>x[1]);let body='';
        if(tab==='overview')body=`<div class="cm-profile"><div class="stack">${cmPanel('Personal information',`<div class="kv"><div class="k">Email</div><div class="v">${esc(c.email)}</div><div class="k">Phone</div><div class="v">${esc(c.phone)}</div><div class="k">Joined</div><div class="v">${fmtDateShort(c.joinedAt)}</div><div class="k">Account status</div><div class="v">${esc(c.accountStatus||'active')}</div></div>${c.accountStatusReason?`<p class="small muted mt-2">${esc(c.accountStatusReason)}</p>`:''}`)}${cmPanel('Driving credentials',`<div class="kv"><div class="k">Identity</div><div class="v">${identityBadge(c)}</div><div class="k">License</div><div class="v">${esc(getLicenseStatus(c).status)}</div><div class="k">Expires</div><div class="v">${esc(d.licenseExpiry||'Not submitted')}</div></div><a class="btn mt-3" href="${route}/identification">Review documents</a>`)}</div><div class="stack">${cmPanel('Rental eligibility',`<div class="callout ${eligible?'info':'danger'}"><strong>${eligible?'Eligible for review':'Review required'}</strong></div>${check.map(([label,pass])=>`<div class="cm-check"><span>${esc(label)}</span><span style="color:var(--${pass?'success':'danger'})">${pass?'Pass':'Needs review'}</span></div>`).join('')}<p class="small muted mt-2">Availability and validity through the return date are checked separately. Unresolved linked incidents require administrative review; association does not establish fault.</p>`)}${cmPanel('Outstanding overtime',`<strong style="font-size:22px">${fmtPHP(m.outstanding)}</strong><p class="small muted">Unsettled assessed overtime on completed rentals.</p><a class="btn mt-2" href="${route}/payments">View payments</a>`)}</div></div>`;
        if(tab==='identification')body=cmPanel('Identification documents',`<div class="kv mb-3"><div class="k">ID type</div><div class="v">${esc(d.idType||'—')}</div><div class="k">ID number</div><div class="v">${esc(d.idNumber||'—')}</div><div class="k">License number</div><div class="v">${esc(d.licenseNumber||'—')}</div><div class="k">Expiry</div><div class="v">${esc(d.licenseExpiry||'—')}</div></div>${customerDocuments(c)}${d.rejectionReason?`<div class="callout danger mt-2">${esc(d.rejectionReason)}</div>`:''}${d.verificationStatus==='pending'?`<div class="stack mt-3"><label class="field"><span class="field-label">Rejection reason</span><input id="identityRejectReason" class="input"></label><div class="btn-group"><button class="btn btn-primary" onclick="App.reviewCustomerIdentity('${esc(id)}',true)">Verify identity</button><button class="btn btn-danger" onclick="App.reviewCustomerIdentity('${esc(id)}',false)">Reject identity</button></div></div>`:''}`);
        if(tab==='rentals')body=cmPanel('Rental history',cmTable(['Motorcycle','Pickup','Return','Amount','Status',''],mine.map(r=>`<tr><td>${esc(getVehicle(r.vehicleId)?.name||r.vehicleId)}</td><td>${fmtDate(r.start,{time:true})}</td><td>${fmtDate(r.end,{time:true})}</td><td>${fmtPHP(r.totalFee+(r.overtimeFee||0))}</td><td>${statusBadge(r.status)}</td><td><a class="btn btn-sm" href="#/admin/reservation/${esc(r.id)}">View</a></td></tr>`)));
        if(tab==='payments'){const ids=new Set(mine.map(r=>r.id));body=cmPanel('Payment records',cmTable(['Reservation','Type','Method','Amount','Status',''],state.payments.filter(p=>ids.has(p.reservationId)).map(p=>`<tr><td>${esc(p.reservationId.toUpperCase())}</td><td>${esc(p.paymentType||'rental')}</td><td>${esc(p.method)}</td><td>${fmtPHP(p.amount)}</td><td>${statusBadge(p.status)}</td><td><a class="btn btn-sm" href="#/admin/reservation/${esc(p.reservationId)}">View</a></td></tr>`)))+cmPanel('Unsettled overtime',cmTable(['Reservation','Amount','Status',''],mine.filter(r=>r.status==='completed'&&['unpaid','pending','rejected'].includes(overtimeStatus(r))).map(r=>`<tr><td>${esc(r.id.toUpperCase())}</td><td>${fmtPHP(r.overtimeFee)}</td><td>${esc(overtimeStatus(r))}</td><td><a class="btn btn-sm" href="#/admin/reservation/${esc(r.id)}">View</a></td></tr>`)));}
        if(tab==='incidents'){const rentals=mine.filter(r=>['ongoing','completed'].includes(r.status));const candidates=state.maintenanceLogs.filter(x=>x.type==='incident'&&!x.reservationId&&rentals.some(r=>r.vehicleId===x.vehicleId));body=cmPanel('Linked rental incidents',cmTable(['Incident','Rental','Reported','Status','Actions'],customerIncidents(c).map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.reservationId.toUpperCase())}</td><td>${fmtDateShort(x.reportedAt)}</td><td>${statusBadge(x.status)}</td><td><button class="btn btn-sm" onclick="App.viewMaintenance('${esc(x.id)}')">View</button> <button class="btn btn-sm" onclick="App.cmUnlinkIncident('${esc(id)}','${esc(x.id)}')">Remove link</button></td></tr>`)))+cmPanel('Link a documented incident',`<p class="small muted mb-2">Only link an incident when records confirm its association with this rental. Do not infer fault from a motorcycle match.</p>${candidates.length?`<form class="stack" onsubmit="App.cmLinkIncident(event,'${esc(id)}')"><label class="field"><span class="field-label">Incident</span><select name="incident" class="select">${candidates.map(x=>`<option value="${esc(x.id)}">${esc(x.title)} · ${esc(getVehicle(x.vehicleId)?.name||x.vehicleId)} · ${fmtDateShort(x.reportedAt)}</option>`).join('')}</select></label><label class="field"><span class="field-label">Rental</span><select name="reservation" class="select">${rentals.map(r=>`<option value="${esc(r.id)}">${esc(r.id.toUpperCase())} · ${esc(getVehicle(r.vehicleId)?.name||r.vehicleId)} · ${fmtDateShort(r.start)}</option>`).join('')}</select></label><label><input type="checkbox" name="confirm" required> I have checked the records and confirmed this association.</label><button class="btn btn-primary">Link incident</button></form>`:'<p class="muted small">No unlinked incident records for motorcycles in this customer’s ongoing or completed rentals.</p>'}`);}
        if(tab==='notes')body=cmPanel('Internal admin notes',`<form class="stack" onsubmit="App.cmSaveNote(event,'${esc(id)}')"><textarea class="input" name="note" required maxlength="1000" placeholder="Add a factual operational note…"></textarea><button class="btn btn-primary">Save note</button></form><div class="stack mt-3">${(c.adminCustomerNotes||[]).map(n=>`<div class="callout"><div class="small muted">Admin · ${fmtDate(n.createdAt,{time:true})}</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(n.text)}</div></div>`).join('')||'<p class="small muted">No internal notes.</p>'}</div>`);
        if(tab==='activity')body=cmPanel('Customer activity',cmTimeline(c,mine));
        mount(`${customerModuleStyle()}<a class="btn btn-ghost btn-sm mb-3" href="#/admin/customers">← Back to customers</a><div class="page-header cm-heading">${customerAvatar(c)}<div><h1 class="page-title">${esc(c.name)}</h1><p class="page-desc">${esc(c.id.toUpperCase())} · Member since ${fmtDateShort(c.joinedAt)}</p>${identityBadge(c)}</div><div class="btn-group"><button class="btn" onclick="App.editCustomerIdentity('${esc(id)}')">Edit profile</button><button class="btn" onclick="App.cmStatusModal('${esc(id)}')">Account status</button></div></div>${cmStats([['Total reservations',m.count],['Completed rentals',m.completed],['Total spent (verified net)',fmtPHP(m.spent)],['Outstanding overtime',fmtPHP(m.outstanding)]])}<nav class="cm-tabs" aria-label="Customer profile sections">${tabs.map(t=>`<a class="btn btn-sm ${t===tab?'active':''}" href="${route}/${t}">${({rentals:'Rental history',identification:'Identification',overview:'Overview',payments:'Payments',incidents:'Incidents',notes:'Notes',activity:'Activity'})[t]}</a>`).join('')}</nav><div class="stack">${body}</div>`);
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

    function openMaintenanceModal(id, vehicleId = null) {
        if (state.role !== 'admin') return;
        const log = id ? state.maintenanceLogs.find(item => item.id === id) : null;
        if (id && !log) return;
        photoDraft = log ? maintenancePhotos(log).slice() : [];
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${log ? 'Edit log' : 'Log maintenance or incident'}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div>
          <form onsubmit="App.saveMaintenance(event, '${id || ''}')"><div class="modal-body stack">
            <div class="field"><label class="field-label">Vehicle</label><select name="vehicleId" class="select" required>${state.vehicles.map(v => `<option value="${v.id}" ${(log?.vehicleId || vehicleId) === v.id ? 'selected' : ''}>${esc(v.name)} (${esc(v.plateNumber)})</option>`).join('')}</select></div>
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
        const values = { reservationId:id, paymentType:'overtime', method:form.elements.namedItem('method').value, amount:r.overtimeFee, proofDataUrl:URL.createObjectURL(file), status:'pending', submittedAt:new Date().toISOString(), verifiedBy:null, verifiedAt:null, referenceNumber:'', rejectReason:'' };
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
    function customerDocuments(c, singleColumn = false) {
        const d = c.identification || {};
        return `<div ${singleColumn ? 'class="account-documents" style="display:grid;grid-template-columns:minmax(0,1fr);gap:12px;"' : 'class="grid-2"'}>${Object.entries(identityFields).map(([key,label]) => {
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
        closeModal(); toast('Identity review saved.','success'); navigate('#/admin/customer/'+id+'/identification'); render();
    }
    function openCustomerModal(cid) {
        if (adminOnly() && getCustomer(cid)) { closeModal(); navigate('#/admin/customer/'+cid+'/identification'); return; }
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
        notificationInbox().forEach(n=>{n.isRead=true;});
        toast('All inbox notifications marked as read.', 'success');
        ncRefresh();
    }
    function markNotifRead(id) {
        const n = notificationInbox(true).find(n=>n.id===id);
        if (n) n.isRead=true;
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
        if (!isVehicleBookable(getVehicle(vehicleId))) return toast('This motorcycle cannot accept reservations right now.', 'error');
        if (state.reservations.some(r => ownsReservation(r) && r.status === 'completed' && ['unpaid','pending','rejected'].includes(overtimeStatus(r)))) return toast('Settle outstanding overtime before requesting another rental.', 'error');
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        if (btn && btn.disabled) return;
        const cust = currentCustomer();
        if (!cust) { toast('No customer account selected.', 'error'); return; }
        const restriction = customerRestriction(cust); if (restriction) return toast(restriction,'error');
        if (!bookingHasLicense(cust)) { toast('Upload your LTO license (Restriction Code A/A1) in Account before submitting.', 'error'); return; }
        const startVal = form.elements.start.value, endVal = form.elements.end.value;
        const deliveryMethod = form.elements.deliveryMethod?.value || '';
        const trackingConsentAccepted = !!form.elements.trackingConsent?.checked;
        if (!startVal || !endVal) { toast('Please select start and end dates.', 'error'); return; }
        if (!DELIVERY_METHODS.includes(deliveryMethod)) { toast('Please select a delivery method.', 'error'); form.deliveryMethod?.focus(); return; }
        if (!trackingConsentAccepted) { toast('Please agree to GPS tracking consent to continue.', 'error'); form.trackingConsent?.focus(); return; }
        if (!Number.isFinite(Date.parse(startVal)) || !Number.isFinite(Date.parse(endVal))) return toast('Select valid dates.','error');
        const start = new Date(startVal).toISOString(), end = new Date(endVal).toISOString();
        if(Date.parse(start)<Date.now()) return toast('Choose a future pickup time.','error');
        if(getLicenseStatus(cust,{end}).status!=='Valid')return toast('License must remain valid through the return date.','error');
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
        const r = { id: uid('r'), vehicleId, customerId: cust.id, customerName: cust.name, customerEmail: cust.email, start, end, actualReturn: null, status: 'pending', totalFee: total, overtimeFee: 0, createdAt: new Date().toISOString(), approvedBy: null, rejectReason: '', adminNotes: '', deliveryMethod, deliveryAddress: deliveryMethod.startsWith('Host Delivery') ? (form.elements.deliveryAddress?.value||'').trim() : '', collectionAddress: deliveryMethod.endsWith('Host Collection') ? (form.elements.collectionAddress?.value||'').trim() : '', trackingConsent: { accepted: true, at: new Date().toISOString() } };
        setTimeout(() => {
            const restriction=customerRestriction(cust); if(restriction){if(btn)btn.disabled=false;return toast(restriction,'error');}
            if(state.role!=='customer'||currentCustomer()?.id!==cust.id||hasConflict(vehicleId,start,end).conflict){if(btn)btn.disabled=false;return toast('Availability or account changed. Please review your request.','error');}
            state.reservations.unshift(r);
            bookingDrafts.delete(bkKey(getVehicle(vehicleId)));
            state.ui.bookingSuccess=r.id;
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
                Object.assign(existing, { method, amount, status: 'pending', submittedAt: new Date().toISOString(), proofDataUrl, referenceNumber:'', rejectReason: '', verifiedBy: null });
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
        const restriction = customerRestriction(customer); if (restriction) return toast(restriction,'error');
        if (!customer || identityStatus(customer) !== 'verified' || !identityComplete(customer.identification)) {
            toast('Verify the customer identity and valid license before approving.', 'error');
            if (customer) openCustomerModal(customer.id);
            return;
        }
        if (getLicenseStatus(customer,r).status !== 'Valid') return toast('License must remain valid through the return date.','error');
        const conflict = hasConflict(r.vehicleId, r.start, r.end, r.id);
        if (conflict.conflict) {
            toast(conflict.reason, 'error');
            return;
        }
        r.status = 'approved';
        r.approvedBy = 'Admin';
        notify('customer', 'Reservation approved', `Your ${getVehicle(r.vehicleId)?.name || 'reservation'} was approved. You may now upload payment proof.`, `#/customer/reservation/${r.id}`, r.customerId);
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
        notify('customer', 'Reservation rejected', `Your ${getVehicle(r.vehicleId)?.name || 'reservation'} was rejected.`, `#/customer/reservation/${r.id}`, r.customerId);
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
        if (!adminOnly() || !r || r.status !== 'approved')
            return;
        const restriction=customerRestriction(getCustomer(r.customerId)); if(restriction)return toast(restriction,'error');
        openConfirm({ title: 'Start rental', body: `<p class="small muted">Mark this reservation as ongoing? The vehicle will be set to <strong>Rented</strong>.</p>`, confirmLabel: 'Start rental', onConfirm: () => {
                closeModal();
                if(!adminOnly())return; const restriction=customerRestriction(getCustomer(r.customerId)); if(restriction)return toast(restriction,'error');
                const vehicle = getVehicle(r.vehicleId);
                if (r.status !== 'approved' || !vehicle || vehicleOperationalState(vehicle).condition !== 'available' || vehicleOperationalState(vehicle).service || reservationsForVehicle(r.vehicleId).some(x => x.id !== r.id && (x.status === 'ongoing' || (x.status === 'approved' && Date.parse(x.start) <= Date.now() && Date.now() < Date.parse(x.end))))) {
                    toast('Vehicle is not available for release.', 'error');
                    return;
                }
                if (getPaymentByReservation(r.id)?.status !== 'verified') {
                    toast('Verify payment before starting the rental.', 'error');
                    return;
                }
                r.status = 'ongoing';
                r.startedAt = new Date().toISOString();
                const v = getVehicle(r.vehicleId);
                if (v) syncVehicleStatus(v);
                notify('customer', 'Rental started', `Your rental for ${v ? v.name : 'the vehicle'} is now ongoing.`, `#/customer/reservation/${r.id}`, r.customerId);
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
        if (v) syncVehicleStatus(v);
        const cust = getCustomer(r.customerId);
        if (cust)
            cust.totalRentals = (cust.totalRentals || 0) + 1;
        notify('customer', 'Rental completed', `Your rental for ${v ? v.name : 'the vehicle'} is completed.${finalFee ? ' Outstanding overtime: ' + fmtPHP(finalFee) + '.' : ''}${r.refund?.amount ? ' Refund due: ' + fmtPHP(r.refund.amount) + '.' : ''}`, `#/customer/reservation/${r.id}`, r.customerId);
        closeModal();
        toast('Rental completed.', 'success');
        render();
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
    function changeVehicleStatus(id, status) { setVehicleStatus(id,status); }
    function setVehicleStatus(id, status) {
        if (!adminOnly()) return;
        const v = getVehicle(id);
        const order = ['available','maintenance','malfunction'];
        if (!v || !order.includes(status)) return;
        const f = vehicleOperationalState(v);
        const record = vehicleRecordCondition(v);
        const minimum = record === 'malfunction' ? 'malfunction' : record === 'maintenance' || f.service ? 'maintenance' : 'available';
        if (order.indexOf(status) < order.indexOf(minimum)) {
            toast('Resolve the open maintenance/incident records or complete the active service before lowering this condition.', 'error');
            render();
            return;
        }
        // If a record already supplies the selected condition, remove the separate override.
        // Do not resolve records or change rental occupancy through this dropdown.
        v.manualCondition = status === minimum ? 'available' : status;
        const updated = syncVehicleStatus(v);
        const effective = updated.condition !== 'available' ? updated.condition : updated.service ? 'maintenance' : 'available';
        toast(`${v.name}: ${effective === 'available' ? 'Serviceable' : effective.charAt(0).toUpperCase() + effective.slice(1)}.`, 'success');
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
            state.vehicles.unshift({ id: uid('v'), status: 'available', manualCondition:'available', imageEmoji: '', ...data });
            toast('Vehicle added.', 'success');
        }
        closeModal();
        render();
    }
    function refreshMaintenanceStatus(vehicleId) {
        const vehicle = getVehicle(vehicleId);
        if (vehicle) syncVehicleStatus(vehicle);
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
    state.opsServices = state.opsServices || [];
    const auditFields = {
        opsServices: ['vehicleId','title','start','end','status','cost','resolvedAt'],
        vehicles: ['name','brand','model','year','plateNumber','displacement','ratePerDay','ratePerHour','status','manualCondition','color','seats','transmission','odometer','serviceDueDate','serviceDueMileage'],
        reservations: ['vehicleId','customerId','start','end','actualReturn','status','totalFee','overtimeFee','deliveryMethod','approvedBy','rejectReason','cancelReason','adminNotes'],
        payments: ['reservationId','paymentType','method','amount','status','submittedAt','verifiedAt','verifiedBy','rejectReason'],
        maintenanceLogs: ['vehicleId','reservationId','type','title','description','damageLocation','status','cost','reportedAt','resolvedAt','resolutionNotes','resolvedBy'],
        customers: ['totalRentals','accountStatus','accountStatusReason','accountStatusAt']
    };
    const auditModules = {opsServices:'Maintenance',vehicles:'Vehicles',reservations:'Reservations',payments:'Payments',maintenanceLogs:'Maintenance',customers:'Customers'};
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
                let link = `#/admin/${['maintenanceLogs','opsServices'].includes(collection) ? 'maintenance' : collection}`;
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
    syncVehicleStatuses();
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
        syncVehicleStatuses();
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
    // ---------- Interactive fleet scheduling and preventive maintenance ----------
    function calendarISO(value) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) return null;
        const d = new Date(value + ':00+08:00');
        return Number.isFinite(d.getTime()) && fmtDateTimeInput(d.toISOString()) === value ? d.toISOString() : null;
    }
    function calendarVehicleOptions(selected) {
        return state.vehicles.map(v => `<option value="${esc(v.id)}" ${v.id === selected ? 'selected' : ''}>${esc(v.brand+' '+v.name+' · '+v.plateNumber)}</option>`).join('');
    }
    function calendarDefaults(date) {
        const day = date && date >= todayKey() ? date : todayKey();
        const planned = Date.parse(day+'T08:00:00+08:00');
        const start = Math.max(planned, Math.ceil((Date.now()+60000)/3600000)*3600000);
        return [fmtDateTimeInput(new Date(start).toISOString()),fmtDateTimeInput(new Date(start+86400000).toISOString())];
    }
    function openCalendarAdd(vehicleId='',date='') {
        if (!adminOnly()) return;
        const v = vehicleId || (state.ui.fleetVehicle !== 'all' ? state.ui.fleetVehicle : '') || state.vehicles[0]?.id || '';
        const d = date || todayKey();
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Add calendar event</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><div class="modal-body stack"><p class="muted">${esc(getVehicle(v)?.name || 'Select a motorcycle')} · ${esc(d)}</p><button class="btn btn-primary" onclick="App.openCalendarReservation('${esc(v)}','${esc(d)}')">New reservation</button><button class="btn" onclick="App.openServiceModal('${esc(v)}','${esc(d)}')">Schedule maintenance</button></div></div>`);
    }
    function calendarReservationEditable(r) {
        return !!r && ['pending','approved'].includes(r.status) && !state.payments.some(p=>p.reservationId===r.id && ['pending','verified'].includes(p.status));
    }
    function openCalendarReservation(vehicleId='',date='',id='') {
        if (!adminOnly()) return;
        const r = id ? getReservation(id) : null;
        if (id && !calendarReservationEditable(r)) return toast('Only unpaid pending or approved reservations can be edited here.','error');
        const [start,end] = calendarDefaults(date);
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${r?'Reschedule reservation':'New reservation'}</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><form id="calendarReservationForm" onsubmit="App.saveCalendarReservation(event,'${esc(id)}')" onchange="App.updateCalendarEstimate()"><div class="modal-body stack"><div class="field"><label class="field-label">Motorcycle</label><select name="vehicleId" class="select" required>${calendarVehicleOptions(r?.vehicleId || vehicleId)}</select></div><div class="field"><label class="field-label">Customer</label><select name="customerId" class="select" required ${r?'disabled':''}>${state.customers.map(c=>`<option value="${esc(c.id)}" ${r?.customerId===c.id?'selected':''}>${esc(c.name)} · ${esc(c.email)}</option>`).join('')}</select></div><div class="form-grid"><div class="field"><label class="field-label">Pickup (Manila)</label><input type="datetime-local" name="start" class="input" required value="${r?fmtDateTimeInput(r.start):start}"></div><div class="field"><label class="field-label">Return (Manila)</label><input type="datetime-local" name="end" class="input" required value="${r?fmtDateTimeInput(r.end):end}"></div></div><div class="field"><label class="field-label">Delivery method</label><select name="deliveryMethod" class="select">${DELIVERY_METHODS.map(m=>`<option ${r?.deliveryMethod===m?'selected':''}>${esc(m)}</option>`).join('')}</select></div><div class="field"><label class="field-label">Admin notes</label><textarea name="notes" class="input">${esc(r?.adminNotes||'')}</textarea></div><label><input type="checkbox" name="consent" ${r?.trackingConsent?.accepted?'checked':''} required> Customer has explicitly provided GPS tracking consent.</label><div id="calendarEstimate" class="callout info"></div><p class="small muted">New reservations enter Pending. Approval and payment verification remain separate. Editing an approved unpaid reservation returns it to Pending for review.</p></div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary" type="submit">Save reservation</button></div></form></div>`);
        updateCalendarEstimate();
    }
    function updateCalendarEstimate() {
        const f=$('#calendarReservationForm')?.elements, box=$('#calendarEstimate');
        if (!f || !box) return;
        const a=calendarISO(f.start.value), b=calendarISO(f.end.value);
        const fee=computeFee(f.vehicleId.value,a,b);
        const risk = reservationsForVehicle(f.vehicleId.value).some(r => rentalIsOverdue(r));
        box.textContent=fee.days ? `${fee.days} rental day(s) · ${fmtPHP(fee.total)}${risk ? ' · Previous rental awaiting return; confirm vehicle readiness before release.' : ''}` : 'Select a valid rental period.';
    }
    function saveCalendarReservation(e,id) {
        e.preventDefault(); if (!adminOnly()) return;
        const f=e.target.elements, r=id?getReservation(id):null;
        if (id && !calendarReservationEditable(r)) return toast('Reservation cannot be edited.','error');
        const c=getCustomer(r?.customerId || f.customerId.value), v=getVehicle(f.vehicleId.value), start=calendarISO(f.start.value), end=calendarISO(f.end.value);
        if (!c || !v || !start || !end || Date.parse(end)<=Date.parse(start) || Date.parse(start)<Date.now() || !DELIVERY_METHODS.includes(f.deliveryMethod.value) || !f.consent.checked) return toast('Check customer, motorcycle, future pickup/return times, delivery method and consent.','error');
        const restriction=customerRestriction(c); if(restriction)return toast(restriction,'error');
        if (!bookingHasLicense(c) || getLicenseStatus(c,{end}).status !== 'Valid') return toast('Customer needs a valid license on file through the return date.','error');
        if (state.reservations.some(x=>x.customerId===c.id && x.status==='completed' && ['unpaid','pending','rejected'].includes(overtimeStatus(x)))) return toast('Customer must settle outstanding overtime first.','error');
        const conflict=hasConflict(v.id,start,end,id);
        if (conflict.conflict) return toast(conflict.reason,'error');
        // Preserve pending request competition, but never overlap approved/ongoing bookings or service.
        const now=new Date().toISOString(), data={vehicleId:v.id,customerId:c.id,customerName:c.name,customerEmail:c.email,start,end,status:'pending',totalFee:computeFee(v.id,start,end).total,approvedBy:null,deliveryMethod:f.deliveryMethod.value,adminNotes:f.notes.value.trim(),trackingConsent:r?.trackingConsent?.accepted?r.trackingConsent:{accepted:true,at:now}};
        if (r) Object.assign(r,data); else state.reservations.unshift({id:uid('r'),...data,actualReturn:null,overtimeFee:0,createdAt:now,rejectReason:'',refund:null});
        notify('customer',r?'Reservation updated':'Reservation created',`${v.name} reservation is pending review.`,'#/customer/reservations',c.id);
        closeModal(); toast(r?'Reservation updated.':'Reservation added to the calendar.','success'); render();
    }
    function openCalendarEvent(id) {
        if (!adminOnly()) return;
        const r=getReservation(id); if (!r) return;
        const edit=calendarReservationEditable(r);
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Reservation details</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><div class="modal-body stack"><div>${statusBadge(r.status)} ${rentalIsOverdue(r)?'<span class="status status-rejected">Overdue</span>':''}</div><div class="kv"><div class="k">Customer</div><div class="v">${esc(r.customerName)}</div><div class="k">Motorcycle</div><div class="v">${esc(getVehicle(r.vehicleId)?.name || r.vehicleId)}</div><div class="k">Pickup</div><div class="v">${fmtDate(r.start,{time:true})}</div><div class="k">Return</div><div class="v">${fmtDate(r.end,{time:true})}</div><div class="k">Rental fee</div><div class="v">${fmtPHP(r.totalFee)}</div></div>${!edit&&['pending','approved'].includes(r.status)?'<p class="small muted">Payment already submitted. Manage this booking through its reservation record.</p>':''}</div><div class="modal-footer"><a class="btn" href="#/admin/reservation/${esc(id)}" onclick="App.closeModal()">Full details</a>${edit?`<button class="btn btn-danger" onclick="App.cancelCalendarReservation('${esc(id)}')">Cancel reservation</button><button class="btn btn-primary" onclick="App.openCalendarReservation('','','${esc(id)}')">Edit / reschedule</button>`:''}</div></div>`);
    }
    function cancelCalendarReservation(id) {
        if (!adminOnly()) return;
        const r=getReservation(id); if (!calendarReservationEditable(r)) return;
        openConfirm({title:'Cancel reservation?',body:'The record will be retained in Rental History.',confirmLabel:'Cancel reservation',danger:true,onConfirm:()=>{if(!adminOnly()||!calendarReservationEditable(r))return;r.status='cancelled';r.cancelReason='Cancelled by administrator via Fleet Schedule';notify('customer','Reservation cancelled',r.cancelReason,'#/customer/history',r.customerId);closeModal();toast('Reservation cancelled.','success');render();}});
    }
    function openServicePlan(id) {
        if (!adminOnly()) return; const v=getVehicle(id);if(!v)return;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Service plan · ${esc(v.name)}</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><form onsubmit="App.saveServicePlan(event,'${esc(id)}')"><div class="modal-body stack"><div class="field"><label class="field-label">Current odometer (km)</label><input class="input" name="odometer" type="number" min="0" step="1" value="${esc(v.odometer??'')}"></div><div class="field"><label class="field-label">Next service date</label><input class="input" name="dueDate" type="date" value="${esc(v.serviceDueDate||'')}"></div><div class="field"><label class="field-label">Next service mileage (km)</label><input class="input" name="dueMileage" type="number" min="0" step="1" value="${esc(v.serviceDueMileage??'')}"></div><p class="small muted">Approaching due: within 7 days or 500 km. Enter at least a date or mileage to configure a plan.</p></div><div class="modal-footer"><button class="btn" type="button" onclick="App.closeModal()">Cancel</button><button class="btn btn-primary">Save plan</button></div></form></div>`);
    }
    function saveServicePlan(e,id) {
        e.preventDefault();if(!adminOnly())return;const v=getVehicle(id),f=e.target.elements;if(!v)return;
        const km=f.odometer.value===''?null:Number(f.odometer.value), due=f.dueMileage.value===''?null:Number(f.dueMileage.value);
        if ([km,due].some(x=>x!==null&&(!Number.isInteger(x)||x<0)))return toast('Mileage must be a non-negative whole number.','error');
        Object.assign(v,{odometer:km,serviceDueDate:f.dueDate.value||null,serviceDueMileage:due});closeModal();toast('Service plan saved.','success');render();
    }
    function openServiceModal(vehicleId='',date='',id='') {
        if (!adminOnly())return;const m=id?state.opsServices.find(x=>x.id===id):null;if(id&&(!m||m.status!=='scheduled'))return;
        const [start,end]=calendarDefaults(date);
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${m?'Manage scheduled service':'Schedule service'}</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><form onsubmit="App.saveService(event,'${esc(id)}')"><div class="modal-body stack"><div class="field"><label class="field-label">Motorcycle</label><select class="select" name="vehicleId" required>${calendarVehicleOptions(m?.vehicleId||vehicleId)}</select></div><div class="field"><label class="field-label">Service description</label><input class="input" name="title" required value="${esc(m?.title||'')}"></div><div class="form-grid"><div class="field"><label class="field-label">Start (Manila)</label><input class="input" type="datetime-local" name="start" required value="${m?fmtDateTimeInput(m.start):start}"></div><div class="field"><label class="field-label">End (Manila)</label><input class="input" type="datetime-local" name="end" required value="${m?fmtDateTimeInput(m.end):end}"></div></div>${m?'<div class="field"><label class="field-label">Actual cost (PHP) for completion</label><input class="input" type="number" min="0" step="0.01" name="cost" value="0"></div>':''}</div><div class="modal-footer">${m?`<button class="btn btn-danger" type="button" onclick="App.finishService('${esc(id)}','cancelled')">Cancel service</button><button class="btn" type="button" onclick="App.finishService('${esc(id)}','completed',this.form.elements.cost.value)">Complete</button>`:''}<button class="btn btn-primary" type="submit">Save service</button></div></form></div>`);
    }
    function saveService(e,id) {
        e.preventDefault();if(!adminOnly())return;const f=e.target.elements,m=id?state.opsServices.find(x=>x.id===id):null;if(id&&(!m||m.status!=='scheduled'))return;
        const v=getVehicle(f.vehicleId.value),start=calendarISO(f.start.value),end=calendarISO(f.end.value),title=f.title.value.trim();
        if(!v||!title||!start||!end||Date.parse(end)<=Date.parse(start)||Date.parse(end)<=Date.now())return toast('Check service title and dates.','error');
        if(state.reservations.some(r=>r.vehicleId===v.id&&['approved','ongoing'].includes(r.status)&&reservationOccupies(r,start,end))||state.opsServices.some(x=>x.id!==id&&x.vehicleId===v.id&&x.status==='scheduled'&&overlaps(start,end,x.start,x.end)))return toast('Service conflicts with a confirmed rental or another scheduled service.','error');
        const data={vehicleId:v.id,title,start,end,status:'scheduled'};if(m)Object.assign(m,data);else state.opsServices.push({id:uid('svc'),...data,cost:null});closeModal();toast('Service scheduled.','success');render();
    }
    function finishService(id,status,costValue) {
        if(!adminOnly()||!['cancelled','completed'].includes(status))return;const m=state.opsServices.find(x=>x.id===id);if(!m||m.status!=='scheduled')return;
        const cost=Number(costValue);if(status==='completed'&&(!Number.isFinite(cost)||cost<0||costValue===''))return toast('Enter a valid actual cost.','error');
        openConfirm({title:status==='completed'?'Complete service?':'Cancel service?',body:status==='completed'?'A resolved maintenance record will be added. Update the service plan separately.':'The service record will be retained.',confirmLabel:status==='completed'?'Complete':'Cancel service',danger:status==='cancelled',onConfirm:()=>{if(!adminOnly()||m.status!=='scheduled')return;m.status=status;m.resolvedAt=new Date().toISOString();if(status==='completed'){m.cost=cost;state.maintenanceLogs.unshift({id:uid('m'),vehicleId:m.vehicleId,type:'maintenance',title:m.title,description:'Completed scheduled service.',cost,status:'resolved',reportedAt:m.start,resolvedAt:m.resolvedAt,photos:[]});}closeModal();toast('Service '+status+'.','success');render();}});
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
        const now = Date.now();
        const today = todayKey();
        const todayEnd = new Date(Date.parse(today+'T00:00:00+08:00')+OPS_DAY).toISOString();
        const displayEnd = r => rentalIsOverdue(r, now) ? todayEnd : reservationOccupancyEnd(r, now);
        const visibleReservations = state.reservations.filter(r => fleet.some(v => v.id === r.vehicleId) && ['pending','approved','ongoing','completed'].includes(r.status) && overlaps(dates[0], windowEnd, r.start, displayEnd(r)));
        const visibleServices = (state.opsServices || []).filter(m => fleet.some(v => v.id === m.vehicleId) && m.status === 'scheduled' && overlaps(dates[0], windowEnd, m.start, m.end));
        const rows = fleet.map(v => {
            const overdueRental = reservationsForVehicle(v.id).find(r => rentalIsOverdue(r, now));
            const cells = dates.map(d => {
                const key = toManilaDateKey(d);
                const cellEnd = new Date(Date.parse(d) + OPS_DAY).toISOString();
                const occupying = visibleReservations.filter(r => r.vehicleId === v.id && overlaps(d, cellEnd, r.start, displayEnd(r)));
                const hold = !!overdueRental && key === today;
                const rs = kind !== 'service' ? occupying : [];
                const ms = kind !== 'rental' ? visibleServices.filter(m => m.vehicleId === v.id && overlaps(d, cellEnd, m.start, m.end)) : [];
                const cellLogs = (state.maintenanceLogs || []).filter(m => m.vehicleId === v.id && m.status === 'open' && Date.parse(m.reportedAt) < Date.parse(cellEnd) && Date.parse(m.resolvedAt || '9999-12-31T23:59:59Z') > Date.parse(d));
                const manual = key >= today ? manualVehicleCondition(v) : 'available';
                const down = manual === 'malfunction' || cellLogs.some(m=>m.type === 'incident') ? 'Malfunction' : manual === 'maintenance' || cellLogs.length ? 'Maintenance' : '';
                const events = rs.map(r => {
                    const late = rentalIsOverdue(r, now) && Date.parse(cellEnd) > Date.parse(r.end);
                    const cls = late ? 'ops-service' : r.status === 'pending' ? 'ops-pending' : r.status === 'completed' ? 'ops-completed' : 'ops-approved';
                    return `<button type="button" class="ops-event ${cls}" onclick="App.openCalendarEvent('${esc(r.id)}')" title="${esc(r.id.toUpperCase() + ' ' + r.customerName + (late ? ' · Overdue since ' + fmtDate(r.end,{time:true}) + ' · Awaiting return' : ''))}">${esc(r.customerName.split(' ')[0])} <small>${late?'Overdue':esc(r.status)}</small></button>`;
                }).concat(ms.map(m => `<button type="button" class="ops-event ops-service" onclick="App.openServiceModal('${esc(m.vehicleId)}','${key}','${esc(m.id)}')" title="${esc(m.title||'Service')}">Service <small>${esc(m.status)}</small></button>`));
                return `<td class="${key===today?'fleet-today':''}"><div class="fleet-cell">${events.join('')}${down && kind !== 'rental' ? `<span class="ops-event ${down === 'Malfunction' ? 'ops-service' : 'ops-pending'}">${down}</span>` : ''}${hold ? '<span class="small" style="color:var(--danger);display:block;margin-top:4px">Awaiting return</span>' : key >= today ? `<button type="button" class="btn btn-sm btn-ghost" style="width:100%;margin-top:4px" onclick="App.openCalendarAdd('${esc(v.id)}','${key}')" aria-label="Add event for ${esc(v.name)} on ${key}">+ Add</button>` : (!events.length && !down ? '<span class="ops-free">-</span>' : '')}</div></td>`;
            }).join('');
            return `<tr><th scope="row"><div class="fleet-moto"><strong>${esc(v.brand + ' ' + v.name)}</strong><span class="muted small">${esc(v.plateNumber || '-')} · ${esc(vehicleOperationalState(v).status)}</span>${vehicleOperationalState(v).rented && vehicleOperationalState(v).condition !== 'available' ? statusBadge(vehicleOperationalState(v).condition, true) : ''}${overdueRental?`<span class="status status-rejected" style="align-self:flex-start;margin-top:4px">Overdue</span><span class="small muted">Due ${esc(fmtDate(overdueRental.end,{time:true}))}</span>`:''}</div></th>${cells}</tr>`;
        });
        mount(`
            <div class="page-header">
              <div><h1 class="page-title">Fleet schedule</h1><p class="page-desc">Click + Add on a motorcycle and date to create a reservation or schedule service. Click an event to manage it. Overdue rentals are shown through today. Future dates can be booked; release requires the previous rental to be completed. Manila time.</p></div><button class="btn btn-primary" onclick="App.openCalendarAdd()">+ Add event</button>
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
            <div class="ops-legend mt-3"><span><i class="fleet-key ops-pending"></i>Pending</span><span><i class="fleet-key ops-approved"></i>Approved / ongoing</span><span><i class="fleet-key ops-completed"></i>Completed</span><span><i class="fleet-key ops-service"></i>Overdue / service / maintenance</span></div>
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
        filterActivity, viewActivity, exportActivity, dashboardLink, finFilter, finExportPayments, finVerify, finDepositModal, finSaveDeposit, reportExport, reportRangeChange,
        cmFilter, cmPage, cmAddCustomer, cmSaveCustomer, cmExport, cmStatusModal, cmSaveStatus, cmSaveNote, cmLinkIncident, cmUnlinkIncident, customerRestriction, customerEligibility,
        openCalendarAdd, openCalendarReservation, saveCalendarReservation, openCalendarEvent, cancelCalendarReservation, openServiceModal, saveService, finishService, openServicePlan, saveServicePlan, updateCalendarEstimate,
        loginAs, switchRole, goHome, setUI, searchVehicles, render, toggleNotifications, closeNotifications, markAllRead, markNotifRead, ncView, ncSearch, ncReset, ncRead, ncArchive, ncOpen, ncViewAll,
        scrollLandingTo, toggleLandingMenu, dismissLandingBanner, getLandingPromos, getFeaturedLandingVehicles, renderLanding,
        bkMonth, bkChooseDate, bkSync, bkAdvance, bkSubmit, bkAlternative, bkSimilar, updateFeePreview, submitReservation, confirmCancelReservation, submitCancelReservation, customerCancel,
        previewProof, submitPayment,
        approveReservation, rejectReservation, openRejectReservationModal, submitRejectReservation,
        startRental, openCompleteModal, completeRental, updateOvertimePreview, openOvertimePayment, submitOvertimePayment,
        openPaymentModal, verifyPayment, rejectPayment, openRejectPaymentModal, submitRejectPayment, switchVehicleSlide,
        openVehicleModal, saveVehicle, setVehicleStatus, changeVehicleStatus,
        openMaintenanceHistory, openMaintenanceModal, saveMaintenance, viewMaintenance, addMaintenancePhotos, removeMaintenancePhoto, resolveLog, openResolveLogModal, submitResolveLog,
        saveAdminNotes, openCustomerModal, editCustomerIdentity, saveCustomerIdentity, reviewCustomerIdentity, closeModal, _confirm: null,
        // Exposed for automated tests and inspection (no UI behavior change)
        DELIVERY_METHODS, getDeliveryMethod, getOvertimeSettings, overlaps, computeFee, computeOvertime, computeEarlyRefund, hasConflict, openRefundSelection, openAssessRefund, assessRefund, openRefundModal, recordRefund, acknowledgeRefund,
        getVehicle, getReservation, getCustomer, currentCustomer, reservationsForVehicle, notify, logActivity, captureActivity, uid, vehicleOperationalState, syncVehicleStatuses, rentalIsOverdue, reservationOccupies,
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
        route();
    });
})();