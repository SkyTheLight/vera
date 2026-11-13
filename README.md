# V.E.R.A. — Vehicle Enterprise Rental Assistant (UI Prototype)

A **clickable, mobile-responsive UI prototype** for a thesis project: a web-based rental management system for a car and motorcycle rental business.

> **Prototype only:** no real authentication, database, payments, or backend. All data is in-memory seed data (resets on refresh). Role selection is stored locally for convenience.

## Tech stack
- **Single-page app:** `index.html`, `styles.css`, `data.js`, `app.js`
- **Self-contained CSS design system** in `styles.css` (no CSS framework/build step)
- **Vanilla JavaScript** (no React, no jQuery, no build step, no package dependencies)
- **Hash-based routing** (e.g. `#/customer/vehicles`, `#/admin/dashboard`)
- Google Fonts (Inter) with system-font fallback; no external image assets

## How to run

### Option A — Double-click (file://)
1. Open the folder `C:\Users\Skyth\Documents\vera\`
2. Double-click `index.html` to open it in your browser.
3. Core functionality and styling work offline (fonts fall back to system fonts if unavailable).

### Option B — Local web server
```powershell
cd C:\Users\Skyth\Documents\vera
python -m http.server 8765
```
Then open [http://localhost:8765/](http://localhost:8765/).

### Option C — Deploy to Vercel (static)
1. Push this folder to a Git repo, or drag-and-drop the folder in Vercel.
2. Framework preset: **Other** (static). No build command, output directory: project root.
3. Open the deployed URL.

## Demo script (~3 minutes)
1. **Customer — request a rental**
   - On landing, click **Continue as Customer**.
   - Go to **Vehicles** → open a vehicle (e.g. Toyota Vios).
   - View the **availability calendar** and the **"How overlap prevention works"** callout.
   - Pick start/end dates and click **Request Reservation** (status becomes *Pending*).
2. **Admin — approve request**
   - Use the role switcher (top right) → **Admin**.
   - Open **Reservations** (Pending tab) → **Approve** the request.
3. **Customer — upload payment proof**
   - Switch to **Customer** → **My Rentals**.
   - On the approved reservation, click **Upload payment proof** (GCash/Other, image preview). Submit → *Pending Confirmation*.
4. **Admin — verify, start, complete**
   - Switch to **Admin** → **Payments** → **Verify** the proof.
   - Go to **Reservations** (Approved) → **Start rental** (vehicle becomes *Rented*, status *Ongoing*).
   - Go to **Ongoing** → **Complete rental**, enter actual return time (overtime auto-computed).
5. **Show updates**
   - Check **Notifications** (bell) and **Reports** for updated earnings/utilization.
6. **Bonus — overlap prevention**
   - As Customer, try to book the same vehicle for dates overlapping an *approved/ongoing* rental → conflict message shown and booking blocked.

## Roles & main screens
- **Customer:** Landing/Login, Browse Vehicles, Vehicle Detail (calendar + overlap explainer + fee preview), My Reservations, Reservation Detail, Upload Payment Proof, Notifications, Profile/Rental History.
- **Admin:** Dashboard, Manage Vehicles, Reservation Requests, Reservation Detail, Payments to Verify, Maintenance & Incident Log, Reports, Customers.

## Notes
- **Overlap rule (simulated):** conflict if `newStart < existingEnd && newEnd > existingStart` for reservations with status `approved` or `ongoing` (and blocked if vehicle status is `maintenance` or `malfunction`).
- **Fee calculation:** `days = ceil((end-start)/1 day)` (minimum 1), `total = days × ratePerDay`; on completion `overtimeFee = ceil((actualReturn-end)/1 hour) × ratePerHour` (if returned late).
- **Status transitions:** `pending → approved|rejected|cancelled`, `approved → ongoing|cancelled`, `ongoing → completed`.
- Role preference is stored in `localStorage` (`vera_role`); all other state resets on refresh.
- Payments are made outside the system; the prototype supports proof upload (local preview) and manual administrator verification only. No real personal or payment data is transmitted or stored on a server.
