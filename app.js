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
    // Rental occupancy and mechanical condition are independent.
    function activeVehicleRental(id) {
        return reservationsForVehicle(id).find(r => r.status === 'ongoing');
    }
    function vehicleCondition(id) {
        const open = state.maintenanceLogs.filter(l => l.vehicleId === id && l.status === 'open');
        return open.some(l => l.type === 'incident') ? 'malfunction' : open.length ? 'maintenance' : 'available';
    }
    function vehicleStatusBadges(v) {
        const condition = vehicleCondition(v.id);
        return statusBadge(v.status) + (v.status === 'rented' && condition !== 'available' ? ' ' + statusBadge(condition) : '');
    }
    function syncVehicleStatuses() {
        for (const v of state.vehicles) refreshMaintenanceStatus(v.id);
    }
    function migrateVehicleStatuses() {
        // Preserve older manual mechanical holds that have no associated log.
        for (const v of state.vehicles) {
            if (['maintenance', 'malfunction'].includes(v.status) && vehicleCondition(v.id) === 'available') {
                state.maintenanceLogs.unshift({id:uid('m'), vehicleId:v.id,
                    type:v.status === 'malfunction' ? 'incident' : 'maintenance',
                    title:'Existing vehicle hold', description:'Imported from the previous vehicle status; original reason not recorded.',
                    damageLocation:'unknown', cost:0, photos:[], status:'open', reportedAt:nowISO(), resolvedAt:null});
            }
        }
        syncVehicleStatuses();
    }
    function overlaps(aStart, aEnd, bStart, bEnd) {
        return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
    }
    function hasConflict(vehicleId, start, end, excludeId) {
        const v = getVehicle(vehicleId);
        if (!v)
            return { conflict: true, reason: 'Vehicle not found.' };
        const condition = vehicleCondition(vehicleId);
        if (condition !== 'available')
            return { conflict: true, reason: `Vehicle is currently marked as ${condition}.` };
        if (reservationsForVehicle(vehicleId).some(r=>r.id!==excludeId&&r.status==='ongoing'&&Date.parse(r.end)<=Date.now()&&Date.parse(end)>Date.now())) return {conflict:true,reason:'Vehicle has an overdue ongoing rental.'};
        if (serviceConflict(vehicleId,start,end)) return {conflict:true,reason:'Overlaps a scheduled maintenance window.'};
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
    function computeOvertime(vehicleId, scheduledEnd, actualReturn) {
        const v = getVehicle(vehicleId);
        if (!v || !actualReturn)
            return { hours: 0, fee: 0 };
        const ms = new Date(actualReturn) - new Date(scheduledEnd);
        if (!Number.isFinite(ms) || ms <= 0)
            return { hours: 0, fee: 0 };
        const hours = Math.ceil(ms / 3600000);
        return { hours, fee: hours * v.ratePerHour };
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
        syncVehicleStatuses();
        expireAndWaitlist();
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
            case 'account':
                renderCustomerAccount();
                break;
            case 'history':
                renderCustomerHistory();
                break;
            case 'legal':
                renderCustomerLegal(param);
                break;
            default: renderCustomerVehicles();
        }
    }
    function routeAdmin(page, param, sub) {
        switch (page) {
            case 'schedule':
                opsSchedule();
                break;
            case 'settings':
                opsSettingsPage();
                break;
            case 'dashboard':
                renderAdminDashboard();
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
            case 'reports':
                enhancedReports();
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
              { href: '#/admin/vehicles', label: 'Vehicles' },
              { href: '#/admin/schedule', label: 'Fleet Schedule' },
              { href: '#/admin/reservations', label: 'Reservations' },
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
          { href: '#/customer/reservations', label: 'Reservations' },
          { href: '#/customer/history', label: 'Rental History' }
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
            accountBtn.href = '#/customer/account';
            accountBtn.classList.toggle(
                'hidden',
                state.role !== 'customer'
            );

            accountBtn.classList.toggle(
                'active',
                location.hash === '#/customer/account'
            );
        }
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
        if (root) {
            root.innerHTML = html;
            syncCustomerFooter(root);
        }
        window.scrollTo({ top: 0 });
    }
    // ---------- Customer footer and support pages ----------
    // Replace empty fields with the rental business's verified contact details.
    const CUSTOMER_CONTACT = {
        businessName: 'V.E.R.A.',
        email: '',
        phone: '',
        address: '',
        hours: ''
    };

    function customerContactValue(key) {
        const value = String(CUSTOMER_CONTACT[key] || '').trim();
        if (!value) return '<span class="muted">To be provided</span>';
        if (key === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            return `<a href="mailto:${esc(value)}">${esc(value)}</a>`;
        }
        if (key === 'phone' && /^\+?[\d\s().-]+$/.test(value)) {
            return `<a href="tel:${esc(value.replace(/[^+\d]/g, ''))}">${esc(value)}</a>`;
        }
        return esc(value);
    }

    function customerContactHTML() {
        return `<address class="customer-contact">
            <div><span>Email</span>${customerContactValue('email')}</div>
            <div><span>Phone</span>${customerContactValue('phone')}</div>
            <div><span>Address</span>${customerContactValue('address')}</div>
            <div><span>Business hours</span>${customerContactValue('hours')}</div>
        </address>`;
    }

    function syncCustomerFooter(root) {
        const parent = root.parentElement;
        if (!parent) return;
        let footer = parent.querySelector('#customerFooter');
        parent.classList.toggle('customer-main', state.role === 'customer');
        if (state.role !== 'customer') {
            footer?.remove();
            return;
        }
        if (!footer) {
            footer = document.createElement('footer');
            footer.id = 'customerFooter';
            footer.className = 'customer-footer';
            root.after(footer);
        }
        footer.innerHTML = `<div class="customer-footer-inner">
            <div class="customer-footer-grid">
                <section class="customer-footer-brand">
                    <h2>${esc(CUSTOMER_CONTACT.businessName)}</h2>
                    <p>Vehicle Enterprise Rental Assistant</p>
                    <p>Motorcycle reservations and rental support.</p>
                </section>
                <section><h3>Customer support</h3>
                    ${customerContactHTML()}
                </section>
                <nav aria-label="Legal and support" class="customer-footer-links">
                    <h3>Information</h3>
                    <a href="#/customer/legal/terms">Terms &amp; Conditions</a>
                    <a href="#/customer/legal/privacy">Privacy Notice</a>
                    <a href="#/customer/legal/refunds">Cancellation &amp; Refund Policy</a>
                    <a href="#/customer/legal/contact">Contact Us</a>
                </nav>
            </div>
            <div class="customer-footer-bottom"><span>&copy; ${new Date().getFullYear()} ${esc(CUSTOMER_CONTACT.businessName)}. All rights reserved.</span><span>Prototype · Policies subject to business review</span></div>
        </div>`;
    }

    function renderCustomerLegal(page) {
        const content = {
            terms: {
                title: 'Terms & Conditions',
                sections: [
                    ['Reservations', 'Requests are subject to availability, eligibility checks and administrator approval. A reservation does not authorize vehicle release until the required payment and other applicable conditions are satisfied.'],
                    ['Rental fees and return', 'The reservation displays the rental period and quoted charges. Late returns may incur overtime charges at the displayed hourly rate. Delivery, extension and deposit charges may apply when configured by the rental business.'],
                    ['Customer responsibilities', 'Provide accurate account information and valid motorcycle driving credentials. Report incidents or vehicle faults to the rental business and request approval before changing the rental period.'],
                    ['Changes and cancellations', 'Requests to extend, reschedule or substitute a vehicle are subject to review and availability. See the cancellation and refund policy for more information.']
                ]
            },
            privacy: {
                title: 'Privacy Notice',
                sections: [
                    ['Information handled', 'The prototype handles customer contact details, profile and identification uploads, reservation history, payment evidence and operational records to demonstrate rental management and identity review.'],
                    ['Use of information', 'These records support booking administration, eligibility review, payment verification, customer communications and accountability.'],
                    ['Prototype storage', 'This is a browser-based demonstration, not a production service. Optional local persistence may retain demo operational records. Do not upload real identification documents, personal information or payment evidence.'],
                    ['Questions and requests', 'Contact the rental business for privacy questions. The operator must confirm the final privacy contact, retention periods, access controls and procedures for handling personal information before deployment.']
                ]
            },
            refunds: {
                title: 'Cancellation & Refund Policy',
                sections: [
                    ['Cancellation', 'Pending reservations may be cancelled by the customer. Approved reservations and paid transactions may require administrator review. Eligible unpaid reservations may expire after their payment deadline.'],
                    ['Early return', 'The current prototype calculates eligible unused full rental days and applies a ₱500 deduction per unused day for voluntary early return or customer-caused damage, subject to the amount paid.'],
                    ['Business-side issues', 'A business-side defect may qualify for a refund of unused rental value. Business cancellation before rental service is provided may qualify for a full refund. Delivery-related or disputed cases require assessment.'],
                    ['Refund processing', 'Refunds are assessed by the administrator, transferred outside V.E.R.A., recorded with evidence and acknowledged by the customer. Deposit returns are handled separately.']
                ]
            },
            contact: {title: 'Contact Us', sections: []}
        }[page];
        if (!content) return renderCustomerVehicles();
        mount(`<div class="customer-legal-page">
            <a href="#/customer/vehicles" class="btn btn-ghost btn-sm mb-3">&larr; Back to vehicles</a>
            <div class="page-header"><div><h1 class="page-title">${esc(content.title)}</h1><p class="page-desc">${esc(CUSTOMER_CONTACT.businessName)} · Customer information</p></div></div>
            ${page === 'contact' ? `<div class="panel"><div class="panel-body stack"><p>For booking questions, payment verification, rental changes or support, contact the rental business.</p>${customerContactHTML()}${['email', 'phone', 'address', 'hours'].some(key => !CUSTOMER_CONTACT[key]) ? `<p class="small muted">Missing contact details will be published once confirmed by the operator.</p>` : ''}</div></div>` : `<div class="panel"><div class="panel-body customer-policy-content"><div class="callout info small">Draft policy for the V.E.R.A. prototype. Pending review and approval by the rental business before public use.</div>${content.sections.map(([heading, text])=>`<section><h2>${esc(heading)}</h2><p>${esc(text)}</p></section>`).join('')}<p><a href="#/customer/legal/contact">Contact us for assistance.</a></p></div></div>`}
        </div>`);
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

    function vehicleShowcasePane(vehicle, index, total, active, clone = false) {
        const unavailable = vehicleCondition(vehicle.id) !== 'available';
        return `
            <div class="showcase-slide" ${clone ? '' : `data-real-index="${index}"`}
                aria-hidden="${!active}" ${active ? '' : 'inert'}>
                <div class="showcase-image">
                    ${vehicleImage(vehicle)}
                    <div class="showcase-counter">${index + 1} / ${total}</div>
                </div>
                <div class="showcase-details">
                    <div class="showcase-category">${esc(vehicle.displacement)}cc CLASS</div>
                    <h1 class="showcase-name">${esc(vehicle.name)}</h1>
                    <p class="muted">${esc(vehicle.brand)} · ${esc(vehicle.year)}</p>
                    <div class="mt-3">${vehicleStatusBadges(vehicle)}</div>
                    <div class="showcase-specs">
                        <div><span>Transmission</span><strong>${esc(vehicle.transmission)}</strong></div>
                        <div><span>Color</span><strong>${esc(vehicle.color)}</strong></div>
                        <div><span>Capacity</span><strong>${esc(vehicle.seats)} seats</strong></div>
                        <div><span>Plate number</span><strong>${esc(vehicle.plateNumber)}</strong></div>
                    </div>
                    <div class="divider"></div>
                    <div class="showcase-price">${fmtPHP(vehicle.ratePerDay)} <span>/ day</span></div>
                    <p class="muted small">${fmtPHP(vehicle.ratePerHour)} / hour overtime rate</p>
                    <div class="mt-3">
                        ${unavailable ? `<button class="btn btn-block" disabled>Currently unavailable</button> <a class="btn btn-block mt-2" href="#/customer/vehicle/${esc(vehicle.id)}">View availability / waitlist</a>` :
                            `<a class="btn btn-primary btn-block" href="#/customer/vehicle/${esc(vehicle.id)}">View details & reserve</a>`}
                    </div>
                </div>
            </div>`;
    }

    function renderCustomerVehicles() {
        const query = (state.ui.q || '').toLowerCase();
        const displacement = state.ui.displacementFilter || 'all';
        const vehicles = state.vehicles.filter(vehicle => {
            const search = [vehicle.name, vehicle.brand, vehicle.model, vehicle.plateNumber].join(' ').toLowerCase();
            return search.includes(query) &&
                (displacement === 'all' || String(vehicle.displacement) === displacement);
        });
        const total = vehicles.length;
        const index = total ? Math.max(0, Math.min(state.ui.vehicleSlide || 0, total - 1)) : 0;
        state.ui.vehicleSlide = index;
        const displacementOptions = ['400', '600', '1000'];

        mount(`
            <div class="page-header">
                <div><h1 class="page-title">Find your next ride</h1>
                <p class="page-desc">Explore our motorcycle fleet and reserve your ride.</p></div>
            </div>
            <div class="toolbar">
                <input id="vehicleSearch" class="input grow" placeholder="Search motorcycles..."
                    value="${esc(state.ui.q || '')}" oninput="App.setUI('vehicleSlide', 0); App.searchVehicles(this)">
                <select class="select" aria-label="Displacement" onchange="App.setUI('displacementFilter', this.value); App.setUI('vehicleSlide', 0); App.render()">
                    <option value="all">All displacements</option>
                    ${displacementOptions.map(item => `<option value="${item}" ${displacement === item ? 'selected' : ''}>${item}cc Class</option>`).join('')}
                </select>
            </div>
            ${total ? `
                <div class="showcase-wrapper">
                    <button class="slide-arrow slide-prev" aria-label="Previous motorcycle"
                        onclick="App.switchVehicleSlide('prev', (Number(document.getElementById('vehicleTrack').dataset.activeIndex || 0) + ${total} - 1) % ${total})" ${total === 1 ? 'disabled' : ''}>&#10094;</button>
                    <section class="vehicle-showcase" aria-label="Motorcycle carousel">
                        <div class="showcase-viewport">
                            <div id="vehicleTrack" class="showcase-track" data-total="${total}" data-active-index="${index}" style="transform:translate3d(${-100 * (index + 1)}%,0,0)">
                                ${vehicleShowcasePane(vehicles[total - 1], total - 1, total, false, true)}
                                ${vehicles.map((vehicle, i) => vehicleShowcasePane(vehicle, i, total, i === index)).join('')}
                                ${vehicleShowcasePane(vehicles[0], 0, total, false, true)}
                            </div>
                        </div>
                        <div class="slide-dots">
                            ${vehicles.map((item, position) => `<button class="slide-dot ${position === index ? 'active' : ''}"
                                aria-label="Show ${esc(item.name)} ${esc(item.year)}" aria-current="${position === index}"
                                onclick="App.switchVehicleSlide('direct', ${position})"></button>`).join('')}
                        </div>
                    </section>
                    <button class="slide-arrow slide-next" aria-label="Next motorcycle"
                        onclick="App.switchVehicleSlide('next', (Number(document.getElementById('vehicleTrack').dataset.activeIndex || 0) + 1) % ${total})" ${total === 1 ? 'disabled' : ''}>&#10095;</button>
                    <span class="carousel-announcement" aria-live="polite">Motorcycle ${index + 1} of ${total}</span>
                </div>` : `<div class="empty"><div class="empty-title">No motorcycles found</div>Try adjusting your search or filters.</div>`}
        `);
    }

    function buildCalendarHTML(vehicleId) {
        const [year, monthNumber] = todayKey().split('-').map(Number);
        const month = monthNumber - 1;
        const base = new Date(Date.UTC(year, month, 1));
        const firstDay = base.getUTCDay();
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const booked = new Set();
        reservationsForVehicle(vehicleId).filter(r => r.status === 'approved' || r.status === 'ongoing').forEach(r => {
            const start = new Date(r.start);
            const end = new Date(r.end);
            for (let day = 1; day <= daysInMonth; day++) {
                const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayStart = new Date(`${key}T00:00:00+08:00`);
                const dayEnd = new Date(dayStart.getTime() + 86400000);
                if (overlaps(start, end, dayStart, dayEnd))
                    booked.add(key);
            }
        });
        for (let day = 1; day <= daysInMonth; day++) {
            const key = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const a = new Date(`${key}T00:00:00+08:00`).toISOString(), b = new Date(Date.parse(a)+OPS_DAY).toISOString();
            if (serviceConflict(vehicleId,a,b) || vehicleCondition(vehicleId) !== 'available') booked.add(key);
        }
        const tk = todayKey();
        const monthName = base.toLocaleString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
        let cells = '';
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => cells += `<div class="cal-cell cal-head">${d}</div>`);
        for (let i = 0; i < firstDay; i++)
            cells += `<div class="cal-cell cal-empty"></div>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isBooked = booked.has(key), isToday = key === tk;
            cells += `<div class="cal-cell ${isBooked ? 'cal-booked' : 'cal-free'} ${isToday ? 'cal-today' : ''}" title="${isBooked ? 'Booked' : 'Available'}">${d}</div>`;
        }
        return `<div class="calendar"><div class="cal-header"><div class="cal-month">${esc(monthName)}</div><div class="cal-legend"><span><span class="cal-swatch free"></span>Available</span><span><span class="cal-swatch booked"></span>Booked</span></div></div><div class="cal-grid">${cells}</div></div>`;
    }
    function renderCustomerVehicleDetail(id) {
        const v = getVehicle(id);
        if (!v)
            return mount(`<div class="empty"><div class="empty-title">Vehicle not found</div><div><a href="#/customer/vehicles">Return to vehicles</a></div></div>`);
        const blocked = vehicleCondition(v.id) !== 'available';
        const bookedRanges = reservationsForVehicle(id).filter(r => r.status === 'approved' || r.status === 'ongoing').sort((a, b) => new Date(a.start) - new Date(b.start));
        mount(`
      <div style="margin-bottom:12px;"><a href="#/customer/vehicles" class="btn btn-ghost btn-sm">&larr; Back to vehicles</a></div>
      <div class="page-header">
        <div><h1 class="page-title">${esc(v.name)}</h1><p class="page-desc">${esc(v.brand)} ${esc(v.model)} · ${v.year} · ${esc(v.color)}</p></div>
        <div>${vehicleStatusBadges(v)}</div>
      </div>
      <div class="grid-3">
        <div class="stack">
          <div class="panel"><div class="panel-body"><div class="fleet-image">${vehicleImage(v)}</div>
            <div class="kv mt-3">
              <div class="k">Plate number</div><div class="v mono">${esc(v.plateNumber)}</div>
              <div class="k">Displacement</div><div class="v" style="text-transform:capitalize">${esc(displacementLabel(v.displacement))}</div>
              <div class="k">Seats</div><div class="v">${v.seats}</div>
              <div class="k">Transmission</div><div class="v">${esc(v.transmission)}</div>
              <div class="k">Daily rate</div><div class="v">${fmtPHP(v.ratePerDay)}</div>
              <div class="k">Hourly rate</div><div class="v">${fmtPHP(v.ratePerHour)}</div>
            </div>
          </div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Availability</div></div><div class="panel-body">
            ${buildCalendarHTML(v.id)}
            <div class="small muted mt-2">${bookedRanges.length ? `<strong>Booked periods:</strong> ${bookedRanges.map(r => `${fmtDateShort(r.start)}–${fmtDateShort(r.end)}`).join('; ')}` : 'No approved or ongoing bookings this month.'}</div>
          </div></div>
          ${reservationPanel('Availability alerts', `<p class="muted small mb-2">Join the waitlist for unavailable dates.</p>${opsBtn('Join waitlist',`openWaitlist('${v.id}')`)}`)}
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
            ${blocked ? `<div class="callout danger">This vehicle is currently <strong>${esc(vehicleCondition(v.id))}</strong> and cannot accept reservation requests.</div>` : `
            <form id="reqForm" onsubmit="App.submitReservation(event,'${v.id}')" class="stack">
              <div class="field"><label class="field-label" for="start">Start date and time</label><input id="start" class="input" required type="datetime-local" name="start" onchange="App.updateFeePreview('${v.id}')"></div>
              <div class="field"><label class="field-label" for="end">End date and time</label><input id="end" class="input" required type="datetime-local" name="end" onchange="App.updateFeePreview('${v.id}')"></div>
              <div class="field"><label class="field-label" for="deliveryMethod">Delivery method</label>
                <select id="deliveryMethod" name="deliveryMethod" class="select" required onchange="App.updateFeePreview('${v.id}')">
                  <option value="">Select pickup and return option</option>
                  ${DELIVERY_METHODS.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
                </select>
                <div class="field-hint">Choose how the vehicle will be picked up and returned for this reservation.</div>
              </div>
              <label class="field"><span class="field-label">Voucher code (optional)</span><input class="input" name="promoCode" maxlength="30" oninput="App.updateFeePreview('${v.id}')" autocomplete="off"></label>
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
        const mine = state.reservations.filter(r => ownsReservation(r)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const list = tab === 'all' ? mine : mine.filter(r => r.status === tab);
        const tabs = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
        mount(`
      <div class="page-header"><div><h1 class="page-title">My reservations</h1><p class="page-desc">Track request status, upload payment proof, and review rental details.</p></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" onclick="App.setUI('resTab','${k}'); App.render()">${l}</button>`).join('')}</div>
      ${list.length ? `<div class="stack">${list.map(r => {
            const v = getVehicle(r.vehicleId);
            const p = getPaymentByReservation(r.id);
            return `<div class="list-row">
          <div class="list-row-main">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">${vehicleMark(v)}<div><div class="list-row-title"><a href="#/customer/reservation/${r.id}">${esc(v ? v.name : r.vehicleId)}</a></div><div class="list-row-meta">${fmtDateShort(r.start)} to ${fmtDateShort(r.end)} · ${fmtPHP(r.totalFee + (r.overtimeFee || 0))}${r.overtimeFee ? ' (incl. overtime)' : ''}</div><div class="list-row-meta">Delivery: ${esc(getDeliveryMethod(r))}</div></div></div>
            ${timelineHTML(r.status)}
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
        appendOps(waitlistPanel(false));
    }

    // ---------- Shared reservation components ----------
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
        const rental = Number(r.totalFee || 0) + state.opsCharges.filter(c=>c.reservationId===r.id && c.type==='extension').reduce((s,c)=>s+c.paid,0);
        const overtime = Number(r.overtimeFee || 0);

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
        const price = (label, amount) => `
            <div class="reservation-price-row"><span>${label}</span><strong>${fmtPHP(amount)}</strong></div>`;

        return `
            <div class="reservation-card">
                <div class="reservation-card-header">
                    <h2>Reservation details</h2>${statusBadge(r.status)}
                </div>
                <div class="reservation-vehicle">
                    <div class="reservation-vehicle-image">${v ? vehicleImage(v) : ''}</div>
                    <div class="reservation-vehicle-info">
                        <h2>${esc(v?.name || 'Unknown vehicle')}</h2>
                        <p class="muted">${esc(v?.brand || '')} · ${esc(displacementLabel(v?.displacement))}</p>
                        <span class="reservation-plate">${esc(v?.plateNumber || '—')}</span>
                    </div>
                </div>
                <section class="reservation-section">
                    <h3>Rental schedule</h3>
                    <div class="reservation-schedule">${schedule('Pickup', r.start)}${schedule('Return', r.end)}</div>
                    <div class="reservation-duration">${days} day(s), ${hours} hour(s)${remainder ? `, ${remainder} min` : ''} · ${billableDays} billable day(s)</div>
                </section>
                <section class="reservation-section">
                    <h3>Delivery arrangements</h3>
                    <div class="delivery-options">${delivery('Pickup method', pickup)}${delivery('Return method', dropoff)}</div>
                </section>
                <section class="reservation-section">
                    <h3>Payment breakdown</h3>
                    ${price('Rental fee', rental)}${price('Overtime fee', overtime)}${r.refund?.amount ? price('Refund', -r.refund.amount) : ''}
                    <div class="reservation-total"><span>Total amount</span><strong>${fmtPHP(rental + overtime - (r.refund?.amount || 0))}</strong></div>
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
                ${!admin && r.status === 'approved' && p.status === 'rejected' ? `<a class="btn btn-primary btn-block mt-3" href="${payLink}">Resubmit payment proof</a>` : ''}`;
        } else if (!admin && r.status === 'approved') {
            body = `
                <p class="callout info small mb-3">No payment proof has been submitted.</p>
                <div class="reservation-price-row"><span>Amount due</span><strong>${fmtPHP(r.totalFee)}</strong></div>
                <a class="btn btn-primary btn-block mt-3" href="${payLink}">Upload payment proof</a>`;
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
            <div class="mb-3"><a href="${back}" class="btn btn-ghost btn-sm">&larr; Back to reservations</a></div>
            <div class="page-header">
                <div><h1 class="page-title">Reservation ${esc(r.id.toUpperCase())}</h1><p class="page-desc">${esc(admin ? r.customerName + ' · ' + (v?.name || 'Vehicle') : v?.name || 'Vehicle')}</p></div>
                ${statusBadge(r.status)}
            </div>
            <div class="reservation-layout">
                <div class="reservation-main">${reservationDetailsCard(r, v)}${customerPanel}${notes}</div>
                <div class="reservation-sidebar">
                    ${reservationPaymentPanel(r, p, admin)}
                    ${opsFinancePanel(r, admin)}
                    ${opsChangesPanel(r, admin)}
                    ${feedbackPanel(r, admin)}
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
            <div class="field"><label class="field-label" for="amount">Amount (PHP)</label><input id="amount" name="amount" type="number" min="0.01" step="0.01" class="input" value="${r.totalFee}" readonly required><div class="field-hint">Amount must match the quoted rental total.</div></div>
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
    function renderCustomerAccount() {
        const cust = currentCustomer();
        mount(`
            <div class="page-header"><div><h1 class="page-title">Account</h1><p class="page-desc">Manage your profile and identification documents.</p></div></div>
            ${cust.restriction?.active ? `<div class="callout danger mb-3">Account restricted: ${esc(cust.restriction.reason)}</div>` : ''}
            <div class="stack">
<div class="panel"><div class="panel-header"><div class="panel-title">Profile</div><button class="btn btn-sm" onclick="App.editCustomerIdentity('${cust.id}')">Edit profile</button></div><div class="panel-body"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">${customerAvatar(cust)}${identityBadge(cust)}</div>
            <div class="kv"><div class="k">Name</div><div class="v">${esc(cust.name)}</div><div class="k">Email</div><div class="v">${esc(cust.email)}</div><div class="k">Phone</div><div class="v">${esc(cust.phone)}</div><div class="k">Joined</div><div class="v">${fmtDateShort(cust.joinedAt)}</div></div>
          </div></div>
          <div class="panel"><div class="panel-header"><div class="panel-title">Identification documents</div></div><div class="panel-body">${customerDocuments(cust)}${cust.identification?.rejectionReason ? `<div class="callout danger mt-2">${esc(cust.identification.rejectionReason)}</div>` : ''}</div></div>
            </div>
        `);
    }

    function renderCustomerHistory() {
        const allMine = state.reservations.filter(r => ownsReservation(r)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const completed = allMine.filter(r => r.status === 'completed');
        const spent = completed.reduce((s, r) => s + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r), 0);
        mount(`
            <div class="page-header"><div><h1 class="page-title">Rental History</h1><p class="page-desc">Review your rental records and reservation details.</p></div></div>
            <div class="metrics mb-3" style="grid-template-columns:1fr 1fr;">
            <div class="metric"><div class="metric-label">Completed rentals</div><div class="metric-value">${completed.length}</div></div>
            <div class="metric"><div class="metric-label">Total spent</div><div class="metric-value sm">${fmtPHP(spent)}</div></div>
          </div>
            <div class="panel"><div class="panel-header"><div class="panel-title">Rental history</div></div><div class="panel-body flush">
            ${allMine.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Vehicle</th><th>Period</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${allMine.map(r => {
            const v = getVehicle(r.vehicleId);
            return `<tr><td><div class="cell-main">${esc(v ? v.name : r.vehicleId)}</div><div class="cell-sub">${esc(v ? v.plateNumber : '')}</div></td><td class="small">${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}</td><td>${fmtPHP(r.totalFee + (r.overtimeFee || 0))}</td><td>${statusBadge(r.status)}</td><td class="text-right"><a class="btn btn-sm btn-ghost" href="#/customer/reservation/${r.id}">View</a></td></tr>`;
        }).join('')}</tbody></table></div>` : `<div class="empty"><div class="empty-title">No rental history</div><div>Completed and past rentals will appear here.</div></div>`}
          </div></div>
        `);
    }
    // ---------- Admin: Dashboard ----------
    function renderAdminDashboard() {
        const today = todayKey();
        const now = Date.now();
        const pending = state.reservations.filter(r => r.status === 'pending').length;
        const active = state.reservations.filter(r => r.status === 'ongoing').length;
        const available = state.vehicles.filter(v => v.status === 'available').length;
        const pickups = state.reservations.filter(r => r.status === 'approved' && toManilaDateKey(r.start) === today);
        const returns = state.reservations.filter(r => r.status === 'ongoing' && toManilaDateKey(r.end) === today);
        const overdue = state.reservations.filter(r => r.status === 'ongoing' && Date.parse(r.end) < now);
        const todays = state.reservations.filter(r =>
            ['approved', 'ongoing'].includes(r.status) &&
            toManilaDateKey(r.start) <= today && toManilaDateKey(r.end) >= today
        ).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
        const movements = [
            ...pickups.map(r => ({ r, type: 'Pickup', time: r.start })),
            ...returns.map(r => ({ r, type: 'Return', time: r.end }))
        ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
        const scheduleRows = todays.map(r => opsRow(
            esc(r.customerName), esc(vLabel(getVehicle(r.vehicleId))),
            `${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}`,
            statusBadge(r.status), rLink(r)
        ));
        const movementRows = movements.map(({ r, type, time }) => opsRow(
            esc(type), esc(vLabel(getVehicle(r.vehicleId))), esc(r.customerName),
            esc(fmtDate(time, { time: true })), rLink(r)
        ));
        mount(`
            <div class="page-header">
                <div><h1 class="page-title">Dashboard</h1>
                <p class="page-desc">Daily rental operations, fleet availability and scheduled movements.</p></div>
            </div>
            <div class="metrics dashboard-metrics mb-3">
                ${opsMetric('Pending requests', pending)}
                ${opsMetric('Active rentals', active)}
                ${opsMetric('Available vehicles', available)}
                ${opsMetric('Pickups today', pickups.length)}
                ${opsMetric('Returns today', returns.length)}
                ${opsMetric('Overdue returns', overdue.length)}
            </div>
            <div class="stack">
                <section class="panel dashboard-schedule">
                    <div class="panel-header">
                        <h2 class="panel-title">Today's schedule</h2>
                        <a href="#/admin/reservations" class="btn btn-sm btn-ghost">View reservations</a>
                    </div>
                    <div class="panel-body">
                        ${opsTable(['Customer', 'Motorcycle', 'Rental period', 'Status', 'Reservation'], scheduleRows)}
                        <div class="divider"></div>
                        <h3 class="dashboard-subtitle">Pickup and return schedule</h3>
                        ${opsTable(['Movement', 'Motorcycle', 'Customer', 'Time', 'Reservation'], movementRows)}
                    </div>
                </section>
                ${dashboardAttention(overdue)}
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
                            ${vehicleStatusBadges(vehicle)}
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

                        <div class="fleet-card-actions">

                            <select
                                class="select"
                                aria-label="Vehicle status"
                                ${activeVehicleRental(vehicle.id) ? 'disabled title="Managed by active reservation"' : ''}
                                onchange="App.changeVehicleStatus(
                                    '${vehicle.id}',
                                    this.value
                                )"
                            >
                                ${(activeVehicleRental(vehicle.id) ? ['rented'] : statuses).map(status => `
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
                        ${activeVehicleRental(vehicle.id) ? `<p class="small muted mt-2">Status managed by <a href="#/admin/reservation/${esc(activeVehicleRental(vehicle.id).id)}">active rental</a>. Report issues in Maintenance.</p>` : vehicleCondition(vehicle.id) !== 'available' ? `<p class="small muted mt-2">Resolve open records in <a href="#/admin/maintenance">Maintenance</a> to release this hold.</p>` : ''}
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
        appendOps(adminChangesSummary()+waitlistPanel(true));
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
        appendOps(opsPaymentLedger());
    }
    // ---------- Admin: Maintenance ----------
    function maintenanceTileData(vehicle) {
        const logs = state.maintenanceLogs.filter(l => l.vehicleId === vehicle.id)
            .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
        const open = logs.filter(l => l.status === 'open');
        const services = state.opsServices.filter(s => s.vehicleId === vehicle.id)
            .sort((a, b) => new Date(a.start) - new Date(b.start));
        const scheduled = services.filter(s => s.status === 'scheduled');
        const due = maintenanceDue(vehicle);
        const needsAttention = open.length > 0 || ['Due', 'Due soon'].includes(due) ||
            vehicleCondition(vehicle.id) !== 'available';
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
                <div class="maint-bike-name"><h2>${esc(v.name)}</h2><p class="muted small">${esc(v.brand)} · ${esc(v.year)}</p><span class="mono muted">${esc(v.plateNumber)}</span>${vehicleStatusBadges(v)}</div>
            </div>
            <div class="maint-tile-body">
                <div class="maint-section-head"><strong>Service plan</strong>${maintenancePlanBadge(due)}</div>
                <dl class="maint-specs">
                    <div><dt>Odometer</dt><dd>${maintenanceKm(v.odometer)}</dd></div>
                    <div><dt>Next service date</dt><dd>${v.servicePlan?.nextDate ? fmtDateShort(v.servicePlan.nextDate) : '—'}</dd></div>
                    <div><dt>Next service odometer</dt><dd>${maintenanceKm(v.servicePlan?.nextKm)}</dd></div>
                </dl>
                <div class="maint-section-head"><strong>Scheduled service</strong><span class="muted small">${scheduled.length} planned</span></div>
                ${next ? `<div class="maint-mini"><strong>${esc(next.title)}</strong><p class="small muted">${fmtDate(next.start,{time:true})}</p></div>` : '<p class="small muted maint-mini">No upcoming service scheduled.</p>'}
                <div class="maint-section-head"><strong>${open.length ? 'Open issues' : 'Latest record'}</strong><span class="${open.length ? 'maint-alert' : 'muted'} small">${open.length} open · ${logs.length} total</span></div>
                ${latest ? `<div class="maint-mini"><strong>${esc(latest.title)}</strong><p class="small muted">${fmtDateShort(latest.reportedAt)} · ${fmtPHP(latest.cost || 0)}</p><div class="maint-mini-footer">${statusBadge(latest.status)}<button class="btn btn-sm" onclick="App.viewMaintenance('${esc(latest.id)}')">View</button></div></div>` : '<p class="small muted maint-mini">No maintenance records yet.</p>'}
            </div>
            <div class="maint-actions">
                <button class="btn" onclick="App.openServicePlan('${id}')">Service plan</button>
                <button class="btn" onclick="App.openService('${id}')">Schedule service</button>
                <button class="btn" onclick="App.openMaintenanceHistory('${id}')">History</button>
                <button class="btn btn-primary" onclick="App.openMaintenanceModal(null, '${id}')">Log entry</button>
            </div>
        </article>`;
    }

    function renderAdminMaintenance() {
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
        mount(`<div class="page-header"><div><h1 class="page-title">Maintenance and incidents</h1><p class="page-desc">Manage service plans, scheduled work and motorcycle condition in one place.</p></div><div class="btn-group"><button class="btn" onclick="App.openService()">Schedule service</button><button class="btn btn-primary" onclick="App.openMaintenanceModal()">Log entry</button></div></div>
            <div class="metrics maint-metrics mb-3">${[
                ['Motorcycles', items.length], ['Needs attention', attention.length],
                ['Open records', state.maintenanceLogs.filter(l => l.status === 'open').length],
                ['Scheduled jobs', state.opsServices.filter(s => s.status === 'scheduled').length]
            ].map(([label,value]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('')}</div>
            <div class="maint-filter chip-group" aria-label="Filter maintenance vehicles">${filters.map(([key,label,list]) => `<button class="chip ${selected[0] === key ? 'active' : ''}" aria-pressed="${selected[0] === key}" onclick="App.setUI('maintenanceTileFilter','${key}'); App.render()">${label} <span class="maint-count">${list.length}</span></button>`).join('')}</div>
            ${visible.length ? `<div class="maint-grid">${visible.map(maintenanceTileHTML).join('')}</div>` : '<div class="empty"><div class="empty-title">No motorcycles match this filter</div>Choose another filter to see the fleet.</div>'}
            ${orphanLogs.length ? `<section class="section mt-3"><h2 class="section-title mb-2">Records without a matching motorcycle</h2><div class="stack">${orphanLogs.map(maintenanceRecordHTML).join('')}</div></section>` : ''}`);
    }

    function openMaintenanceHistory(id) {
        if (state.role !== 'admin') return;
        const vehicle = getVehicle(id);
        if (!vehicle) return;
        const { logs, services } = maintenanceTileData(vehicle);
        openModal(`<div class="modal maint-history-modal"><div class="modal-header"><div><div class="modal-title">${esc(vehicle.name)} — maintenance history</div><div class="muted small">${esc(vehicle.plateNumber)}</div></div><button class="icon-btn" aria-label="Close" onclick="App.closeModal()">&times;</button></div>
            <div class="modal-body stack"><div class="maint-section-head"><h3>Scheduled service</h3></div>
            ${services.length ? services.map(s => `<div class="maint-record"><div class="maint-record-top"><strong>${esc(s.title)}</strong><span class="status status-${s.status === 'scheduled' ? 'approved' : s.status === 'completed' ? 'completed' : 'neutral'}">${esc(s.status)}</span></div><div class="small muted">${fmtDate(s.start,{time:true})} – ${fmtDate(s.end,{time:true})}</div>${s.status === 'scheduled' ? `<div class="btn-group"><button class="btn btn-sm btn-primary" onclick="App.openFinishService('${esc(s.id)}')">Complete</button><button class="btn btn-sm btn-danger" onclick="App.cancelService('${esc(s.id)}')">Cancel</button></div>` : ''}</div>`).join('') : '<p class="muted small">No scheduled service records.</p>'}
            <div class="divider"></div><h3>Maintenance and incident records</h3>
            ${logs.length ? logs.map(maintenanceRecordHTML).join('') : '<p class="muted small">No records yet.</p>'}</div>
            <div class="modal-footer"><button class="btn" onclick="App.closeModal()">Close</button><button class="btn btn-primary" onclick="App.openMaintenanceModal(null, '${esc(id)}')">Log entry</button></div></div>`);
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
        appendOps(opsCustomerControls());
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
        const body = `
            <div class="kv">
                <div class="k">Status</div><div class="v">${statusBadge(status === 'paid' ? 'verified' : status === 'not_applicable' ? 'neutral' : status === 'unpaid' ? 'pending' : status)} ${labels[status]}</div>
                <div class="k">Billable hours</div><div class="v">${esc(o.hours ?? '—')}</div>
                <div class="k">Hourly rate</div><div class="v">${fmtPHP(o.ratePerHour || 0)}</div>
                <div class="k">Calculated fee</div><div class="v">${fmtPHP(o.calculatedFee ?? r.overtimeFee)}</div>
                <div class="k">Final charge</div><div class="v">${fmtPHP(r.overtimeFee)}</div>
                <div class="k">Outstanding</div><div class="v">${fmtPHP(status === 'paid' ? 0 : r.overtimeFee)}</div>
            </div>
            ${o.adjustmentReason ? `<p class="small muted mt-2">Adjustment: ${esc(o.adjustmentReason)}</p>` : ''}
            ${o.assessedAt ? `<p class="small muted mt-2">Assessed by ${esc(o.assessedBy)} · ${fmtDate(o.assessedAt, {time:true})}</p>` : ''}
            ${p ? `<div class="proof-preview">${p.proofDataUrl ? `<img src="${esc(p.proofDataUrl)}" alt="Overtime payment proof">` : 'Demo proof on file'}</div>` : ''}
            ${p?.rejectReason ? `<div class="callout danger mt-2">${esc(p.rejectReason)}</div>` : ''}
            ${admin && status === 'pending' ? `<div class="btn-group mt-3"><button class="btn btn-primary" onclick="App.verifyPayment('${p.id}')">Verify</button><button class="btn btn-danger" onclick="App.openRejectPaymentModal('${p.id}')">Reject</button></div>` : ''}
            ${!admin && ['unpaid','rejected'].includes(status) ? `<button class="btn btn-primary btn-block mt-3" onclick="App.openOvertimePayment('${r.id}')">${status === 'rejected' ? 'Resubmit' : 'Upload'} overtime proof</button>` : ''}`;
        return reservationPanel('Overtime payment', body);
    }

    function openOvertimePayment(id) {
        const r = getReservation(id);
        if (state.role !== 'customer' || !r || !ownsReservation(r) || r.status !== 'completed' || !['unpaid','rejected'].includes(overtimeStatus(r))) return;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Settle overtime</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div>
            <form onsubmit="App.submitOvertimePayment(event,'${r.id}')"><div class="modal-body stack">
                <div class="callout info">Amount due: <strong>${fmtPHP(r.overtimeFee)}</strong></div>
                <label class="field">Payment method<select name="method" class="select"><option>GCash</option><option>Other</option></select></label>
                <label class="field">Payment proof<input name="proof" type="file" class="input" accept="image/jpeg,image/png,image/webp" required></label>
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
        const rate = (Number(r.totalFee || 0) + state.opsCharges.filter(c=>c.reservationId===r.id&&c.type==='extension').reduce((s,c)=>s+c.paid,0)) / bookedDays;
        const gross = Math.round(unusedDays * rate * 100) / 100;
        const deduction = ['early_return','customer_damage'].includes(reasonType) ? Math.min(gross, unusedDays * EARLY_RETURN_FEE) : 0;
        const payment = getPaymentByReservation(r.id);
        const paid = rentalPaid(r);
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
        const paid = rentalPaid(r);
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
        const paid = rentalPaid(r), amount = Number(f.amount.value), reasonType = f.reasonType.value, reasonNotes = f.reasonNotes.value.trim();
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
            preview.innerHTML = `<strong>Early return refund</strong><br>Full unused days: ${f.unusedDays}<br>Unused rental value: ${fmtPHP(f.gross)}<br>Early return fee: −${fmtPHP(f.deduction)}<br>Refund due: <strong>${fmtPHP(f.amount)}</strong>${!f.paid && f.unusedDays ? '<br>No verified rental payment available to refund.' : ''}`;
            return;
        }
        const ot = computeOvertime(r.vehicleId, r.end, actual);
        const override = form.elements.finalFee.value;
        const final = late && override !== '' ? Number(override) : ot.fee;
        preview.innerHTML = late ? `Billable overtime: <strong>${ot.hours} hour(s)</strong><br>Calculated: ${fmtPHP(ot.fee)}<br>Final charge: <strong>${fmtPHP(final)}</strong>` : 'Returned on time. No adjustment.';
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
                    <label class="field">Override fee (optional; 0 to waive)<input name="finalFee" type="number" min="0" step="0.01" class="input" placeholder="Use calculated fee"></label>
                    <label class="field">Adjustment reason<textarea name="adjustmentReason" class="textarea" rows="2" placeholder="Required if fee changes"></textarea></label>
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
            if (changed) c.licenseEligibility=null;
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
        if (!form)
            return;
        const start = form.start.value, end = form.end.value;
        const box = $('#feePreview'), msg = $('#conflictMsg');
        if (msg)
            msg.innerHTML = '';
        if (!start || !end) {
            box.className = 'callout info small';
            box.innerHTML = 'Select start and end dates to calculate the estimated fee.';
            return;
        }
        if (new Date(end) <= new Date(start)) {
            box.className = 'callout danger small';
            box.innerHTML = 'End date and time must be after the start.';
            return;
        }
        const q = quoteOps(vehicleId,start+'+08:00',end+'+08:00',form.deliveryMethod?.value,form.promoCode?.value);
        const {days,rental:total}=q;
        box.className = 'callout small';
        box.innerHTML = `<strong>Rental (${days} day(s)):</strong> ${fmtPHP(q.gross)}<div>Voucher discount: ${fmtPHP(q.discount)}${q.valid?'':' · Invalid voucher'}</div><div>Delivery / collection: ${fmtPHP(q.delivery)}</div><div>Refundable deposit: ${fmtPHP(q.deposit)}</div><strong>Estimated upfront total: ${fmtPHP(total+q.delivery+q.deposit)}</strong><div class="muted small">Overtime is assessed at return. Deposit is separate from revenue.</div>`;
        const conflict = hasConflict(vehicleId, new Date(start + '+08:00').toISOString(), new Date(end + '+08:00').toISOString());
        if (conflict.conflict && msg)
            msg.innerHTML = `<div class="callout danger small mt-2"><strong>Dates unavailable.</strong> ${esc(conflict.reason || 'This vehicle is already booked for the selected period.')}</div>`;
    }
    function submitReservation(e, vehicleId) {
        e.preventDefault();
        if (state.role !== 'customer') return;
        expireAndWaitlist();
        const policy = bookingPolicy(currentCustomer()); if(policy) return toast(policy,'error');
        if (state.reservations.some(r => ownsReservation(r) && r.status === 'completed' && ['unpaid','pending','rejected'].includes(overtimeStatus(r)))) return toast('Settle outstanding overtime before requesting another rental.', 'error');
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');
        if (btn && btn.disabled)
            return;
        const startVal = form.start.value, endVal = form.end.value;
        const deliveryMethod = form.deliveryMethod ? form.deliveryMethod.value : '';
        if (!startVal || !endVal) {
            toast('Please select start and end dates.', 'error');
            return;
        }
        if (!DELIVERY_METHODS.includes(deliveryMethod)) {
            toast('Please select a delivery method.', 'error');
            if (form.deliveryMethod)
                form.deliveryMethod.focus();
            return;
        }
        const start = opsDate(startVal), end = opsDate(endVal);
        if(!start||!end||Date.parse(start)<=Date.now()) return toast('Choose a future pickup and valid return.','error');
        if (new Date(end) <= new Date(start)) {
            toast('End date must be after start date.', 'error');
            updateFeePreview(vehicleId);
            return;
        }
        const conflict = hasConflict(vehicleId, start, end);
        if (conflict.conflict) {
            const msg = $('#conflictMsg');
            if (msg)
                msg.innerHTML = `<div class="callout danger small"><strong>Dates unavailable.</strong> ${esc(conflict.reason || '')}</div>`;
            toast('Selected dates overlap an existing booking.', 'error');
            return;
        }
        if (btn)
            btn.disabled = true;
        const cust = currentCustomer();
        if (!cust) {
            if (btn)
                btn.disabled = false;
            toast('No customer account selected.', 'error');
            return;
        }
        const q = quoteOps(vehicleId,start,end,deliveryMethod,form.promoCode?.value);
        if(!q.valid||q.rental<=0){if(btn)btn.disabled=false;return toast('Enter a valid voucher and positive rental amount.','error');}
        const total=q.rental;
        const r = { id: uid('r'), vehicleId, customerId: cust.id, customerName: cust.name, customerEmail: cust.email, start, end, actualReturn: null, status: 'pending', totalFee: total, overtimeFee: 0, createdAt: new Date().toISOString(), approvedBy: null, rejectReason: '', adminNotes: '', deliveryMethod, quote:{...q,dailyRate:getVehicle(vehicleId).ratePerDay}, deposit:q.deposit>0?{amount:q.deposit,status:'unpaid'}:null };
        setTimeout(() => {
            if(state.role!=='customer'||currentCustomer()?.id!==cust.id||hasConflict(vehicleId,start,end).conflict){if(btn)btn.disabled=false;return toast('Availability changed; check dates again.','error');}
            state.reservations.unshift(r);
            if(q.delivery>0)state.opsCharges.push(opCharge(r,'delivery',q.delivery,'Quoted host delivery / collection'));
            notify('admin', 'New reservation request', `${cust.name} requested ${getVehicle(vehicleId)?.name || 'a vehicle'}.`, '#/admin/reservations');
            toast('Reservation request submitted.', 'success');
            navigate('#/customer/reservations');
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
        expireAndWaitlist();
        if (state.role !== 'customer' || !r || r.status !== 'approved' || !ownsReservation(r) || ['pending', 'verified'].includes(getPaymentByReservation(reservationId)?.status))
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
        if (!Number.isFinite(amount) || money(amount)!==money(r.totalFee)) {
            toast('Payment must match the quoted rental amount.', 'error');
            return;
        }
        if (btn)
            btn.disabled = true;
        const proofDataUrl = URL.createObjectURL(file);
        setTimeout(() => {
            if(state.role!=='customer'||!ownsReservation(r)||r.status!=='approved'||['pending','verified'].includes(getPaymentByReservation(reservationId)?.status)){if(btn)btn.disabled=false;return;}
            const existing = getPaymentByReservation(reservationId);
            if (existing) {
                Object.assign(existing, { method, amount, status: 'pending', submittedAt: new Date().toISOString(), proofDataUrl, requiresNewProof:false, rejectReason: '', verifiedBy: null });
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
        if(Date.parse(r.start)<=Date.now())return toast('Pickup time has already passed. Reschedule first.','error');
        const policy=bookingPolicy(customer);if(policy)return toast(policy,'error');
        if (!customer || identityStatus(customer) !== 'verified' || !identityComplete(customer.identification)) {
            toast('Verify the customer identity and valid license before approving.', 'error');
            if (customer) openCustomerModal(customer.id);
            return;
        }
        if(!licenseEligible(customer,r))return toast('Confirm motorcycle license authorization in Customers; license must cover the rental period.','error');
        const conflict = hasConflict(r.vehicleId, r.start, r.end, r.id);
        if (conflict.conflict) {
            toast(conflict.reason, 'error');
            return;
        }
        r.status = 'approved';
        r.paymentDeadline=new Date(Math.min(Date.parse(r.start),Date.now()+state.opsSettings.paymentHours*3600000)).toISOString();
        r.approvedBy = 'Admin';
        notify('customer', 'Reservation approved', `Your ${getVehicle(r.vehicleId)?.name || 'reservation'} was approved. You may now upload payment proof.`, '#/customer/reservations',r.customerId);
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
        if (!adminOnly() || !r || r.status !== 'approved')
            return;
        openConfirm({ title: 'Start rental', body: `<p class="small muted">Mark this reservation as ongoing? The vehicle will be set to <strong>Rented</strong>.</p>`, confirmLabel: 'Start rental', onConfirm: () => {
                if(!adminOnly())return;
                expireAndWaitlist();
                closeModal();
                const vehicle = getVehicle(r.vehicleId);
                if(Date.now()<Date.parse(r.start)||Date.now()>=Date.parse(r.end))return toast('Rental release must occur within the scheduled period.','error');
                if(!licenseEligible(getCustomer(r.customerId),r))return toast('Current identity and motorcycle license authorization required.','error');
                const policy=bookingPolicy(getCustomer(r.customerId));if(policy)return toast(policy,'error');
                if(serviceConflict(r.vehicleId,nowISO(),r.end))return toast('A planned service conflicts with the rental.','error');
                if(r.deposit&&r.deposit.status!=='held')return toast('Record security deposit receipt before release.','error');
                if(outstandingOps(r)>0)return toast('Settle delivery and additional charges before release.','error');
                if (r.status !== 'approved' || !vehicle || vehicleCondition(vehicle.id) !== 'available' || reservationsForVehicle(r.vehicleId).some(x => x.id !== r.id && x.status === 'ongoing')) {
                    toast('Vehicle is not available for release.', 'error');
                    return;
                }
                if (getPaymentByReservation(r.id)?.status !== 'verified') {
                    toast('Verify payment before starting the rental.', 'error');
                    return;
                }
                r.status = 'ongoing';
                const v = getVehicle(r.vehicleId);
                refreshMaintenanceStatus(r.vehicleId);
                notify('customer', 'Rental started', `Your rental for ${v ? v.name : 'the vehicle'} is now ongoing.`, '#/customer/reservations',r.customerId);
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
        const ot = computeOvertime(r.vehicleId, r.end, actual);
        const override = e.target.elements.finalFee.value;
        const late = parsed > new Date(r.end);
        const finalFee = !late || override === '' ? ot.fee : Number(override);
        const reason = late ? e.target.elements.adjustmentReason.value.trim() : '';
        const reasonType = e.target.elements.refundReason.value;
        const reasonNotes = e.target.elements.refundNotes.value.trim();
        if (parsed < new Date(r.end) && (!['early_return','vehicle_defect','customer_damage','service_issue'].includes(reasonType) || (reasonType !== 'early_return' && !reasonNotes))) return toast('Select a refund reason and provide assessment notes.', 'error');
        const refund = {...computeEarlyRefund(r, actual, reasonType), reasonNotes};
        if (refund.unusedDays && !refund.paid) return toast('Verify the original rental payment before assessing a refund.', 'error');
        if (!Number.isFinite(finalFee) || finalFee < 0 || (finalFee !== ot.fee && !reason)) return toast('Enter a valid fee and a reason for any adjustment.', 'error');
        r.status = 'completed';
        r.actualReturn = actual;
        r.refund = parsed < new Date(r.end) ? {...refund, status:refund.amount > 0 ? 'pending' : 'not_applicable', assessedBy:'Admin', assessedAt:new Date().toISOString()} : null;
        r.overtimeFee = finalFee;
        r.overtime = { hours:ot.hours, ratePerHour:getVehicle(r.vehicleId)?.ratePerHour || 0, calculatedFee:ot.fee, finalFee, adjustmentReason:reason, assessedBy:'Admin', assessedAt:new Date().toISOString(), paymentStatus:finalFee > 0 ? 'unpaid' : 'not_applicable' };
        const v = getVehicle(r.vehicleId);
        refreshMaintenanceStatus(r.vehicleId);
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
                if(p.requiresNewProof)return toast('Proof was not retained. Reject and request a new upload.','error');
                if((p.paymentType||'rental')==='rental'&&(!reservation||reservation.status!=='approved'||money(p.amount)!==money(reservation.totalFee)))return toast('Payment is no longer eligible or does not match the rental total.','error');
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
        if((p.paymentType||'rental')==='rental'&&reservation?.status==='approved')reservation.paymentDeadline=new Date(Math.min(Date.parse(reservation.start),Date.now()+state.opsSettings.paymentHours*3600000)).toISOString();
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
        setVehicleStatus(id, status);
    }
    function setVehicleStatus(id, status) {
        const v = getVehicle(id);
        if (!adminOnly() || !v) return;
        if (!['available', 'maintenance', 'malfunction'].includes(status) || activeVehicleRental(id)) {
            toast('Rental status is controlled by the active reservation.', 'error');
            render(); return;
        }
        const condition = vehicleCondition(id);
        if (status === condition) return;
        if (status === 'available') {
            toast('Resolve all open maintenance and incident records first.', 'error');
            render(); return;
        }
        // Reset the select while the reason dialog is open.
        render();
        opsModal('Change vehicle condition', `submitVehicleCondition(event,'${id}','${status}')`,
            `<p>Mark ${esc(vLabel(v))} as ${esc(status)}? A corresponding maintenance record will be created.</p>${opsReason()}`, 'Confirm status');
    }
    function submitVehicleCondition(e, id, status) {
        e.preventDefault();
        const v = getVehicle(id), reason = e.target.elements.reason.value.trim();
        if (!adminOnly() || !v || !['maintenance','malfunction'].includes(status) || activeVehicleRental(id)) return toast('Status change not permitted.', 'error');
        if (!reason) return toast('Provide a reason.', 'error');
        if (vehicleCondition(id) === status) { closeModal(); render(); return; }
        if (vehicleCondition(id) === 'malfunction' && status === 'maintenance') return toast('Resolve the open incident before changing to maintenance.', 'error');
        const log = {id:uid('m'), vehicleId:id, type:status === 'malfunction' ? 'incident' : 'maintenance',
            title:status === 'malfunction' ? 'Malfunction reported' : 'Maintenance required', description:reason,
            damageLocation:'unknown', photos:[], cost:0, status:'open', reportedAt:nowISO(), resolvedAt:null};
        state.maintenanceLogs.unshift(log);
        refreshMaintenanceStatus(id, true);
        opsDone('Vehicles', id, 'Vehicle condition reported', reason, 'Status updated and maintenance record created.');
    }
    function notifyAffectedReservations(id, condition) {
        const affected = reservationsForVehicle(id).filter(r => ['approved','pending'].includes(r.status) && Date.parse(r.end) > Date.now());
        if (affected.length) notify('admin', 'Reservations affected by vehicle condition',
            `${getVehicle(id).name}: ${condition}. Review ${affected.map(r => r.id.toUpperCase()).join(', ')}.`, '#/admin/reservations');
    }
    function saveVehicle(e, id) {
        e.preventDefault();
        const f = e.target;
        const data = {
            name: f.elements.namedItem('name').value.trim(), displacement: f.elements.namedItem('displacement').value, brand: f.brand.value.trim(), model: f.model.value.trim(),
            year: Number(f.year.value), plateNumber: f.plateNumber.value.trim(),
            ratePerDay: Number(f.ratePerDay.value), ratePerHour: Number(f.ratePerHour.value),
            color: f.color.value.trim(), seats: Number(f.seats.value || 2), transmission: f.transmission.value
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
            Object.assign(getVehicle(id), data);
            toast('Vehicle updated.', 'success');
        }
        else {
            state.vehicles.unshift({ id: uid('v'), status: 'available', imageEmoji: '', ...data });
            toast('Vehicle added.', 'success');
        }
        closeModal();
        render();
    }
    function refreshMaintenanceStatus(vehicleId, alert = false) {
        const vehicle = getVehicle(vehicleId);
        if (!vehicle) return;
        const condition = vehicleCondition(vehicleId);
        vehicle.status = activeVehicleRental(vehicleId) ? 'rented' : condition;
        if (alert && condition !== 'available') notifyAffectedReservations(vehicleId, condition);
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
                refreshMaintenanceStatus(data.vehicleId, true);
            }
        } else {
            state.maintenanceLogs.unshift({ id: uid('m'), ...data, status: 'open', reportedAt: new Date().toISOString(), resolvedAt: null });
            refreshMaintenanceStatus(data.vehicleId, true);
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
    // ---------- Operational extensions (demo, no real payment processing) ----------
    const OPS_DAY = 86400000;
    const OPS_KEY = 'vera_operations_demo_v1';
    const OPS_DEFAULTS = {paymentHours:24, deliveryFee:0, collectionFee:0, deposit:0, promoCode:'', promoPercent:0, serviceDays:90, serviceKm:3000, persist:false};
    const money = n => Math.round(Number(n || 0)*100)/100;
    const nowISO = () => new Date().toISOString();
    const adminOnly = () => state.role === 'admin';
    const own = r => state.role === 'customer' && r && ownsReservation(r);
    const accessible = r => r && (adminOnly() || own(r));
    const opsDate = v => v && Number.isFinite(Date.parse(v + '+08:00')) ? new Date(v + '+08:00').toISOString() : null;
    const opsInput = (name,label,type='text',value='',extra='') => `<label class="field"><span class="field-label">${esc(label)}</span><input class="input" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
    const opsReason = (name='reason',label='Reason') => `<label class="field"><span class="field-label">${esc(label)}</span><textarea class="textarea" name="${name}" required maxlength="500"></textarea></label>`;
    const opsBtn = (label,action,cls='') => `<button type="button" class="btn ${cls}" onclick="App.${action}">${esc(label)}</button>`;
    const opsModal = (title,action,body,label='Save') => openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${esc(title)}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div><form onsubmit="App.${action}"><div class="modal-body stack">${body}</div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancel</button><button type="submit" class="btn btn-primary">${esc(label)}</button></div></form></div>`);
    const opsMetric = (label,value) => `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value sm">${esc(value)}</div></div>`;
    const opsTable = (headers, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${headers.length}" class="muted">No records.</td></tr>`}</tbody></table></div>`;
    const opsRow = (...cells) => `<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`;
    const rLink = r => !r?'—':`<a href="#/admin/reservation/${esc(r.id)}">${esc(r.id.toUpperCase())}</a>`;
    const vLabel = v => v ? `${v.name} · ${v.plateNumber}` : 'Unknown vehicle';
    const opCharge = (r,type,amount,reason) => ({id:uid('ch'),reservationId:r.id,type,amount:money(amount),paid:0,reason,status:'unpaid',createdAt:nowISO(),transactions:[]});
    function restoreOps() {
        state.opsSettings = {...OPS_DEFAULTS};
        for (const k of ['opsCharges','opsChanges','opsServices','opsWaitlist','opsFeedback']) state[k] = [];
        try {
            const saved = JSON.parse(localStorage.getItem(OPS_KEY) || 'null');
            if (saved?.version === 1 && saved.settings?.persist) {
                state.opsSettings = {...OPS_DEFAULTS,...saved.settings};
                for (const k of ['vehicles','reservations','payments','maintenanceLogs','notifications','activityLogs','opsCharges','opsChanges','opsServices','opsWaitlist','opsFeedback']) if (Array.isArray(saved[k])) state[k] = saved[k];
                for (const c of state.customers) {
                    const flags = saved.customerFlags?.[c.id];
                    if (flags) {c.restriction = flags.restriction; c.totalRentals=flags.totalRentals;}
                }
            }
        } catch (err) { console.warn('Demo state could not be restored:',err); }
        for (const r of state.reservations) if (r.status === 'approved' && !r.paymentDeadline) r.paymentDeadline = new Date(Math.min(Date.parse(r.start),Date.now()+state.opsSettings.paymentHours*3600000)).toISOString();
    }
    restoreOps();
    migrateVehicleStatuses();
    function opsSnapshot() {
        const payload = {version:1,settings:state.opsSettings,customerFlags:Object.fromEntries(state.customers.map(c=>[c.id,{restriction:c.restriction||null,totalRentals:c.totalRentals}]))};
        for (const k of ['vehicles','reservations','payments','maintenanceLogs','notifications','activityLogs','opsCharges','opsChanges','opsServices','opsWaitlist','opsFeedback']) payload[k]=state[k];
        // Never persist ID/profile uploads, payment evidence or maintenance photos.
        payload.payments = state.payments.map(p=>({...p,requiresNewProof:Boolean(p.status==='pending'&&(p.proofDataUrl||p.requiresNewProof))}));
        return JSON.parse(JSON.stringify(payload,(k,v)=> ['proofDataUrl','photos','profileImage','idImage','licenseFront','licenseBack','idNumber','licenseNumber'].includes(k) ? undefined : v));
    }
    function persistOps() {
        if (!state.opsSettings.persist) return;
        try {localStorage.setItem(OPS_KEY,JSON.stringify(opsSnapshot()));} catch (err) {console.warn('Demo persistence failed',err);}
    }
    function opsAudit(module,id,action,reason='') {
        logActivity({module,entityId:id,description:id,action,changes:reason?[{field:'reason',previousValue:null,newValue:reason}]:[]},state.role,state.currentCustomerId);
    }
    function opsDone(module,id,action,reason='',message='Saved.') {
        opsAudit(module,id,action,reason); closeModal(); toast(message,'success'); render();
    }
    function opsDownload(name,text,type='application/json') {
        const url=URL.createObjectURL(new Blob([text],{type})), a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function backupOps() {if(adminOnly()) opsDownload('vera-demo-backup.json',JSON.stringify(opsSnapshot(),null,2));}
    function opsSettingsPage() {
        if (!adminOnly()) return;
        const s=state.opsSettings;
        mount(`<div class="page-header"><div><h1 class="page-title">Settings</h1><p class="page-desc">Configure rental policies for future reservations.</p></div></div><div class="grid-2"><div class="panel"><div class="panel-header"><div class="panel-title">Rental policies</div></div><div class="panel-body"><form class="stack" onsubmit="App.saveOpsSettings(event)">
            ${opsInput('paymentHours','Payment deadline after approval (hours)','number',s.paymentHours,'min="1" max="168" step="1" required')}
            ${opsInput('deliveryFee','Host delivery fee (PHP)','number',s.deliveryFee,'min="0" step="0.01" required')}
            ${opsInput('collectionFee','Host collection fee (PHP)','number',s.collectionFee,'min="0" step="0.01" required')}
            ${opsInput('deposit','Refundable security deposit (PHP)','number',s.deposit,'min="0" step="0.01" required')}
            ${opsInput('promoCode','Active voucher code (blank = disabled)','text',s.promoCode,'maxlength="30"')}
            ${opsInput('promoPercent','Voucher discount on rental (%)','number',s.promoPercent,'min="0" max="99" step="1" required')}
            ${opsInput('serviceDays','Default maintenance interval (days)','number',s.serviceDays,'min="1" step="1" required')}
            ${opsInput('serviceKm','Default maintenance interval (km)','number',s.serviceKm,'min="1" step="1" required')}
            <label class="field"><span><input type="checkbox" name="persist" ${s.persist?'checked':''}> Retain demo operational data on this browser</span><span class="field-hint">Fictional records only. Identification documents, profile uploads and proof images are excluded. Verification documents must be submitted again after reload. No secure server storage.</span></label><button class="btn btn-primary" type="submit">Save settings</button></form></div></div><div class="stack">${reservationPanel('Demo backup',`<p class="muted small mb-3">Export operational records without document images. Backup may still contain names, notes and transaction references. Use fictional data only.</p>${opsBtn('Export JSON backup','backupOps()')}`)}${reservationPanel('Policy notes','<p class="small muted">No real money is transferred. Delivery and deposits are separately recorded. Existing reservations retain their quoted terms. Unpaid approvals expire at the earlier of the payment deadline or pickup; submitted proofs remain held for review.</p>')}</div></div>`);
    }
    function saveOpsSettings(e) {
        e.preventDefault(); if (!adminOnly()) return;
        const f=e.target.elements, next={...state.opsSettings};
        for (const k of ['paymentHours','deliveryFee','collectionFee','deposit','promoPercent','serviceDays','serviceKm']) {
            const n=Number(f[k].value); if(!Number.isFinite(n)||n<0||n>1e9) return toast('Invalid policy value.','error'); next[k]=n;
        }
        if (!Number.isInteger(next.paymentHours)||next.paymentHours<1||next.paymentHours>168||next.promoPercent>99||next.serviceDays<1||next.serviceKm<1) return toast('Check policy limits.','error');
        next.promoCode=f.promoCode.value.trim().toUpperCase(); next.persist=f.persist.checked;
        state.opsSettings=next;
        if(!next.persist) {try{localStorage.removeItem(OPS_KEY);}catch{}}
        opsDone('Settings','policies','Updated rental policies');
    }
    function deliveryAmount(method) {return money((method?.startsWith('Host Delivery')?state.opsSettings.deliveryFee:0)+(method?.endsWith('Host Collection')?state.opsSettings.collectionFee:0));}
    function quoteOps(vehicleId,start,end,method,code='') {
        const q=computeFee(vehicleId,start,end), s=state.opsSettings, entered=String(code||'').trim().toUpperCase(), valid=!entered||(s.promoCode && entered===s.promoCode && s.promoPercent>0);
        const discount=valid&&entered?money(q.total*s.promoPercent/100):0;
        return {days:q.days,gross:q.total,discount,rental:money(q.total-discount),delivery:deliveryAmount(method),deposit:money(s.deposit),valid:Boolean(valid),promo:entered};
    }
    function opsCustomerRestriction(c) {return c?.restriction?.active ? c.restriction.reason : '';}
    function outstandingOps(r) {return state.opsCharges.filter(c=>c.reservationId===r.id&&c.status==='unpaid').reduce((s,c)=>s+Math.max(0,c.amount-c.paid),0);}
    function bookingPolicy(c) {
        if(opsCustomerRestriction(c)) return 'Account restricted: '+opsCustomerRestriction(c);
        if(state.reservations.some(r=>r.customerId===c?.id&&r.status==='completed'&&outstandingOps(r)>0)) return 'Settle outstanding rental charges first.';
        return '';
    }
    function rentalPaid(r) {return (getPaymentByReservation(r.id)?.status==='verified'?Number(getPaymentByReservation(r.id).amount||0):0)+state.opsCharges.filter(c=>c.reservationId===r.id&&c.type==='extension').reduce((s,c)=>s+c.paid,0);}
    function expireAndWaitlist() {
        let changed=false;
        for (const r of state.reservations) {
            if (r.status!=='approved'||!r.paymentDeadline||Date.parse(r.paymentDeadline)>Date.now()) continue;
            const p=getPaymentByReservation(r.id);
            if (p&&['pending','verified'].includes(p.status)) continue;
            if (state.opsCharges.some(c=>c.reservationId===r.id&&c.paid>0)||r.deposit?.status==='held') continue; // financial review required
            r.status='cancelled'; r.cancelReason='Payment deadline expired'; r.expiredAt=nowISO();
            notify('customer','Reservation expired','The payment deadline passed. You may submit a new request.','#/customer/reservations',r.customerId);
            notify('admin','Unpaid reservation expired',r.id.toUpperCase(),'#/admin/reservations'); changed=true;
            logActivity({module:'Reservations',entityId:r.id,description:r.id,action:'Expired automatically',changes:[{field:'status',previousValue:'approved',newValue:'cancelled'}]},'admin','system');
        }
        for (const w of state.opsWaitlist) {
            if(w.status!=='waiting') continue;
            if(Date.parse(w.start)<=Date.now()){w.status='expired';changed=true;continue;}
            if (!hasConflict(w.vehicleId,w.start,w.end).conflict) {
                w.status='notified'; w.notifiedAt=nowISO();
                notify('customer','Waitlisted motorcycle available',`${getVehicle(w.vehicleId)?.name || 'Motorcycle'} is now available for your requested dates. Submit a reservation; availability is not guaranteed.`,`#/customer/vehicle/${w.vehicleId}`,w.customerId);changed=true;
            }
        }
        if(changed) persistOps(); return changed;
    }
    // ---------- Fleet schedule: interactive dispatch calendar ----------
    const fleetVehicleSelect = selected => `<label class="field"><span class="field-label">Motorcycle</span><select class="select" name="vehicleId" required>${state.vehicles.map(v=>`<option value="${esc(v.id)}" ${v.id===selected?'selected':''}>${esc(vLabel(v))}</option>`).join('')}</select></label>`;
    function opsSchedule() {
        if(!adminOnly()) return;
        const raw=state.ui.opsScheduleStart||todayKey();
        const parsed=Date.parse(raw+'T00:00:00+08:00');
        const base=Number.isFinite(parsed)?parsed:Date.parse(todayKey()+'T00:00:00+08:00');
        const start=toManilaDateKey(new Date(base).toISOString());
        const days=Number(state.ui.fleetDays)===7?7:14;
        const filter=state.ui.fleetVehicle||'all';
        const kind=state.ui.fleetKind||'all';
        const dates=Array.from({length:days},(_,i)=>new Date(base+i*OPS_DAY).toISOString());
        const shift=n=>toManilaDateKey(new Date(base+n*OPS_DAY).toISOString());
        const windowEnd=new Date(base+days*OPS_DAY).toISOString();
        const fleet=state.vehicles.filter(v=>filter==='all'||v.id===filter);
        const inFleet=x=>fleet.some(v=>v.id===x.vehicleId);
        const visibleReservations=state.reservations.filter(r=>inFleet(r)&&['pending','approved','ongoing','completed'].includes(r.status)&&overlaps(dates[0],windowEnd,r.start,r.actualReturn||r.end));
        const visibleServices=state.opsServices.filter(m=>inFleet(m)&&m.status==='scheduled'&&overlaps(dates[0],windowEnd,m.start,m.end));
        const rows=fleet.map(v=>`<tr><th scope="row" class="ops-fleet-name"><strong>${esc(v.name)}</strong><div class="small muted">${esc(v.plateNumber)}</div><div>${vehicleStatusBadges(v)}</div></th>${dates.map(d=>{
            const key=toManilaDateKey(d), end=new Date(Date.parse(d)+OPS_DAY).toISOString();
            const rs=visibleReservations.filter(r=>r.vehicleId===v.id&&overlaps(d,end,r.start,r.actualReturn||r.end));
            const ms=visibleServices.filter(m=>m.vehicleId===v.id&&overlaps(d,end,m.start,m.end));
            const down=vehicleCondition(v.id)!=='available'&&Date.parse(end)>Date.now();
            const overdue=state.reservations.some(r=>r.vehicleId===v.id&&r.status==='ongoing'&&Date.parse(r.end)<=Date.now())&&Date.parse(end)>Date.now();
            const canAdd=key>=todayKey();
            return `<td class="ops-schedule-cell ${down||overdue?'ops-down':''} ${key===todayKey()?'fleet-today':''}">
                ${kind!=='service'?rs.map(r=>`<button type="button" class="ops-event ops-${r.status}" onclick="App.openFleetEvent('reservation','${esc(r.id)}')" title="${esc(r.customerName+' · '+fmtDate(r.start,{time:true})+' – '+fmtDate(r.end,{time:true}))}">${esc(r.customerName)}<small>${esc(r.status)} · ${esc(r.id.toUpperCase())}</small></button>`).join(''):''}
                ${kind!=='rental'?ms.map(m=>`<button type="button" class="ops-event ops-service" onclick="App.openFleetEvent('service','${esc(m.id)}')" title="${esc(m.title)}">${esc(m.title)}<small>Scheduled service</small></button>`).join(''):''}
                ${down||overdue?`<small class="muted">${overdue?'Overdue rental':'Unavailable'}</small>`:''}
                ${canAdd?`<button type="button" class="fleet-add" onclick="App.openFleetCreate('${esc(v.id)}','${key}')" aria-label="Add schedule for ${esc(vLabel(v))} on ${key}">+ Add</button>`:!rs.length&&!ms.length&&!down?'<span class="ops-free">—</span>':''}
            </td>`;
        }).join('')}</tr>`);
        mount(`<div class="page-header"><div><h1 class="page-title">Fleet schedule</h1><p class="page-desc">Manage reservations and service windows directly from the calendar · Manila time</p></div><div class="btn-group">${opsBtn('New reservation',`openFleetReservation('','${start}')`,'btn-primary')}${opsBtn('Schedule service',`openFleetService('','','${start}')`)}</div></div>
            <div class="metrics mb-3">${opsMetric('Pending requests',visibleReservations.filter(r=>r.status==='pending').length)}${opsMetric('Confirmed / ongoing',visibleReservations.filter(r=>['approved','ongoing'].includes(r.status)).length)}${opsMetric('Scheduled services',visibleServices.length)}${opsMetric('Motorcycles shown',fleet.length)}</div>
            <div class="toolbar fleet-toolbar">${opsBtn('‹ Previous',`setSchedule('${shift(-days)}')`)}<input class="input" type="date" aria-label="Schedule start" value="${esc(start)}" onchange="App.setSchedule(this.value)">${opsBtn('Today',`setSchedule('${todayKey()}')`)}${opsBtn('Next ›',`setSchedule('${shift(days)}')`)}<select class="select" aria-label="Calendar range" onchange="App.setUI('fleetDays',this.value);App.render()"><option value="7" ${days===7?'selected':''}>7 days</option><option value="14" ${days===14?'selected':''}>14 days</option></select><select class="select" aria-label="Motorcycle filter" onchange="App.setUI('fleetVehicle',this.value);App.render()"><option value="all">All motorcycles</option>${state.vehicles.map(v=>`<option value="${esc(v.id)}" ${v.id===filter?'selected':''}>${esc(vLabel(v))}</option>`).join('')}</select><select class="select" aria-label="Event filter" onchange="App.setUI('fleetKind',this.value);App.render()">${[['all','All events'],['rental','Reservations'],['service','Service']].map(([k,l])=>`<option value="${k}" ${kind===k?'selected':''}>${l}</option>`).join('')}</select></div>
            <div class="fleet-range mb-2"><strong>${fmtDateShort(dates[0])} – ${fmtDateShort(dates[days-1])}</strong><span class="muted small">Select an event to manage it, or + Add to create one.</span></div>
            <div class="panel ops-calendar"><div class="table-wrap"><table class="table ops-fleet-table fleet-interactive" style="--fleet-days:${days}"><thead><tr><th scope="col">Motorcycle</th>${dates.map(d=>`<th scope="col" class="${toManilaDateKey(d)===todayKey()?'fleet-today':''}">${esc(new Date(d).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'short'}))}<strong>${esc(new Date(d).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}))}</strong></th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div></div>
            <div class="ops-legend mt-3"><span><i class="fleet-key ops-pending"></i>Pending (not held)</span><span><i class="fleet-key ops-approved"></i>Approved / ongoing</span><span><i class="fleet-key ops-completed"></i>Completed</span><span><i class="fleet-key ops-service"></i>Service / unavailable</span></div>`);
    }
    function setSchedule(date){if(adminOnly()&&/^\d{4}-\d{2}-\d{2}$/.test(date)){state.ui.opsScheduleStart=date;opsSchedule();}}
    function fleetDefaultDate(key) {
        const proposed=Date.parse((key||todayKey())+'T09:00:00+08:00');
        return new Date(Math.max(Number.isFinite(proposed)?proposed:0,Math.ceil((Date.now()+60000)/900000)*900000)).toISOString();
    }
    function openFleetCreate(vehicleId,key){
        if(!adminOnly()||!getVehicle(vehicleId))return;
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">Add to fleet schedule</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div><div class="modal-body stack"><strong>${esc(vLabel(getVehicle(vehicleId)))}</strong><p class="muted">${esc(key)}</p>${opsBtn('New reservation',`openFleetReservation('${esc(vehicleId)}','${esc(key)}')`,'btn-primary btn-block')}${opsBtn('Schedule maintenance',`openFleetService('','${esc(vehicleId)}','${esc(key)}')`,'btn-block')}</div></div>`);
    }
    function openFleetReservation(vehicleId='',key='') {
        if(!adminOnly())return;
        const start=fleetDefaultDate(key),end=new Date(Date.parse(start)+OPS_DAY).toISOString();
        opsModal('Create reservation','saveFleetReservation(event)',`<p class="callout info small">Creates a pending reservation on behalf of a customer. Approval, identity verification and payments follow the existing workflow.</p><label class="field"><span class="field-label">Customer</span><select name="customerId" class="select" required><option value="">Select customer</option>${state.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.email)}</option>`).join('')}</select></label>`+fleetVehicleSelect(vehicleId)+opsInput('start','Pickup (Manila time)','datetime-local',fmtDateTimeInput(start),'required')+opsInput('end','Return (Manila time)','datetime-local',fmtDateTimeInput(end),'required')+`<label class="field"><span class="field-label">Delivery arrangements</span><select class="select" name="deliveryMethod">${DELIVERY_METHODS.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select></label>`+opsInput('promoCode','Voucher code (optional)')+opsReason('reason','Booking notes / reason'),'Create request');
    }
    function saveFleetReservation(e){
        e.preventDefault(); if(!adminOnly())return;
        expireAndWaitlist();
        const f=e.target.elements,c=getCustomer(f.customerId.value),v=getVehicle(f.vehicleId.value),start=opsDate(f.start.value),end=opsDate(f.end.value),method=f.deliveryMethod.value,reason=f.reason.value.trim();
        if(!c||!v||!start||!end||Date.parse(start)<=Date.now()||Date.parse(end)<=Date.parse(start)||!DELIVERY_METHODS.includes(method)||!reason)return toast('Enter valid customer, dates and booking details.','error');
        const policy=bookingPolicy(c);if(policy)return toast(policy,'error');
        if(state.reservations.some(r=>r.customerId===c.id&&r.status==='completed'&&['unpaid','pending','rejected'].includes(overtimeStatus(r))))return toast('Customer has unsettled overtime.','error');
        const conflict=hasConflict(v.id,start,end);if(conflict.conflict)return toast(conflict.reason,'error');
        const q=quoteOps(v.id,start,end,method,f.promoCode.value);if(!q.valid||q.rental<=0)return toast('Invalid voucher or rental amount.','error');
        const r={id:uid('r'),vehicleId:v.id,customerId:c.id,customerName:c.name,customerEmail:c.email,start,end,actualReturn:null,status:'pending',totalFee:q.rental,overtimeFee:0,createdAt:nowISO(),approvedBy:null,rejectReason:'',adminNotes:reason,deliveryMethod:method,quote:{...q,dailyRate:v.ratePerDay},deposit:q.deposit>0?{amount:q.deposit,status:'unpaid'}:null};
        state.reservations.unshift(r);if(q.delivery>0)state.opsCharges.push(opCharge(r,'delivery',q.delivery,'Quoted host delivery / collection'));
        notify('customer','Reservation created',`An administrator created a pending request for ${v.name}.`,`#/customer/reservation/${r.id}`,c.id);
        opsDone('Reservations',r.id,'Reservation created from fleet schedule',reason);
    }
    function fleetCanCancel(r){return !!r&&['pending','approved'].includes(r.status)&&!['pending','verified'].includes(getPaymentByReservation(r.id)?.status)&&r.deposit?.status!=='held'&&!state.opsCharges.some(c=>c.reservationId===r.id&&c.paid>0)&&!r.refund;}
    function openFleetEvent(type,id){
        if(!adminOnly())return;
        const r=type==='reservation'?getReservation(id):state.opsServices.find(m=>m.id===id);if(!r)return;
        const v=getVehicle(r.vehicleId),isRental=type==='reservation';
        let actions='';
        if(isRental){
            actions+=`<a class="btn btn-primary" href="#/admin/reservation/${esc(r.id)}" onclick="App.closeModal()">Full reservation</a>`;
            if(r.status==='pending')actions+=opsBtn('Approve',`approveFleetReservation('${esc(id)}')`);
            if(['pending','approved'].includes(r.status)){
                actions+=opsBtn('Reschedule',`openRentalChange('${esc(id)}','reschedule')`)+opsBtn('Substitute motorcycle',`openRentalChange('${esc(id)}','substitution')`);
                if(fleetCanCancel(r))actions+=opsBtn('Cancel reservation',`openFleetCancel('${esc(id)}')`,'btn-danger');
                else if(canAssessRefund(r))actions+=opsBtn('Assess cancellation refund',`openAssessRefund('${esc(id)}')`,'btn-danger');
            }
            if(r.status==='ongoing')actions+=opsBtn('Extend rental',`openRentalChange('${esc(id)}','extension')`);
            const pending=state.opsChanges.find(c=>c.reservationId===id&&c.status==='pending');if(pending)actions+=opsBtn('Review pending change',`openReviewChange('${esc(pending.id)}')`,'btn-primary')+opsBtn('Reject change',`openRejectChange('${esc(pending.id)}')`);
        }else if(r.status==='scheduled')actions+=opsBtn('Edit service',`openFleetService('${esc(id)}')`,'btn-primary')+opsBtn('Complete service',`openFinishService('${esc(id)}')`)+opsBtn('Cancel service',`openFleetServiceCancel('${esc(id)}')`,'btn-danger');
        openModal(`<div class="modal"><div class="modal-header"><div class="modal-title">${isRental?'Reservation':'Scheduled service'} · ${esc(id.toUpperCase())}</div><button class="icon-btn" onclick="App.closeModal()" aria-label="Close">&times;</button></div><div class="modal-body stack"><h2>${esc(isRental?r.customerName:r.title)}</h2><div>${esc(vLabel(v))} · ${statusBadge(r.status)}</div><div class="kv"><div class="k">Start</div><div class="v">${fmtDate(r.start,{time:true})}</div><div class="k">End</div><div class="v">${fmtDate(r.end,{time:true})}</div>${isRental?`<div class="k">Rental fee</div><div class="v">${fmtPHP(r.totalFee)}</div><div class="k">Payment</div><div class="v">${statusBadge(getPaymentByReservation(id)?.status||'unpaid')}</div>`:''}</div><div class="btn-group">${actions||'<p class="small muted">No further actions.</p>'}</div>${isRental&&!fleetCanCancel(r)&&['pending','approved'].includes(r.status)?'<p class="small muted">Reservations with payment activity require financial review before cancellation. Use the full reservation or refund workflow.</p>':''}</div></div>`);
    }
    function approveFleetReservation(id){if(!adminOnly())return;approveReservation(id);if(getReservation(id)?.status==='approved')closeModal();}
    function openFleetCancel(id){if(adminOnly()&&fleetCanCancel(getReservation(id)))opsModal('Cancel reservation',`saveFleetCancel(event,'${esc(id)}')`,'<p class="callout danger small">Releases the booking window but retains the reservation in history.</p>'+opsReason(),'Cancel reservation');}
    function saveFleetCancel(e,id){e.preventDefault();const r=getReservation(id),reason=e.target.elements.reason.value.trim();if(!adminOnly()||!fleetCanCancel(r)||!reason)return toast('Cancellation requires a reason and no unsettled financial activity.','error');r.status='cancelled';r.cancelReason=reason;for(const c of state.opsChanges.filter(c=>c.reservationId===id&&c.status==='pending'))Object.assign(c,{status:'rejected',reviewReason:'Reservation cancelled',reviewedAt:nowISO()});notify('customer','Reservation cancelled',reason,`#/customer/reservation/${id}`,r.customerId);opsDone('Reservations',id,'Cancelled from fleet schedule',reason);}
    function openFleetService(id='',vehicleId='',key=''){
        if(!adminOnly())return;const m=id?state.opsServices.find(x=>x.id===id):null;if(id&&m?.status!=='scheduled')return;
        const start=m?.start||fleetDefaultDate(key),end=m?.end||new Date(Date.parse(start)+3600000).toISOString();
        opsModal(m?'Edit service window':'Schedule service',`saveFleetService(event,'${esc(id)}')`,fleetVehicleSelect(m?.vehicleId||vehicleId)+opsInput('title','Service description','text',m?.title||'','required maxlength="100"')+opsInput('start','Start (Manila time)','datetime-local',fmtDateTimeInput(start),'required')+opsInput('end','End (Manila time)','datetime-local',fmtDateTimeInput(end),'required')+opsReason('reason',m?'Reason for change':'Scheduling notes'),m?'Save changes':'Schedule service');
    }
    function saveFleetService(e,id){
        e.preventDefault();if(!adminOnly())return;const m=id?state.opsServices.find(x=>x.id===id):null;if(id&&m?.status!=='scheduled')return;
        const f=e.target.elements,vehicleId=f.vehicleId.value,title=f.title.value.trim(),start=opsDate(f.start.value),end=opsDate(f.end.value),reason=f.reason.value.trim();
        if(!getVehicle(vehicleId)||!title||!reason||!start||!end||Date.parse(start)<Date.now()||Date.parse(end)<=Date.parse(start))return toast('Enter a valid future service window and reason.','error');
        if(serviceConflict(vehicleId,start,end,id)||state.reservations.some(r=>r.vehicleId===vehicleId&&['approved','ongoing'].includes(r.status)&&(overlaps(start,end,r.start,r.end)||(r.status==='ongoing'&&Date.parse(r.end)<=Date.now()))))return toast('Service conflicts with a confirmed/overdue rental or another service.','error');
        const old=m?{vehicleId:m.vehicleId,title:m.title,start:m.start,end:m.end}:null;
        const record=m||{id:uid('svc'),status:'scheduled',createdAt:nowISO()};Object.assign(record,{vehicleId,title,start,end,updatedAt:nowISO(),scheduleNotes:reason});if(!m)state.opsServices.push(record);
        if(old)logActivity({module:'Maintenance',entityId:id,description:id,action:'Service schedule edited',changes:Object.keys(old).filter(k=>old[k]!==record[k]).map(k=>({field:k,previousValue:old[k],newValue:record[k]}))});
        opsDone('Maintenance',record.id,m?'Service rescheduled':'Service scheduled from fleet calendar',reason);
    }
    function openFleetServiceCancel(id){if(adminOnly()&&state.opsServices.some(m=>m.id===id&&m.status==='scheduled'))opsModal('Cancel scheduled service',`saveFleetServiceCancel(event,'${esc(id)}')`,'<p class="small muted">Release this service window and keep its history.</p>'+opsReason(),'Cancel service');}
    function saveFleetServiceCancel(e,id){e.preventDefault();const m=state.opsServices.find(x=>x.id===id),reason=e.target.elements.reason.value.trim();if(!adminOnly()||m?.status!=='scheduled'||!reason)return;m.status='cancelled';m.cancelReason=reason;m.cancelledAt=nowISO();opsDone('Maintenance',id,'Service cancelled from fleet calendar',reason);}
    function serviceConflict(vehicleId,start,end,exclude) {return state.opsServices.some(m=>m.id!==exclude&&m.vehicleId===vehicleId&&m.status==='scheduled'&&overlaps(start,end,m.start,m.end));}
    function maintenanceDue(v) {
        if(!v.servicePlan)return 'Not configured';
        const p=v.servicePlan, date=p.nextDate, km=p.nextKm;
        if((date&&date<=todayKey())||(km!=null&&Number(v.odometer||0)>=km))return 'Due';
        if((date&&Date.parse(date+'T00:00:00+08:00')-Date.now()<=7*OPS_DAY)||(km!=null&&km-Number(v.odometer||0)<=200))return 'Due soon';
        return 'Up to date';
    }
    function openServicePlan(id){const v=getVehicle(id);if(!adminOnly()||!v)return;const p=v.servicePlan||{};opsModal('Service plan',`saveServicePlan(event,'${id}')`,opsInput('odometer','Current odometer (km)','number',v.odometer??0,'min="0" step="1" required')+opsInput('nextDate','Next service date','date',p.nextDate||'','required')+opsInput('nextKm','Next service odometer (km)','number',p.nextKm??Number(v.odometer||0)+state.opsSettings.serviceKm,'min="0" step="1" required'));}
    function saveServicePlan(e,id){e.preventDefault();const v=getVehicle(id),f=e.target.elements;if(!adminOnly()||!v)return;const odo=Number(f.odometer.value),km=Number(f.nextKm.value);if(!Number.isFinite(odo)||odo<Number(v.odometer||0)||!Number.isFinite(km)||km<0||!f.nextDate.value)return toast('Check odometer and service date.','error');v.odometer=odo;v.servicePlan={nextDate:f.nextDate.value,nextKm:km};opsDone('Maintenance',id,'Service plan updated');}
    function openService(vehicleId = null){if(!adminOnly())return;opsModal('Schedule preventive service','saveService(event)',`<label class="field">Motorcycle<select class="select" name="vehicleId">${state.vehicles.map(v=>`<option value="${v.id}" ${v.id === vehicleId ? 'selected' : ''}>${esc(vLabel(v))}</option>`).join('')}</select></label>`+opsInput('title','Service description','text','','required maxlength="100"')+opsInput('start','Start (Manila time)','datetime-local','','required')+opsInput('end','End (Manila time)','datetime-local','','required'));}
    function saveService(e){e.preventDefault();if(!adminOnly())return;const f=e.target.elements,vehicleId=f.vehicleId.value,start=opsDate(f.start.value),end=opsDate(f.end.value),title=f.title.value.trim();if(!getVehicle(vehicleId)||!title||!start||!end||Date.parse(start)<Date.now()||Date.parse(end)<=Date.parse(start))return toast('Enter a valid future service window.','error');if(serviceConflict(vehicleId,start,end)||state.reservations.some(r=>r.vehicleId===vehicleId&&['approved','ongoing'].includes(r.status)&&(overlaps(start,end,r.start,r.end)||(r.status==='ongoing'&&Date.parse(r.end)<=Date.now()))))return toast('Service conflicts with a confirmed reservation or another service.','error');const m={id:uid('svc'),vehicleId,start,end,title,status:'scheduled',createdAt:nowISO()};state.opsServices.push(m);opsDone('Maintenance',m.id,'Service scheduled');}
    function openFinishService(id){const m=state.opsServices.find(x=>x.id===id);if(!adminOnly()||m?.status!=='scheduled')return;opsModal('Complete scheduled service',`finishService(event,'${id}')`,opsInput('odometer','Odometer (km)','number',getVehicle(m.vehicleId)?.odometer??0,'min="0" required')+opsInput('cost','Actual service cost (PHP)','number',0,'min="0" step="0.01" required')+opsReason('reason','Service notes'));}
    function finishService(e,id){e.preventDefault();const m=state.opsServices.find(x=>x.id===id),f=e.target.elements;if(!adminOnly()||m?.status!=='scheduled')return;const v=getVehicle(m.vehicleId),odo=Number(f.odometer.value),cost=Number(f.cost.value);if(!v||!Number.isFinite(odo)||odo<Number(v.odometer||0)||!Number.isFinite(cost)||cost<0||!f.reason.value.trim())return toast('Invalid service details.','error');m.status='completed';m.completedAt=nowISO();v.odometer=odo;v.servicePlan={nextDate:toManilaDateKey(new Date(Date.now()+state.opsSettings.serviceDays*OPS_DAY).toISOString()),nextKm:odo+state.opsSettings.serviceKm};state.maintenanceLogs.unshift({id:uid('m'),vehicleId:v.id,type:'maintenance',title:m.title,description:f.reason.value.trim(),status:'resolved',cost,reportedAt:m.start,resolvedAt:m.completedAt,damageLocation:'not_assessed',photos:[]});opsDone('Maintenance',id,'Scheduled service completed',f.reason.value.trim());}
    function cancelService(id){const m=state.opsServices.find(x=>x.id===id);if(!adminOnly()||m?.status!=='scheduled')return;openConfirm({title:'Cancel scheduled service',body:'Release this planned service window?',confirmLabel:'Cancel service',danger:true,onConfirm:()=>{if(!adminOnly()||m.status!=='scheduled')return;m.status='cancelled';opsDone('Maintenance',id,'Service cancelled');}});}
    function opsFinancePanel(r,admin) {
        const charges=state.opsCharges.filter(c=>c.reservationId===r.id), dep=r.deposit;
        const pending=r.status==='approved'&&r.paymentDeadline?`<div class="callout info small">Payment deadline: ${fmtDate(r.paymentDeadline,{time:true})}. Submitted payment proofs are held for review.</div>`:'';
        const rows=charges.map(c=>opsRow(esc(c.type),fmtPHP(c.amount),fmtPHP(c.paid),esc(c.status),admin&&c.status==='unpaid'&&['approved','ongoing','completed'].includes(r.status)&&getPaymentByReservation(r.id)?.status==='verified'?opsBtn('Record payment',`openChargePayment('${c.id}')`,'btn-sm'):'',`<span class="small muted">${esc(c.reason||'')}</span>`));
        return reservationPanel('Additional charges & deposit',`<div class="stack">${pending}${r.quote?`<div class="kv"><div class="k">Base rental</div><div class="v">${fmtPHP(r.quote.gross)}</div><div class="k">Voucher discount</div><div class="v">${fmtPHP(r.quote.discount)}</div><div class="k">Delivery / collection</div><div class="v">${fmtPHP(r.quote.delivery)}</div></div>`:''}
            ${dep?`<div class="callout small"><strong>Security deposit: ${fmtPHP(dep.amount)}</strong><div>Status: ${esc(dep.status)}${dep.status==='settled'?` · Returned ${fmtPHP(dep.returned)} · Applied to charges ${fmtPHP(dep.deducted)}`:''}</div></div>${admin&&dep.status==='unpaid'&&r.status==='approved'&&getPaymentByReservation(r.id)?.status==='verified'?opsBtn('Record deposit received',`openDeposit('${r.id}','receive')`):''}${admin&&dep.status==='held'&&['completed','cancelled','rejected'].includes(r.status)?opsBtn('Settle deposit',`openDeposit('${r.id}','settle')`):''}`:'<p class="muted small">No security deposit required.</p>'}
            ${admin&&r.status==='cancelled'&&charges.some(c=>c.type==='delivery'&&c.paid>0)?opsBtn('Return unused delivery payment',`openDeliveryRefund('${r.id}')`):''}${charges.length?opsTable(['Charge','Amount','Paid','Status','Action','Notes'],rows):'<p class="small muted">No additional charges.</p>'}
            ${admin&&['ongoing','completed'].includes(r.status)?opsBtn('Assess damage charge',`openDamage('${r.id}')`):''}
            ${admin||own(r)?opsBtn('View transaction receipts',`openReceipts('${r.id}')`):''}</div>`);
    }
    function openChargePayment(id){const c=state.opsCharges.find(x=>x.id===id),r=getReservation(c?.reservationId);if(!adminOnly()||c?.status!=='unpaid'||!r||!['approved','ongoing','completed'].includes(r.status)||getPaymentByReservation(r.id)?.status!=='verified')return;opsModal('Record externally received payment',`recordChargePayment(event,'${id}')`,`<div class="callout">Confirm payment externally before recording. Balance: ${fmtPHP(c.amount-c.paid)}</div>`+opsInput('amount','Amount received (PHP)','number',money(c.amount-c.paid),`min="0.01" max="${money(c.amount-c.paid)}" step="0.01" required`)+opsInput('reference','Payment reference or receipt','text','','required maxlength="100"'));}
    function recordChargePayment(e,id){e.preventDefault();const c=state.opsCharges.find(x=>x.id===id),r=getReservation(c?.reservationId),f=e.target.elements;if(!adminOnly()||c?.status!=='unpaid'||!r||!['approved','ongoing','completed'].includes(r.status)||getPaymentByReservation(r.id)?.status!=='verified')return;const amount=money(f.amount.value),ref=f.reference.value.trim();if(!Number.isFinite(amount)||amount<=0||amount>money(c.amount-c.paid)||!ref)return toast('Invalid payment or reference.','error');c.paid=money(c.paid+amount);c.transactions.push({amount,reference:ref,method:'External',date:nowISO()});if(c.paid===c.amount)c.status='paid';notify('customer','Additional payment recorded',`${fmtPHP(amount)} recorded for ${c.type}.`,`#/customer/reservation/${r.id}`,r.customerId);opsDone('Payments',id,'Additional payment recorded');}
    function openDamage(id){const r=getReservation(id);if(!adminOnly()||!r||!['ongoing','completed'].includes(r.status))return;opsModal('Assess customer damage charge',`saveDamage(event,'${id}')`,`<div class="callout warn small">Only charge documented customer-caused damage. Business-side mechanical defects are not customer liabilities. This is separate from repair expenditure.</div>`+opsInput('amount','Charge (PHP)','number','','min="0.01" step="0.01" required')+opsReason('reason','Evidence, responsibility and assessment notes'));}
    function saveDamage(e,id){e.preventDefault();const r=getReservation(id),f=e.target.elements;if(!adminOnly()||!r||!['ongoing','completed'].includes(r.status))return;const amount=money(f.amount.value),reason=f.reason.value.trim();if(!Number.isFinite(amount)||amount<=0||!reason)return toast('Enter an amount and justification.','error');const c=opCharge(r,'damage',amount,reason);state.opsCharges.push(c);notify('customer','Damage charge assessed',`${fmtPHP(amount)} assessed. View the reservation for details.`,`#/customer/reservation/${r.id}`,r.customerId);opsDone('Payments',c.id,'Damage charge assessed',reason);}
    function openDeposit(id,mode){const r=getReservation(id),d=r?.deposit;if(!adminOnly()||!d)return;if(mode==='receive'&&d.status==='unpaid'&&r.status==='approved'&&getPaymentByReservation(r.id)?.status==='verified')opsModal('Record deposit received',`saveDeposit(event,'${id}','receive')`,`<div class="callout">Confirm receipt of ${fmtPHP(d.amount)} outside V.E.R.A. This is a refundable liability, not revenue.</div>`+opsInput('reference','External receipt reference','text','','required maxlength="100"'));else if(mode==='settle'&&d.status==='held'&&['completed','cancelled','rejected'].includes(r.status)){const due=state.opsCharges.filter(c=>c.reservationId===id&&c.type==='damage'&&c.status==='unpaid').reduce((s,c)=>s+c.amount-c.paid,0);opsModal('Settle refundable deposit',`saveDeposit(event,'${id}','settle')`,`<div class="callout">Held: ${fmtPHP(d.amount)} · Outstanding damage charges: ${fmtPHP(due)}. Apply only documented damage charges. Transfer any remainder externally before confirming.</div>`+opsInput('deduct','Apply to damage charges (PHP)','number',0,`min="0" max="${Math.min(d.amount,due)}" step="0.01" required`)+opsInput('reference','External transfer or settlement reference','text','','required maxlength="100"')+opsReason());}}
    function saveDeposit(e,id,mode){e.preventDefault();const r=getReservation(id),d=r?.deposit,f=e.target.elements,ref=f.reference.value.trim();if(!adminOnly()||!d||!ref)return;if(mode==='receive'&&d.status==='unpaid'&&r.status==='approved'&&getPaymentByReservation(r.id)?.status==='verified'){Object.assign(d,{status:'held',receivedAt:nowISO(),receipt:ref});}else if(mode==='settle'&&d.status==='held'&&['completed','cancelled','rejected'].includes(r.status)){const due=state.opsCharges.filter(c=>c.reservationId===id&&c.type==='damage'&&c.status==='unpaid'),amount=money(f.deduct.value),max=money(Math.min(d.amount,due.reduce((s,c)=>s+c.amount-c.paid,0))),reason=f.reason.value.trim();if(!Number.isFinite(amount)||amount<0||amount>max||!reason)return toast('Invalid deduction or settlement reason.','error');let remaining=amount;for(const c of due){const part=money(Math.min(remaining,c.amount-c.paid));if(part>0){c.paid=money(c.paid+part);c.transactions.push({amount:part,method:'Deposit deduction',reference:ref,date:nowISO()});if(c.paid===c.amount)c.status='paid';remaining=money(remaining-part);}}Object.assign(d,{status:'settled',deducted:amount,returned:money(d.amount-amount),settledAt:nowISO(),settlementReference:ref,reason});}else return;notify('customer','Security deposit updated',`Deposit status: ${d.status}.`,`#/customer/reservation/${r.id}`,r.customerId);opsDone('Payments',id,'Deposit '+d.status);}
    function openReceipts(id){const r=getReservation(id);if(!accessible(r))return;const rows=state.payments.filter(p=>p.reservationId===id&&p.status==='verified').map(p=>opsRow(esc(p.paymentType||'rental'),fmtPHP(p.amount),esc(p.method),esc(p.id),fmtDate(p.verifiedAt||p.submittedAt,{time:true})));for(const c of state.opsCharges.filter(x=>x.reservationId===id))for(const t of c.transactions)rows.push(opsRow(esc(c.type),fmtPHP(t.amount),esc(t.method),esc(t.reference),fmtDate(t.date,{time:true})));if(r.deposit?.receivedAt)rows.push(opsRow('Deposit received',fmtPHP(r.deposit.amount),'External',esc(r.deposit.receipt),fmtDate(r.deposit.receivedAt,{time:true})));if(r.deposit?.settledAt)rows.push(opsRow('Deposit returned',fmtPHP(-r.deposit.returned),'External',esc(r.deposit.settlementReference),fmtDate(r.deposit.settledAt,{time:true})));if(refundDeducted(r))rows.push(opsRow('Refund',fmtPHP(-refundDeducted(r)),esc(r.refund.method||'External'),esc(r.refund.referenceNumber||'—'),fmtDate(r.refund.refundedAt,{time:true})));openModal(`<div class="modal ops-receipt"><div class="modal-header"><div class="modal-title">Transaction receipts · ${esc(r.id.toUpperCase())}</div><button class="icon-btn" onclick="App.closeModal()">&times;</button></div><div class="modal-body"><h2>V.E.R.A. transaction record</h2><p class="muted">${esc(r.customerName)} · ${esc(vLabel(getVehicle(r.vehicleId)))}</p><p class="small muted mb-3">Internal acknowledgment only; not an official tax invoice or proof of bank settlement.</p>${opsTable(['Type','Amount','Method','Reference','Date'],rows)}</div><div class="modal-footer">${opsBtn('Print / save PDF','printReceipts()','btn-primary')}</div></div>`);}
    function printReceipts(){if($('.ops-receipt'))window.print();}
    function opsPaymentLedger(){const rows=state.reservations.filter(r=>r.deposit||state.opsCharges.some(c=>c.reservationId===r.id)).map(r=>opsRow(rLink(r),esc(r.customerName),fmtPHP(outstandingOps(r)),r.deposit?`${fmtPHP(r.deposit.amount)} · ${esc(r.deposit.status)}`:'—',`<a class="btn btn-sm" href="#/admin/reservation/${r.id}">Manage</a>`));return reservationPanel('Additional charges & deposits',opsTable(['Reservation','Customer','Outstanding charges','Deposit',''],rows));}
    function opsChangesPanel(r,admin){const changes=state.opsChanges.filter(c=>c.reservationId===r.id),pending=changes.some(c=>c.status==='pending');let actions='';if(!pending&&(admin||own(r))){if(r.status==='ongoing')actions+=opsBtn('Request extension',`openRentalChange('${r.id}','extension')`);if(r.status==='approved'||r.status==='pending')actions+=opsBtn('Request reschedule',`openRentalChange('${r.id}','reschedule')`);}if(admin&&['pending','approved'].includes(r.status)&&!pending)actions+=opsBtn('Substitute motorcycle',`openRentalChange('${r.id}','substitution')`);return reservationPanel('Rental changes',`<div class="btn-group mb-2">${actions||'<span class="small muted">No new changes available.</span>'}</div>${changes.map(c=>`<div class="ops-entry"><strong>${esc(c.type)} · ${esc(c.status)}</strong><div class="small muted">${c.type==='substitution'?esc(vLabel(getVehicle(c.vehicleId))):`${fmtDate(c.start,{time:true})} – ${fmtDate(c.end,{time:true})}`}</div><div class="small">${esc(c.reason)}</div>${c.reviewReason?`<div class="small muted">Review: ${esc(c.reviewReason)}</div>`:''}${admin&&c.status==='pending'?`<div class="btn-group mt-2">${opsBtn('Review',`openReviewChange('${c.id}')`,'btn-sm btn-primary')}${opsBtn('Reject',`openRejectChange('${c.id}')`,'btn-sm btn-danger')}</div>`:''}</div>`).join('')||'<p class="muted small">No change requests.</p>'}`);}
    function changeAllowed(r,type){return !!r&&((type==='extension'&&r.status==='ongoing')||(['reschedule','substitution'].includes(type)&&['pending','approved'].includes(r.status)));}
    function openRentalChange(id,type){const r=getReservation(id);if(!accessible(r)||!changeAllowed(r,type)||(type==='substitution'&&!adminOnly())||state.opsChanges.some(c=>c.reservationId===id&&c.status==='pending'))return;let fields=type==='substitution'?`<label class="field">Replacement motorcycle<select class="select" name="vehicleId">${state.vehicles.filter(v=>v.id!==r.vehicleId).map(v=>`<option value="${v.id}">${esc(vLabel(v))} · ${fmtPHP(v.ratePerDay)}/day</option>`).join('')}</select></label>`:type==='extension'?opsInput('end','New return (Manila time)','datetime-local',fmtDateTimeInput(r.end),'required'):opsInput('start','New pickup (Manila time)','datetime-local',fmtDateTimeInput(r.start),'required')+opsInput('end','New return (Manila time)','datetime-local',fmtDateTimeInput(r.end),'required');opsModal(type==='extension'?'Rental extension':type==='reschedule'?'Reschedule rental':'Vehicle substitution',`requestRentalChange(event,'${id}','${type}')`,fields+opsReason(), 'Submit request');}
    function validateChange(r,c){if(!changeAllowed(r,c.type))return 'Reservation is no longer eligible.';if(!c.start||!c.end||!getVehicle(c.vehicleId)||Date.parse(c.end)<=Date.parse(c.start))return 'Invalid vehicle or dates.';if(c.type==='extension'){if(!licenseEligible(getCustomer(r.customerId),{...r,end:c.end}))return 'License must cover extended rental period.';if(c.vehicleId!==r.vehicleId||c.start!==r.start||Date.parse(c.end)<=Math.max(Date.now(),Date.parse(r.end)))return 'New return must be later than the existing return and now.';}else if(Date.parse(c.start)<=Date.now())return 'New pickup must be in the future.';if(r.status==='approved'&&!licenseEligible(getCustomer(r.customerId),{...r,end:c.end}))return 'License must cover changed rental period.';if(c.type==='substitution'&&c.vehicleId===r.vehicleId)return 'Choose a different motorcycle.';const conflict=hasConflict(c.vehicleId,c.type==='extension'?r.end:c.start,c.end,r.id);if(conflict.conflict)return conflict.reason;return '';}
    function changeCost(r,c){if(c.type==='extension'){const oldDays=Math.ceil((Date.parse(r.end)-Date.parse(r.start))/OPS_DAY),newDays=Math.ceil((Date.parse(c.end)-Date.parse(r.start))/OPS_DAY);return money(Math.max(0,newDays-oldDays)*(r.quote?.dailyRate||getVehicle(r.vehicleId).ratePerDay));}const gross=computeFee(c.vehicleId,c.start,c.end).total,discount=r.quote?.gross?money(gross*r.quote.discount/r.quote.gross):0;return money(gross-discount);}
    function requestRentalChange(e,id,type){e.preventDefault();const r=getReservation(id),f=e.target.elements;if(!accessible(r)||!changeAllowed(r,type)||(type==='substitution'&&!adminOnly())||state.opsChanges.some(c=>c.reservationId===id&&c.status==='pending'))return;const c={id:uid('chg'),reservationId:id,type,vehicleId:type==='substitution'?f.vehicleId.value:r.vehicleId,start:type==='reschedule'?opsDate(f.start.value):r.start,end:type==='substitution'?r.end:opsDate(f.end.value),reason:f.reason.value.trim(),status:'pending',createdAt:nowISO()};const error=validateChange(r,c);if(error||!c.reason)return toast(error||'Provide a reason.','error');state.opsChanges.push(c);notify('admin','Rental change requested',`${r.id.toUpperCase()} · ${type}`,'#/admin/reservation/'+id);opsDone('Reservations',c.id,'Change requested',c.reason);}
    function openReviewChange(id){const c=state.opsChanges.find(x=>x.id===id),r=getReservation(c?.reservationId);if(!adminOnly()||c?.status!=='pending'||!r)return;const error=validateChange(r,c);if(error)return toast(error,'error');const cost=changeCost(r,c);const payment=getPaymentByReservation(r.id);if(c.type!=='extension'&&['pending','verified'].includes(payment?.status)&&cost!==r.totalFee)return toast('Paid or submitted reservations may only be changed at the same rental price. Resolve the existing payment/refund separately.','error');opsModal('Approve '+c.type,`reviewChange(event,'${id}',true)`,`<div class="callout">${c.type==='extension'?`Additional rental: ${fmtPHP(cost)}. Collect externally before approving.`:`New rental price: ${fmtPHP(cost)}.`}</div>`+(c.type==='extension'&&cost>0?opsInput('reference','Confirmed extension payment reference','text','','required maxlength="100"'):'')+opsReason('reason','Approval notes'), 'Approve');}
    function openRejectChange(id){const c=state.opsChanges.find(x=>x.id===id);if(adminOnly()&&c?.status==='pending')opsModal('Reject rental change',`reviewChange(event,'${id}',false)`,opsReason(),'Reject');}
    function reviewChange(e,id,approved){e.preventDefault();const c=state.opsChanges.find(x=>x.id===id),r=getReservation(c?.reservationId),f=e.target.elements,reason=f.reason.value.trim();if(!adminOnly()||c?.status!=='pending'||!r||!reason)return;if(approved){const error=validateChange(r,c);if(error)return toast(error,'error');const cost=changeCost(r,c),p=getPaymentByReservation(r.id);if(c.type==='extension'){const ref=f.reference?.value.trim();if(cost>0&&!ref)return toast('Verify extension payment externally and record the reference.','error');if(cost>0){const ch=opCharge(r,'extension',cost,c.reason);ch.paid=cost;ch.status='paid';ch.transactions.push({amount:cost,reference:ref,method:'External',date:nowISO()});state.opsCharges.push(ch);}r.end=c.end;}else{if(['pending','verified'].includes(p?.status)&&cost!==r.totalFee)return toast('Payment amount would change. Resolve existing payment first.','error');r.vehicleId=c.vehicleId;r.start=c.start;r.end=c.end;r.totalFee=cost;if(r.quote){const gross=computeFee(c.vehicleId,c.start,c.end).total;Object.assign(r.quote,{gross,discount:money(gross-cost),rental:cost,dailyRate:getVehicle(c.vehicleId).ratePerDay});}if(r.status==='approved'&&!['pending','verified'].includes(p?.status))r.paymentDeadline=new Date(Math.min(Date.parse(r.start),Date.now()+state.opsSettings.paymentHours*3600000)).toISOString();}}
        Object.assign(c,{status:approved?'approved':'rejected',reviewReason:reason,reviewedAt:nowISO()});notify('customer',`Rental change ${c.status}`,`${c.type} · ${reason}`,`#/customer/reservation/${r.id}`,r.customerId);opsDone('Reservations',id,'Change '+c.status,reason);}
    function openWaitlist(vehicleId){if(state.role!=='customer'||!getVehicle(vehicleId))return;opsModal('Join availability waitlist',`joinWaitlist(event,'${vehicleId}')`,`<p class="muted small">Get an in-app notification if the selected time becomes available. A waitlist is not a reservation or a guarantee.</p>`+opsInput('start','Desired pickup (Manila time)','datetime-local','','required')+opsInput('end','Desired return (Manila time)','datetime-local','','required'));}
    function joinWaitlist(e,id){e.preventDefault();const f=e.target.elements,c=currentCustomer(),start=opsDate(f.start.value),end=opsDate(f.end.value);if(state.role!=='customer'||!c||!getVehicle(id)||!start||!end||Date.parse(start)<=Date.now()||Date.parse(end)<=Date.parse(start))return toast('Enter valid future dates.','error');if(!hasConflict(id,start,end).conflict)return toast('These dates are available. Submit a reservation instead.','info');if(state.opsWaitlist.some(w=>w.customerId===c.id&&w.vehicleId===id&&w.start===start&&w.end===end&&w.status==='waiting'))return toast('You are already on this waitlist.','info');const w={id:uid('wait'),vehicleId:id,customerId:c.id,start,end,status:'waiting',createdAt:nowISO()};state.opsWaitlist.push(w);opsDone('Reservations',w.id,'Joined waitlist');}
    function cancelWaitlist(id){const w=state.opsWaitlist.find(x=>x.id===id);if(!w||w.status!=='waiting'||!(adminOnly()||state.role==='customer'&&w.customerId===currentCustomer()?.id))return;w.status='cancelled';opsDone('Reservations',id,'Waitlist cancelled');}
    function waitlistPanel(admin=false){const ws=state.opsWaitlist.filter(w=>admin||w.customerId===currentCustomer()?.id);return reservationPanel('Availability waitlist',opsTable(['Motorcycle','Pickup','Return','Status',''],ws.map(w=>opsRow(esc(vLabel(getVehicle(w.vehicleId))),fmtDate(w.start,{time:true}),fmtDate(w.end,{time:true}),esc(w.status),w.status==='waiting'?opsBtn('Remove',`cancelWaitlist('${w.id}')`,'btn-sm'):`${!admin&&w.status==='notified'?`<a href="#/customer/vehicle/${w.vehicleId}">View vehicle</a>`:''}`))));}
    function openCustomerRestriction(id){const c=getCustomer(id);if(!adminOnly()||!c)return;opsModal(c.restriction?.active?'Lift customer restriction':'Restrict customer',`saveCustomerRestriction(event,'${id}')`,`<div class="callout warn">${c.restriction?.active?`Current reason: ${esc(c.restriction.reason)}`:'New rental requests and releases are blocked until the restriction is lifted.'}</div>`+opsReason());}
    function saveCustomerRestriction(e,id){e.preventDefault();const c=getCustomer(id),reason=e.target.elements.reason.value.trim();if(!adminOnly()||!c||!reason)return;c.restriction={active:!c.restriction?.active,reason,updatedAt:nowISO()};notify('customer',c.restriction.active?'Account restricted':'Account restriction lifted',reason,'#/customer/account',id);opsDone('Customers',id,'Restriction '+(c.restriction.active?'applied':'lifted'),reason);}
    function openLicenseEligibility(id){const c=getCustomer(id);if(!adminOnly()||!c)return;opsModal('Review motorcycle license eligibility',`saveLicenseEligibility(event,'${id}')`,`<p class="small muted">Administrator must check the original license, validity, motorcycle authorization and any limitations. No automated legal eligibility determination.</p>`+opsInput('codes','Observed license code(s) / limitations','text',c.licenseEligibility?.codes||'','required maxlength="100"')+`<label class="field">Motorcycle authorization<select class="select" name="eligible"><option value="yes" ${c.licenseEligibility?.eligible?'selected':''}>Confirmed</option><option value="no" ${!c.licenseEligibility?.eligible?'selected':''}>Not confirmed</option></select></label>`+opsReason('reason','Review notes'));}
    function saveLicenseEligibility(e,id){e.preventDefault();const c=getCustomer(id),f=e.target.elements;if(!adminOnly()||!c||!f.codes.value.trim()||!f.reason.value.trim())return;if(f.eligible.value==='yes'&&(identityStatus(c)!=='verified'||!identityComplete(c.identification)))return toast('Verify identity and a current license before confirming authorization.','error');c.licenseEligibility={codes:f.codes.value.trim(),eligible:f.eligible.value==='yes',notes:f.reason.value.trim(),reviewedAt:nowISO(),licenseNumber:c.identification?.licenseNumber,expiry:c.identification?.licenseExpiry};opsDone('Customers',id,'License authorization reviewed');}
    function licenseEligible(c,r){return !!c&&identityStatus(c)==='verified'&&identityComplete(c.identification)&&c.licenseEligibility?.eligible&&c.licenseEligibility.licenseNumber===c.identification.licenseNumber&&c.licenseEligibility.expiry===c.identification.licenseExpiry&&c.identification.licenseExpiry>=toManilaDateKey(r.end);}
    function feedbackPanel(r,admin){if(r.status!=='completed')return '';const f=state.opsFeedback.find(x=>x.reservationId===r.id);return reservationPanel('Rental feedback',f?`<strong>${esc(f.rating)}/5</strong><p>${esc(f.comment)}</p><p class="muted small">${fmtDateShort(f.createdAt)}</p>`:admin?'<p class="muted small">No feedback submitted.</p>':opsBtn('Rate your rental',`openFeedback('${r.id}')`));}
    function openFeedback(id){const r=getReservation(id);if(!own(r)||r.status!=='completed'||state.opsFeedback.some(f=>f.reservationId===id))return;opsModal('Rate your rental',`saveFeedback(event,'${id}')`,`<label class="field">Rating<select class="select" name="rating">${[5,4,3,2,1].map(n=>`<option value="${n}">${n} / 5</option>`).join('')}</select></label>`+opsReason('reason','Feedback'));}
    function saveFeedback(e,id){e.preventDefault();const r=getReservation(id),f=e.target.elements,rating=Number(f.rating.value),comment=f.reason.value.trim();if(!own(r)||r.status!=='completed'||!Number.isInteger(rating)||rating<1||rating>5||!comment||state.opsFeedback.some(x=>x.reservationId===id))return;state.opsFeedback.push({id:uid('fb'),reservationId:id,vehicleId:r.vehicleId,customerId:r.customerId,rating,comment,createdAt:nowISO()});opsDone('Customers',id,'Feedback submitted');}
    function operationalPeriod(range){const today=todayKey(),y=Number(today.slice(0,4)),m=Number(today.slice(5,7)),now=Date.now();let start=Date.UTC(y,m-1,1)-8*3600000,end=Math.min(now,Date.UTC(y,m,1)-8*3600000);if(range==='last'){start=Date.UTC(y,m-2,1)-8*3600000;end=Date.UTC(y,m-1,1)-8*3600000;}if(range==='all'){const starts=[...state.reservations.map(r=>Date.parse(r.createdAt)),...state.maintenanceLogs.map(m=>Date.parse(m.reportedAt)),...state.payments.map(p=>Date.parse(p.submittedAt))].filter(Number.isFinite);start=Math.min(now-OPS_DAY,...starts);end=now;}return {start,end};}
    function operationalStats(range='month'){
        const {start,end}=operationalPeriod(range),within=d=>{const n=Date.parse(d);return Number.isFinite(n)&&n>=start&&n<end;},hours=(a,b)=>Math.max(0,(Math.min(end,Date.parse(b))-Math.max(start,Date.parse(a)))/3600000)||0;
        const unionHours=intervals=>{const sorted=intervals.map(([a,b])=>[Math.max(start,Date.parse(a)),Math.min(end,Date.parse(b))]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);let total=0,last=null;for(const [a,b] of sorted){if(last&&a<=last[1])last[1]=Math.max(last[1],b);else{if(last)total+=last[1]-last[0];last=[a,b];}}if(last)total+=last[1]-last[0];return total/3600000;};
        const created=state.reservations.filter(r=>within(r.createdAt)),done=state.reservations.filter(r=>r.status==='completed'&&within(r.actualReturn||r.end));
        const periodHours=Math.max(1,(end-start)/3600000);
        const perVehicle=state.vehicles.map(v=>{
            const rs=state.reservations.filter(r=>r.vehicleId===v.id),ps=state.payments.filter(p=>p.status==='verified'&&within(p.verifiedAt||p.submittedAt)&&rs.some(r=>r.id===p.reservationId));
            const cs=state.opsCharges.filter(c=>rs.some(r=>r.id===c.reservationId));
            const extra=cs.reduce((s,c)=>s+c.transactions.filter(t=>within(t.date)).reduce((a,t)=>a+t.amount,0),0);
            const refunds=rs.reduce((s,r)=>s+(within(r.refund?.refundedAt)?refundDeducted(r):0),0);
            const gross=ps.reduce((s,p)=>s+Number(p.amount||0),0)+extra;
            const serviceCost=state.maintenanceLogs.filter(m=>m.vehicleId===v.id&&m.status==='resolved'&&within(m.resolvedAt||m.reportedAt)).reduce((s,m)=>s+Number(m.cost||0),0);
            const booked=unionHours(rs.filter(r=>['ongoing','completed'].includes(r.status)).map(r=>[r.start,r.status==='completed'?(r.actualReturn||r.end):new Date().toISOString()]));
            const downtime=unionHours([...state.maintenanceLogs.filter(m=>m.vehicleId===v.id).map(m=>[m.reportedAt,m.resolvedAt||new Date().toISOString()]),...state.opsServices.filter(m=>m.vehicleId===v.id&&m.status!=='cancelled').map(m=>[m.start,m.completedAt||m.end])]);
            return {v,gross,refunds,net:gross-refunds,serviceCost,contribution:gross-refunds-serviceCost,util:Math.min(100,booked/periodHours*100),downtime,estimatedLost:downtime/24*v.ratePerDay};
        });
        const sum=k=>perVehicle.reduce((s,v)=>s+v[k],0),customers=new Set(done.map(r=>r.customerId)),repeat=[...customers].filter(id=>state.reservations.filter(r=>r.customerId===id&&r.status==='completed'&&Date.parse(r.actualReturn||r.end)<end).length>1).length;
        const demand=Array.from({length:7},(_,i)=>({label:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i],count:created.filter(r=>new Date(Date.parse(r.start)+8*3600000).getUTCDay()===i).length}));
        const months={};for(const r of created){const k=toManilaDateKey(r.start).slice(0,7);months[k]=(months[k]||0)+1;}
        return {perVehicle,created,done,demand,months,gross:sum('gross'),refunds:sum('refunds'),net:sum('net'),serviceCost:sum('serviceCost'),contribution:sum('contribution'),util:perVehicle.length?sum('util')/perVehicle.length:0,lost:sum('estimatedLost'),cancelRate:created.length?100*created.filter(r=>r.status==='cancelled').length/created.length:0,avgHours:done.length?done.reduce((s,r)=>s+Math.max(0,Date.parse(r.actualReturn||r.end)-Date.parse(r.start))/3600000,0)/done.length:0,lateRate:done.length?100*done.filter(r=>Date.parse(r.actualReturn)>Date.parse(r.end)).length/done.length:0,repeatRate:customers.size?repeat/customers.size*100:0,feedback:state.opsFeedback.filter(f=>within(f.createdAt))};
    }
    function billedRentalPanel(completed) {
        const perVehicle = state.vehicles.map(v => ({
            v,
            val: completed.filter(r => r.vehicleId === v.id).reduce((sum, r) =>
                sum + r.totalFee + (r.overtimeFee || 0) - refundDeducted(r), 0)
        })).filter(x => x.val > 0).sort((a, b) => b.val - a.val);
        const max = Math.max(1, ...perVehicle.map(x => x.val));
        const bars = perVehicle.map(x => `<div class="bar-row">
            <div class="bar-label"><span>${esc(vLabel(x.v))}</span><span>${fmtPHP(x.val)}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${(x.val / max * 100).toFixed(1)}%"></div></div>
        </div>`).join('');
        return reservationPanel('Billed rental value by vehicle',
            '<p class="small muted mb-3">Completed rentals in the selected period, including overtime and less recorded disbursed refunds. Billed values are not necessarily collected receipts.</p>' +
            (bars || '<p class="small muted">No completed rental earnings recorded in this period.</p>'));
    }

    function enhancedReports(){if(!adminOnly())return;const range=state.ui.reportRange||'month',s=operationalStats(range),max=Math.max(1,...s.demand.map(x=>x.count));const bars=s.demand.map(x=>`<div class="bar-row"><div class="bar-label"><span>${x.label}</span><span>${x.count}</span></div><div class="bar-track"><div class="bar-fill" style="width:${x.count/max*100}%"></div></div></div>`).join('');mount(`<div class="page-header"><div><h1 class="page-title">Reports</h1><p class="page-desc">Verified cash flows, rental activity and fleet performance.</p></div><select class="select" aria-label="Reporting period" onchange="App.setUI('reportRange',this.value);App.render()">${[['month','This month'],['last','Last month'],['all','All recorded history']].map(([k,l])=>`<option value="${k}" ${range===k?'selected':''}>${l}</option>`).join('')}</select></div><div class="metrics mb-3">${opsMetric('Verified payments (net delivery reversals)',fmtPHP(s.gross))}${opsMetric('Rental refunds paid',fmtPHP(s.refunds))}${opsMetric('Net receipts',fmtPHP(s.net))}${opsMetric('Recorded maintenance cost',fmtPHP(s.serviceCost))}${opsMetric('Contribution after maintenance',fmtPHP(s.contribution))}${opsMetric('Fleet utilization',s.util.toFixed(1)+'%')}${opsMetric('Average completed rental',(s.avgHours/24).toFixed(1)+' days')}${opsMetric('Cancellation rate',s.cancelRate.toFixed(1)+'%')}${opsMetric('Late return frequency',s.lateRate.toFixed(1)+'%')}${opsMetric('Repeat renter share',s.repeatRate.toFixed(1)+'%')}${opsMetric('Potential downtime revenue',fmtPHP(Math.round(s.lost)))}${opsMetric('Average feedback',s.feedback.length?(s.feedback.reduce((a,b)=>a+b.rating,0)/s.feedback.length).toFixed(1)+'/5':'—')}</div><div class="stack">${billedRentalPanel(s.done)}${reservationPanel('Vehicle performance',opsTable(['Vehicle','Net receipts','Maintenance cost','Contribution','Utilization','Downtime hours'],s.perVehicle.map(x=>opsRow(esc(vLabel(x.v)),fmtPHP(x.net),fmtPHP(x.serviceCost),fmtPHP(x.contribution),x.util.toFixed(1)+'%',x.downtime.toFixed(1)))))}<div class="grid-2">${reservationPanel('Demand by pickup weekday',bars)}${reservationPanel('Demand by pickup month',opsTable(['Month','Requests created in reporting period'],Object.entries(s.months).sort().map(([k,v])=>opsRow(esc(k),v))))}</div>${reservationPanel('Reservation activity',opsTable(['Status','Requests created in period'],['pending','approved','ongoing','completed','cancelled','rejected'].map(k=>opsRow(esc(k),s.created.filter(r=>r.status===k).length))))}${reservationPanel('Customer feedback',opsTable(['Reservation','Motorcycle','Rating','Comment'],s.feedback.map(f=>opsRow(esc(f.reservationId),esc(vLabel(getVehicle(f.vehicleId))),`${f.rating}/5`,esc(f.comment)))))}<p class="small muted">Contribution is not net profit: excludes acquisition, tax, financing, insurance and other overhead. Deposit liabilities are excluded except amounts applied to documented charges. Utilization uses elapsed rental time, clipped to the reporting period; downtime value assumes full-rate demand and is an estimate, not proven lost revenue. Seed payments without verification timestamps use submission dates. Repeat renter share is a proxy, not cohort retention.</p></div>`);}
    function dashboardAttention(overdue) {
        const pending = state.payments.filter(p => p.status === 'pending');
        const due = state.vehicles.filter(v => ['Due', 'Due soon'].includes(maintenanceDue(v)));
        const alerts = [
            ...overdue.map(r => opsRow('Overdue return', esc(vLabel(getVehicle(r.vehicleId))), rLink(r))),
            ...due.map(v => opsRow('Maintenance ' + maintenanceDue(v).toLowerCase(), esc(vLabel(v)), '<a href="#/admin/maintenance">Review</a>')),
            ...pending.map(p => opsRow('Payment pending', esc(p.reservationId), '<a href="#/admin/payments">Review</a>')),
            ...state.opsChanges.filter(c => c.status === 'pending').map(c => opsRow('Rental change pending', esc(c.type), rLink(getReservation(c.reservationId))))
        ];
        return reservationPanel('Requires attention', opsTable(['Alert', 'Record', 'Action'], alerts));
    }

    function opsCustomerControls(){return reservationPanel('Customer restrictions & license eligibility',opsTable(['Customer','Restriction','License authorization','Actions'],state.customers.map(c=>opsRow(esc(c.name),esc(c.restriction?.active?c.restriction.reason:'None'),esc(c.licenseEligibility?.eligible?'Manually confirmed':'Not confirmed'),`<div class="btn-group">${opsBtn(c.restriction?.active?'Lift restriction':'Restrict',`openCustomerRestriction('${c.id}')`,'btn-sm')}${opsBtn('Review license',`openLicenseEligibility('${c.id}')`,'btn-sm')}</div>`))));}
    function appendOps(html){const root=$('#appRoot');if(root)root.insertAdjacentHTML('beforeend',`<div class="mt-3 stack">${html}</div>`);}
    function adminChangesSummary(){return reservationPanel('Pending rental changes',opsTable(['Reservation','Type','Reason',''],state.opsChanges.filter(c=>c.status==='pending').map(c=>opsRow(rLink(getReservation(c.reservationId)),esc(c.type),esc(c.reason),opsBtn('Review',`openReviewChange('${c.id}')`,'btn-sm btn-primary')+' '+opsBtn('Reject',`openRejectChange('${c.id}')`,'btn-sm')))));}

    function openDeliveryRefund(id){const r=getReservation(id),c=state.opsCharges.find(x=>x.reservationId===id&&x.type==='delivery'&&x.paid>0);if(!adminOnly()||r?.status!=='cancelled'||!c)return;opsModal('Return delivery payment',`saveDeliveryRefund(event,'${id}')`,`<div class="callout">Return ${fmtPHP(c.paid)} externally, then record the transfer.</div>`+opsInput('reference','Transfer reference','text','','required')+opsReason());}
    function saveDeliveryRefund(e,id){e.preventDefault();const r=getReservation(id),c=state.opsCharges.find(x=>x.reservationId===id&&x.type==='delivery'&&x.paid>0),f=e.target.elements;if(!adminOnly()||r?.status!=='cancelled'||!c||!f.reference.value.trim()||!f.reason.value.trim())return;c.transactions.push({amount:-c.paid,reference:f.reference.value.trim(),method:'Delivery refund',date:nowISO()});c.paid=0;c.status='refunded';notify('customer','Delivery payment returned','Your delivery fee refund has been recorded.',`#/customer/reservation/${id}`,r.customerId);opsDone('Payments',c.id,'Delivery refund',f.reason.value.trim());}

    // ---------- Audit trail (no document contents) ----------
    const auditFields = {
        vehicles: ['name','brand','model','year','plateNumber','displacement','ratePerDay','ratePerHour','status','color','seats','transmission','odometer'],
        reservations: ['vehicleId','customerId','start','end','actualReturn','status','totalFee','overtimeFee','deliveryMethod','approvedBy','rejectReason','cancelReason','adminNotes','paymentDeadline','expiredAt'],
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
        if (!['admin','customer'].includes(actorRole)) return;
        state.activityLogs.unshift({id:uid('act'), actorRole, actorId:actorRole === 'admin' ? 'demo-admin' : actorId, actorName:actorRole === 'admin' ? 'Admin' : `Customer (${actorId})`, createdAt:new Date().toISOString(), ...entry});
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
        persistOps();
    }
    function filteredActivity() {
        const q = (state.ui.auditQuery || '').toLowerCase();
        return state.activityLogs.filter(l => (!state.ui.auditModule || l.module === state.ui.auditModule) && (!state.ui.auditDate || toManilaDateKey(l.createdAt) === state.ui.auditDate) && (!state.ui.auditAction || l.action === state.ui.auditAction) && `${l.module} ${l.action} ${l.entityId} ${l.description} ${l.actorName}`.toLowerCase().includes(q));
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
        saveOpsSettings, backupOps, setSchedule, openFleetCreate, openFleetReservation, saveFleetReservation, openFleetEvent, approveFleetReservation, openFleetCancel, saveFleetCancel, openFleetService, saveFleetService, openFleetServiceCancel, saveFleetServiceCancel, openService, saveService, openServicePlan, saveServicePlan, openFinishService, finishService, cancelService,
        openChargePayment, recordChargePayment, openDamage, saveDamage, openDeposit, saveDeposit, openReceipts, printReceipts, openDeliveryRefund, saveDeliveryRefund,
        openRentalChange, requestRentalChange, openReviewChange, openRejectChange, reviewChange, openWaitlist, joinWaitlist, cancelWaitlist, openCustomerRestriction, saveCustomerRestriction, openLicenseEligibility, saveLicenseEligibility, openFeedback, saveFeedback,
        quoteOps, operationalStats, expireAndWaitlist,
        filterActivity, viewActivity, exportActivity,
        loginAs, switchRole, goHome, setUI, searchVehicles, render, toggleNotifications, closeNotifications, markAllRead, markNotifRead,
        updateFeePreview, submitReservation, confirmCancelReservation, submitCancelReservation, customerCancel,
        previewProof, submitPayment,
        approveReservation, rejectReservation, openRejectReservationModal, submitRejectReservation,
        startRental, openCompleteModal, completeRental, updateOvertimePreview, openOvertimePayment, submitOvertimePayment,
        openPaymentModal, verifyPayment, rejectPayment, openRejectPaymentModal, submitRejectPayment, switchVehicleSlide,
        openVehicleModal, saveVehicle, setVehicleStatus, changeVehicleStatus, submitVehicleCondition,
        openMaintenanceModal, openMaintenanceHistory, saveMaintenance, viewMaintenance, addMaintenancePhotos, removeMaintenancePhoto, resolveLog, openResolveLogModal, submitResolveLog,
        saveAdminNotes, openCustomerModal, editCustomerIdentity, saveCustomerIdentity, reviewCustomerIdentity, closeModal, _confirm: null,
        // Exposed for automated tests and inspection (no UI behavior change)
        DELIVERY_METHODS, getDeliveryMethod, overlaps, computeFee, computeOvertime, computeEarlyRefund, hasConflict, openRefundSelection, openAssessRefund, assessRefund, openRefundModal, recordRefund, acknowledgeRefund
    };
    document.addEventListener('click', (e) => {
        const dd = $('#notifDropdown'), btn = $('#notifBtn');
        if (state.ui.notifOpen && dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
            state.ui.notifOpen = false;
            renderChrome();
        }
    });
    window.addEventListener('hashchange', route);
    window.setInterval(()=>{if(expireAndWaitlist()){captureActivity();renderChrome();if(!$('#modalRoot')?.children.length)route();}},30000);
    window.addEventListener('pagehide',persistOps);
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