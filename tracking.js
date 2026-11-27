// V.E.R.A. Vehicle Tracking (simulated v1; real tracker plugs into addPing)
(function () {
  'use strict';

  const App = window.App = window.App || {};
  const state = window.VERA_STATE;
  if (!state || !App) return;

  state.locationPings = Array.isArray(state.locationPings) ? state.locationPings : [];
  state.ui = state.ui || {};
  state.ui.tracking = state.ui.tracking || { simulatorOn: false, filter: 'all', selectedVehicleId: null };

  const DEMO_LABEL = 'Demo data (simulated)';
  const NO_SIGNAL_MS = 15 * 60 * 1000;
  const SIM_INTERVAL_MS = 5000;
  // Santo Domingo, Cainta, Rizal area waypoints (approximate)
  const WAYPOINTS = [
    [14.5889, 121.0970],
    [14.5925, 121.1035],
    [14.5960, 121.1100],
    [14.5905, 121.1165],
    [14.5840, 121.1120],
    [14.5800, 121.1050],
    [14.5835, 121.0990]
  ];

  let simTimer = null;
  let map = null;
  let markersLayer = null;
  const markersByVehicle = new Map();
  let pendingMapElement = null;
  let mapResizeObs = null;
  let leafletPromise = null;
  let simProgress = {}; // vehicleId -> {seg, t}

  const LEAFLET_SOURCES = [
    { css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' },
    { css: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', js: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js' },
    { css: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css', js: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js' }
  ];

  function loadStylesheet(href) {
    return new Promise((resolve) => {
      const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(l => (l.href||'').includes('leaflet'));
      if (existing) { resolve(); return; }
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href; link.setAttribute('data-vera-leaflet','1');
      link.onload = () => resolve(); link.onerror = () => resolve();
      document.head.appendChild(link);
    });
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true; s.setAttribute('data-vera-leaflet','1');
      s.onload = () => window.L ? resolve(window.L) : reject(new Error('Leaflet loaded but window.L missing'));
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  function ensureLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = (async () => {
      let lastErr;
      for (const src of LEAFLET_SOURCES) {
        try {
          await loadStylesheet(src.css);
          const L = await loadScript(src.js);
          if (L && L.map) return L;
        } catch (e) { lastErr = e; console.warn('[Tracking] Leaflet source failed', src.js, e); }
      }
      leafletPromise = null;
      throw lastErr || new Error('Leaflet failed to load');
    })();
    return leafletPromise;
  }
  function preloadLeaflet() { if (state.role === 'admin') ensureLeaflet().catch(() => {}); }

  function nowISO() { return new Date().toISOString(); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
  function esc(s) {
    if (App.esc) return App.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDateShort(iso) { return App.fmtDateShort ? App.fmtDateShort(iso) : (iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '-'); }
  function fmtDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
  }

  function getVehicle(id) { return App.getVehicle ? App.getVehicle(id) : (state.vehicles || []).find(v => v.id === id); }
  function getReservation(id) { return App.getReservation ? App.getReservation(id) : (state.reservations || []).find(r => r.id === id); }
  function getCustomer(id) { return App.getCustomer ? App.getCustomer(id) : (state.customers || []).find(c => c.id === id); }

  function isOverdue(reservation, at = new Date()) {
    if (!reservation || reservation.status !== 'ongoing' || !reservation.end) return false;
    const end = new Date(reservation.end);
    const now = at instanceof Date ? at : new Date(at);
    return Number.isFinite(end.getTime()) && Number.isFinite(now.getTime()) && now.getTime() > end.getTime();
  }

  function latestPing(vehicleId, reservationId) {
    const pings = (state.locationPings || []).filter(p => p && p.vehicleId === vehicleId && (!reservationId || p.reservationId === reservationId));
    pings.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    return pings[0] || null;
  }

  function isNoSignal(vehicleId, reservationId, at = new Date()) {
    const ping = latestPing(vehicleId, reservationId);
    if (!ping || !ping.recordedAt) return true;
    const t = new Date(ping.recordedAt).getTime();
    const now = (at instanceof Date ? at : new Date(at)).getTime();
    if (!Number.isFinite(t) || !Number.isFinite(now)) return true;
    return (now - t) > NO_SIGNAL_MS;
  }

  function inRentalPeriod(ping, reservation) {
    if (!ping || !reservation) return false;
    const t = new Date(ping.recordedAt).getTime();
    const start = new Date(reservation.start).getTime();
    // allow pings during ongoing rental; completion clears, but also guard by end+grace? Spec: never show/keep outside rental period
    const end = reservation.actualReturn ? new Date(reservation.actualReturn).getTime() : Infinity;
    return Number.isFinite(t) && Number.isFinite(start) && t >= start && t <= end;
  }

  function clearPingsForReservation(reservationId) {
    if (!reservationId) return 0;
    const before = state.locationPings.length;
    state.locationPings = state.locationPings.filter(p => p.reservationId !== reservationId);
    return before - state.locationPings.length;
  }

  function addPing(ping) {
    try {
      const p = ping || {};
      const vehicleId = String(p.vehicleId || '');
      const reservationId = String(p.reservationId || '');
      const lat = num(p.lat);
      const lng = num(p.lng);
      const speedKph = p.speedKph == null || p.speedKph === '' ? 0 : num(p.speedKph);
      const recordedAt = p.recordedAt ? new Date(p.recordedAt).toISOString() : nowISO();
      const source = p.source === 'tracker' ? 'tracker' : 'simulator';

      const vehicle = getVehicle(vehicleId);
      const reservation = getReservation(reservationId);
      if (!vehicle) return { ok: false, reason: 'Vehicle not found' };
      if (!reservation) return { ok: false, reason: 'Reservation not found' };
      if (reservation.vehicleId !== vehicleId) return { ok: false, reason: 'Reservation/vehicle mismatch' };
      if (reservation.status !== 'ongoing') return { ok: false, reason: 'Pings allowed only for ongoing reservations' };
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, reason: 'Invalid latitude' };
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, reason: 'Invalid longitude' };
      if (!Number.isFinite(speedKph) || speedKph < 0 || speedKph > 300) return { ok: false, reason: 'Invalid speed' };
      const recTime = new Date(recordedAt).getTime();
      if (!Number.isFinite(recTime)) return { ok: false, reason: 'Invalid recordedAt' };
      if (!inRentalPeriod({ recordedAt }, reservation)) return { ok: false, reason: 'Ping outside rental period' };

      const normalized = {
        id: App.uid ? App.uid('ping') : ('ping_' + Math.random().toString(36).slice(2, 10)),
        vehicleId, reservationId, lat, lng, speedKph, recordedAt, source
      };
      state.locationPings.push(normalized);
      // keep last 200 per vehicle to avoid unbounded growth
      const byVehicle = state.locationPings.filter(x => x.vehicleId === vehicleId);
      if (byVehicle.length > 200) {
        const removeIds = new Set(byVehicle.sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt)).slice(0, byVehicle.length - 200).map(x=>x.id));
        state.locationPings = state.locationPings.filter(x => !removeIds.has(x.id));
      }
      if (vehicle.tracker) vehicle.tracker.lastSeenAt = recordedAt;
      return { ok: true, ping: normalized };
    } catch (e) {
      console.error('addPing error', e);
      return { ok: false, reason: 'Invalid ping' };
    }
  }

  function getTrackedVehicles(filter = 'all', at = new Date()) {
    const ongoing = (state.reservations || []).filter(r => r && r.status === 'ongoing');
    const rows = ongoing.map(r => {
      const v = getVehicle(r.vehicleId) || { id: r.vehicleId, name: r.vehicleId, model: '', plateNumber: '' };
      const c = getCustomer(r.customerId) || { name: r.customerName || 'Unknown renter' };
      const ping = latestPing(r.vehicleId, r.id);
      const noSignal = isNoSignal(r.vehicleId, r.id, at);
      const overdue = isOverdue(r, at);
      return {
        vehicle: v, reservation: r, customer: c, ping, noSignal, overdue,
        lastUpdate: ping ? ping.recordedAt : null
      };
    }).filter(row => {
      if (filter === 'overdue') return row.overdue;
      if (filter === 'returns') {
        const end = new Date(row.reservation.end);
        const date = new Date(at);
        if (!row.reservation.end || !Number.isFinite(end.getTime()) || !Number.isFinite(date.getTime())) return false;
        const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
        return day.format(end) === day.format(date);
      }
      return true;
    }).sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.noSignal !== b.noSignal) return a.noSignal ? 1 : -1;
      return String(a.vehicle.name || '').localeCompare(String(b.vehicle.name || ''));
    });
    return rows;
  }

  // ---------- Simulator ----------
  function randomJitter() { return (Math.random() - 0.5) * 0.0007; }
  function stepSimulator() {
    const ongoing = (state.reservations || []).filter(r => r.status === 'ongoing');
    for (const r of ongoing) {
      const v = getVehicle(r.vehicleId);
      if (v?.tracker && v.tracker.enabled === false) continue;
      const prog = simProgress[r.vehicleId] || { seg: Math.floor(Math.random() * WAYPOINTS.length), t: Math.random() };
      prog.t += 0.08 + Math.random() * 0.06;
      if (prog.t >= 1) { prog.t = 0; prog.seg = (prog.seg + 1) % WAYPOINTS.length; }
      simProgress[r.vehicleId] = prog;
      const a = WAYPOINTS[prog.seg];
      const b = WAYPOINTS[(prog.seg + 1) % WAYPOINTS.length];
      const lat = a[0] + (b[0] - a[0]) * prog.t + randomJitter();
      const lng = a[1] + (b[1] - a[1]) * prog.t + randomJitter();
      addPing({ vehicleId: r.vehicleId, reservationId: r.id, lat, lng, speedKph: Math.round(15 + Math.random() * 35), recordedAt: nowISO(), source: 'simulator' });
    }
  }

  function stopSimulator() {
    if (simTimer) { clearInterval(simTimer); simTimer = null; }
    state.ui.tracking.simulatorOn = false;
  }
  function startSimulator() {
    stopSimulator();
    state.ui.tracking.simulatorOn = true;
    stepSimulator();
    simTimer = setInterval(() => {
      try {
        if (!state.ui.tracking.simulatorOn) return stopSimulator();
        if (location.hash !== '#/admin/map') return; // only while on map
        stepSimulator();
        renderMapPage(true);
      } catch (e) { console.error('Simulator error', e); }
    }, SIM_INTERVAL_MS);
  }
  function toggleSimulator(on) {
    if (on) startSimulator(); else stopSimulator();
    renderMapPage(true);
  }

  // ---------- UI ----------
  function ensureStyles() {
    if (document.getElementById('trackingStyles')) return;
    const style = document.createElement('style');
    style.id = 'trackingStyles';
    style.textContent = `
      .tracking-row { padding:12px 14px; border-bottom:1px solid var(--border,#25292f); cursor:pointer; }
      .tracking-row:hover { background: rgba(255,255,255,0.02); }
      .tracking-row.selected { outline:1px solid rgba(122,162,255,0.45); background: rgba(122,162,255,0.08); }
      .tracking-row.nosignal { opacity:0.65; }
      .tracking-meta { display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap:6px 12px; margin-top:8px; font-size:12px; }
      .tracking-badges { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
      .badge-overdue { background: rgba(255,92,92,0.15); color:#ff8a8a; border:1px solid rgba(255,92,92,0.35); padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }
      .badge-nosignal { background: rgba(239,68,68,0.14); color:#fca5a5; border:1px solid rgba(239,68,68,0.35); padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; }
      .badge-demo { background: rgba(122,162,255,0.12); color:#9fc0ff; border:1px solid rgba(122,162,255,0.3); padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }
      .tracking-filters { display:flex; gap:8px; flex-wrap:wrap; }
      .leaflet-container { background:#111418; font-family: inherit; }
      .tracking-popup { font-size:12px; line-height:1.45; color:#111827; }
      .tracking-popup .muted { color:#4b5563; }
    `;
    document.head.appendChild(style);
  }

  function mount(html) { if (App.mount) return App.mount(html); const root = document.getElementById('appRoot'); if (root) root.innerHTML = html; }

  function onMapRoute() { return state.role === 'admin' && location.hash === '#/admin/map'; }

  // A single matching overdue/returning rental is the automatic focus target.
  function singleFocusTarget(filter, rows) {
    return ['overdue', 'returns'].includes(filter) && rows.length === 1 ? rows[0] : null;
  }

  function renderMapPage(preserveMap = true) {
    ensureStyles();
    if (!onMapRoute()) return;
    const filter = state.ui.tracking.filter || 'all';
    const rows = getTrackedVehicles(filter);
    const existingMap = document.getElementById('trackingMap');
    if (!existingMap) {
      const target = singleFocusTarget(filter, rows);
      if (target) state.ui.tracking.selectedVehicleId = target.vehicle.id;
    }
    const selected = state.ui.tracking.selectedVehicleId;
    const simOn = !!state.ui.tracking.simulatorOn;
    const collapsed = !!state.ui.tracking.panelCollapsed;
    const listHtml = rows.length ? rows.map(row => rowHtml(row, selected)).join('') : `<div class="empty"><div class="empty-title">${filter === 'returns' ? 'No rentals awaiting return today' : filter === 'overdue' ? 'No overdue rentals' : 'No ongoing rentals'}</div><div class="small muted">Matching rentals appear here.</div></div>`;
    if (existingMap && (pendingMapElement === existingMap || map?.getContainer() === existingMap)) {
      const list = document.getElementById('trackingList');
      const scroll = list?.scrollTop || 0;
      const count = document.getElementById('trackingCount');
      const badge = document.getElementById('trackingDemoBadge');
      if (count) count.textContent = String(rows.length);
      const title = document.getElementById('trackingListTitle');
      if (title) title.textContent = filter === 'returns' ? 'Returns today' : filter === 'overdue' ? 'Overdue rentals' : 'Ongoing rentals';
      if (badge) badge.hidden = !simOn;
      if (list) { list.innerHTML = listHtml; list.scrollTop = scroll; }
      for (const button of document.querySelectorAll('#trackingWorkspace [data-tracking-filter]')) {
        const active = button.dataset.trackingFilter === filter;
        button.classList.toggle('btn-primary', active);
        button.setAttribute('aria-pressed', String(active));
      }
      const simulator = document.getElementById('trackingSimulator');
      if (simulator) simulator.checked = simOn;
      if (map?.getContainer() === existingMap) syncMarkers(rows, false);
      return;
    }
    destroyMap();
    mount(`
      <section id="trackingWorkspace" class="tracking-workspace" aria-label="Live map workspace">
        <div id="trackingMap" class="tracking-map" role="region" aria-label="Rented vehicle map"><div class="empty tracking-load"><div class="empty-title">Loading map…</div><div class="small muted">Fetching map library and tiles.</div></div></div>
        <div class="tracking-toolbar" aria-label="Map filters">
          <div class="tracking-filters">
            <button type="button" class="btn btn-sm ${filter==='all'?'btn-primary':''}" data-tracking-filter="all" aria-pressed="${filter==='all'}" onclick="App.Tracking.setFilter('all')">All rented</button>
            <button type="button" class="btn btn-sm ${filter==='overdue'?'btn-primary':''}" data-tracking-filter="overdue" aria-pressed="${filter==='overdue'}" onclick="App.Tracking.setFilter('overdue')">Overdue</button>
            <button type="button" class="btn btn-sm ${filter==='returns'?'btn-primary':''}" data-tracking-filter="returns" aria-pressed="${filter==='returns'}" onclick="App.Tracking.setFilter('returns')">Returns today</button>
          </div>
          <button type="button" class="btn btn-sm" onclick="App.Tracking.fitVisible()">Fit map</button>
        </div>
        <aside id="trackingOverlay" class="tracking-overlay panel ${collapsed?'tracking-collapsed':''}" aria-label="Ongoing rentals">
          <div class="panel-header tracking-overlay-header"><div><h1 id="trackingListTitle" class="panel-title">${filter==='returns'?'Returns today':filter==='overdue'?'Overdue rentals':'Ongoing rentals'}</h1><div class="small muted"><span id="trackingCount">${rows.length}</span> vehicle(s)</div></div><button id="trackingPanelToggle" class="btn btn-sm" type="button" aria-expanded="${!collapsed}" aria-controls="trackingOverlayContent" onclick="App.Tracking.togglePanel()">${collapsed?'Show':'Hide'}</button></div>
          <div id="trackingOverlayContent" class="tracking-overlay-content">
            <div class="tracking-simulator"><label><input id="trackingSimulator" type="checkbox" ${simOn?'checked':''} onchange="App.Tracking.toggleSimulator(this.checked)"> Demo simulator</label><span id="trackingDemoBadge" class="badge-demo" ${simOn?'':'hidden'}>Running</span></div>
            <div id="trackingList" class="tracking-list panel-body flush">${listHtml}</div>
          </div>
        </aside>
        <div class="tracking-map-legend" aria-label="Marker legend"><span><i style="background:#22c55e"></i> Ongoing</span><span><i style="background:#ef4444"></i> Overdue</span><span><i style="background:#94a3b8"></i> No signal</span><span class="tracking-demo-note">${DEMO_LABEL}</span></div>
      </section>
    `);
    const el = document.getElementById('trackingMap');
    pendingMapElement = el;
    ensureLeaflet().then(() => {
      if (!onMapRoute() || pendingMapElement !== el || document.getElementById('trackingMap') !== el) return;
      pendingMapElement = null;
      initMap(getTrackedVehicles(state.ui.tracking.filter));
    }).catch(e => {
      console.error(e);
      if (pendingMapElement === el) pendingMapElement = null;
      if (onMapRoute() && document.getElementById('trackingMap') === el) el.innerHTML = '<div class="empty tracking-load"><div class="empty-title">Map unavailable</div><div class="small muted">Check internet/CDN access. The rental list remains available.</div><button class="btn mt-2" onclick="App.Tracking.renderMapPage(false)">Retry</button></div>';
    });
  }

  function togglePanel() {
    state.ui.tracking.panelCollapsed = !state.ui.tracking.panelCollapsed;
    const collapsed = state.ui.tracking.panelCollapsed;
    document.getElementById('trackingOverlay')?.classList.toggle('tracking-collapsed', collapsed);
    const button = document.getElementById('trackingPanelToggle');
    if (button) { button.textContent = collapsed ? 'Show' : 'Hide'; button.setAttribute('aria-expanded', String(!collapsed)); }
    requestAnimationFrame(fitVisible);
  }

  function destroyMap() {
    pendingMapElement = null;
    if (mapResizeObs) { mapResizeObs.disconnect(); mapResizeObs = null; }
    if (map) { try { map.remove(); } catch (_) {} }
    map = null; markersLayer = null; markersByVehicle.clear();
  }

  function mapPadding() {
    const el = document.getElementById('trackingMap');
    const panel = document.getElementById('trackingOverlay');
    const toolbar = document.querySelector('#trackingWorkspace .tracking-toolbar');
    const size = el?.getBoundingClientRect();
    const overlay = panel?.getBoundingClientRect();
    if (!size || !overlay) return { padding: [30,30] };
    const top = Math.min(100, (toolbar?.offsetHeight || 36) + 32);
    if (window.matchMedia('(max-width: 767.98px)').matches || size.width < 640) {
      return { paddingTopLeft:[28,top], paddingBottomRight:[28,Math.min(size.height*.55,overlay.height+45)] };
    }
    return { paddingTopLeft:[30,top], paddingBottomRight:[Math.min(size.width*.48,overlay.width+32),70] };
  }

  function fitVisible() {
    if (!map || !onMapRoute()) return;
    const bounds = getTrackedVehicles(state.ui.tracking.filter).filter(row => row.ping).map(row => [row.ping.lat,row.ping.lng]);
    if (bounds.length) { try { map.fitBounds(bounds, {...mapPadding(), maxZoom:15}); } catch (_) {} }
  }

  function rowHtml(row, selected) {
    const v = row.vehicle, r = row.reservation, c = row.customer;
    const overdueBadge = row.overdue ? `<span class="badge-overdue">OVERDUE</span>` : '';
    const signalBadge = row.noSignal ? `<span class="badge-nosignal">URGENT MISSING</span>` : `<span class="badge" style="background:rgba(52,211,153,.12);color:#86efac;border:1px solid rgba(52,211,153,.25);padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">Live</span>`;
    return `
      <div class="tracking-row ${row.noSignal ? 'nosignal' : ''} ${selected === v.id ? 'selected' : ''}" onclick="App.Tracking.selectVehicle('${esc(v.id)}')">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div>
            <div style="font-weight:600">${esc(v.name || 'Vehicle')} <span class="muted small">${esc(v.model || '')}</span></div>
            <div class="small muted">Plate: ${esc(v.plateNumber || '-')} • Renter: ${esc(c.name || r.customerName || '-')}</div>
          </div>
          <div class="tracking-row-actions"><button type="button" class="btn btn-sm" ${row.ping?'':'disabled'} onclick="event.stopPropagation(); App.Tracking.selectVehicle('${esc(v.id)}')">Focus</button><a class="btn btn-sm" href="#/admin/reservation/${esc(r.id)}" onclick="event.stopPropagation()">Open</a></div>
        </div>
        <div class="tracking-badges">${overdueBadge}${signalBadge}</div>
        <div class="tracking-meta">
          <div><span class="muted">Reservation</span><div>${esc(String(r.id).toUpperCase())}</div></div>
          <div><span class="muted">Last update</span><div>${esc(fmtDateTime(row.lastUpdate))}</div></div>
          <div><span class="muted">Start</span><div>${esc(fmtDateTime(r.start))}</div></div>
          <div><span class="muted">Expected return</span><div>${esc(fmtDateTime(r.end))}</div></div>
        </div>
      </div>`;
  }

  function initMap(rows) {
    const el = document.getElementById('trackingMap');
    if (!el || !window.L) {
      if (el) el.innerHTML = '<div class="empty" style="height:100%"><div class="empty-title">Map unavailable</div><div class="small muted">Leaflet failed to load. Check internet/CDN access. The list still shows tracked rentals.</div></div>';
      return;
    }
    if (map) { try { map.remove(); } catch (_) {} map = null; markersLayer = null; markersByVehicle.clear(); }
    if (mapResizeObs) { try { mapResizeObs.disconnect(); } catch (_) {} mapResizeObs = null; }
    el.innerHTML = '';
    map = window.L.map(el, { zoomControl: false, preferCanvas: true }).setView([14.5889, 121.1065], 14);
    window.L.control.zoom({position:'bottomleft'}).addTo(map);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      updateWhenIdle: true,
      keepBuffer: 2
    }).addTo(map);
    markersLayer = window.L.layerGroup().addTo(map);
    syncMarkers(rows, false);
    const currentMap = map;
    requestAnimationFrame(() => {
      if (map !== currentMap || !onMapRoute()) return;
      try {
        map.invalidateSize();
        const filter = state.ui.tracking.filter;
        const target = singleFocusTarget(filter, getTrackedVehicles(filter));
        if (target) state.ui.tracking.selectedVehicleId = target.vehicle.id;
        if (target?.ping && markersByVehicle.has(target.vehicle.id)) selectVehicle(target.vehicle.id);
        else fitVisible();
      } catch (e) { console.error('[Tracking] Initial map focus failed', e); }
    });
    setTimeout(() => { if (map !== currentMap) return; try { map.invalidateSize(); } catch (_) {} }, 250);
    if (window.ResizeObserver) {
      mapResizeObs = new ResizeObserver(() => { try { map && map.invalidateSize(); } catch (_) {} });
      mapResizeObs.observe(el);
    }
  }

  function syncMarkers(rows, fit = false) {
    if (!map || !window.L) return;
    if (!markersLayer) markersLayer = window.L.layerGroup().addTo(map);
    const keep = new Set();
    rows.forEach(row => {
      if (!row.ping) return;
      const {lat,lng} = row.ping;
      const v = row.vehicle, r = row.reservation, c = row.customer;
      const key = v.id;
      keep.add(key);
      const color = row.noSignal ? '#94a3b8' : (row.overdue ? '#ef4444' : '#22c55e');
      const makeIcon = () => window.L.divIcon({className:'',html:`<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 2px rgba(0,0,0,.25)"></div>`,iconSize:[16,16],iconAnchor:[8,8]});
      const content = `<div class="tracking-popup"><strong>${esc(v.name||'')}</strong> ${esc(v.model||'')}<br><span class="muted">Plate:</span> ${esc(v.plateNumber||'-')}<br><span class="muted">Renter:</span> ${esc(c.name||r.customerName||'-')}<br><span class="muted">Reservation:</span> ${esc(String(r.id).toUpperCase())}<br><span class="muted">Start:</span> ${esc(fmtDateTime(r.start))}<br><span class="muted">Expected return:</span> ${esc(fmtDateTime(r.end))}<br>${row.overdue?'<strong style="color:#dc2626">OVERDUE</strong><br>':''}<span class="muted">Last update:</span> ${esc(fmtDateTime(row.lastUpdate))}<br><a href="#/admin/reservation/${esc(r.id)}">Open reservation</a><br><span class="muted">${DEMO_LABEL}</span></div>`;
      let entry = markersByVehicle.get(key);
      if (!entry) {
        const marker = window.L.marker([lat,lng],{icon:makeIcon()}).addTo(markersLayer);
        marker.bindPopup(content);
        marker.on('click', () => selectVehicle(key,false));
        entry = {marker,color,content}; markersByVehicle.set(key,entry);
      } else {
        entry.marker.setLatLng([lat,lng]);
        if (entry.color !== color) { entry.marker.setIcon(makeIcon()); entry.color = color; }
        if (entry.content !== content) { entry.marker.setPopupContent(content); entry.content = content; }
      }
    });
    for (const [key,entry] of markersByVehicle) if (!keep.has(key)) { markersLayer.removeLayer(entry.marker); markersByVehicle.delete(key); }
    if (fit) fitVisible();
  }

  function selectVehicle(vehicleId, pan = true) {
    if (!onMapRoute()) return;
    state.ui.tracking.selectedVehicleId = vehicleId;
    const row = getTrackedVehicles(state.ui.tracking.filter).find(r => r.vehicle.id === vehicleId);
    renderMapPage(true);
    if (pan && row?.ping && map) {
      try {
        const zoom = Math.max(map.getZoom(),15);
        const opts = mapPadding();
        const left = opts.paddingTopLeft || opts.padding || [30,30];
        const right = opts.paddingBottomRight || opts.padding || [30,30];
        const point = map.project([row.ping.lat,row.ping.lng],zoom);
        const center = map.unproject(point.add([(right[0]-left[0])/2,(right[1]-left[1])/2]),zoom);
        map.setView(center,zoom);
        markersByVehicle.get(vehicleId)?.marker.openPopup();
      } catch (_) {}
    }
  }

  function setFilter(filter) {
    if (!onMapRoute()) return;
    state.ui.tracking.filter = ['overdue','returns'].includes(filter) ? filter : 'all';
    const rows = getTrackedVehicles(state.ui.tracking.filter);
    if (!rows.some(r => r.vehicle.id === state.ui.tracking.selectedVehicleId)) state.ui.tracking.selectedVehicleId = null;
    const target = singleFocusTarget(state.ui.tracking.filter, rows);
    if (target) state.ui.tracking.selectedVehicleId = target.vehicle.id;
    renderMapPage(true);
    if (target?.ping && map && markersByVehicle.has(target.vehicle.id)) selectVehicle(target.vehicle.id);
    else fitVisible();
  }

  // ---------- Hooks / integration ----------
  function onRender() {
    // clear pings for completed/cancelled/rejected? spec: clear when reservation completes
    (state.reservations || []).forEach(r => {
      if (r.status === 'completed' || r.status === 'cancelled' || r.status === 'rejected') {
        if ((state.locationPings || []).some(p => p.reservationId === r.id)) clearPingsForReservation(r.id);
      }
    });
    // stop simulator if leaving map
    if (!onMapRoute()) { stopSimulator(); destroyMap(); }
  }

  // Wrap App.render to enforce cleanup
  const origRender = App.render;
  if (typeof origRender === 'function') {
    App.render = function () {
      try { onRender(); } catch (e) { console.error(e); }
      return origRender.apply(this, arguments);
    };
  }

  // Expose API
  App.Tracking = {
    addPing, getTrackedVehicles, isOverdue, isNoSignal, clearPingsForReservation,
    renderMapPage, toggleSimulator, setFilter, selectVehicle, togglePanel, fitVisible, ensureLeaflet, preloadLeaflet,
    _state: state.ui.tracking, _stopSimulator: stopSimulator, _DEMO_LABEL: DEMO_LABEL
  };
  window.Tracking = App.Tracking;

  // Also expose pure helpers directly on App for tests/spec
  App.addPing = addPing;
  App.getTrackedVehicles = getTrackedVehicles;
  App.isOverdue = isOverdue;
  App.isNoSignal = isNoSignal;

  // route hook: if hash is admin/map, render it (app.js will also be patched; this is fallback)
  window.addEventListener('hashchange', () => {
    try { onRender(); if (onMapRoute() && !document.getElementById('trackingWorkspace')) renderMapPage(false); } catch (e) { console.error(e); }
  });
})();




