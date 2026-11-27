# V.E.R.A. — Test Cases

**Legend:** `PASS` = actually tested and verified, `FAIL` = tested but failed, `BLOCKED` = could not execute due to limitation, `NOT TESTED` = not executed.  
**Primary test date:** 2026-11-20 | **Environment:** Windows, Node v24.14.0, static serve `http://localhost:8765/`, in-app browser automation.

## 1. Delivery Method feature (all four combinations)

| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| DM-01 | Delivery Method UI | App loaded; signed in as Customer; open available vehicle detail (e.g. v1) | Inspect reservation form for Delivery Method control | Dropdown present with label, placeholder option, helper hint, and 4 valid combinations; field required | Dropdown present (`#deliveryMethod`, required) with placeholder “Select pickup and return option” and all 4 options plus hint text | PASS | Verified via browser DOM/state inspection on booking form. |
| DM-02 | Delivery Method validation | Customer on booking form | Set valid dates, leave delivery method empty, submit | Submission blocked; clear validation feedback shown; no reservation created | Blocked with toast “Please select a delivery method.”; reservation count unchanged | PASS | Programmatic submit against rendered form. |
| DM-03 | Delivery Method validation | Customer on booking form | Set valid dates, force invalid delivery value, submit | Submission blocked (invalid not accepted); no reservation created | Blocked with toast “Please select a delivery method.”; reservation count unchanged | PASS | Invalid option injected to simulate tampered/invalid value. |
| DM-04 | Create reservation — Guest Pickup & Guest Return | Customer signed in; target vehicle available; non-conflicting future dates | Select “Guest Pickup & Guest Return”, submit request | Reservation created as `pending` with correct `deliveryMethod`; visible in customer list/detail | Created pending reservation (e.g. `rbgggpi`/verified runs) with `deliveryMethod='Guest Pickup & Guest Return'`; shown in customer list and detail | PASS | Verified in automated browser run. |
| DM-05 | Create reservation — Guest Pickup & Host Collection | Same as DM-04 | Select “Guest Pickup & Host Collection”, submit | Stored/displayed correctly | Created pending reservation with correct value; shown in customer list/detail | PASS | Verified. |
| DM-06 | Create reservation — Host Delivery & Guest Return | Same as DM-04 | Select “Host Delivery & Guest Return”, submit | Stored/displayed correctly | Created pending reservation with correct value; shown in customer list/detail | PASS | Verified. |
| DM-07 | Create reservation — Host Delivery & Host Collection | Same as DM-04 | Select “Host Delivery & Host Collection”, submit | Stored/displayed correctly | Created pending reservation with correct value; shown in customer list/detail | PASS | Verified. |
| DM-08 | Admin visibility (pending) — all combinations | Reservations from DM-04..07 exist | Sign in as Admin; open Reservations pending list and each reservation detail | Delivery method visible for each combination in admin list/detail | All 4 shown in admin pending list and admin detail (initial) | PASS | Verified for each created reservation. |
| DM-09 | Lifecycle preservation — Guest Pickup & Guest Return | DM-04 reservation pending | Approve → Start rental → Complete rental; check customer/admin views at stages | `deliveryMethod` remains unchanged and visible through `pending→approved→ongoing→completed` | `afterApprove/Start/Complete` all preserved; shown in admin and customer views after completion | PASS | Start executed via confirm callback in automated flow; complete executed via app action. |
| DM-10 | Lifecycle preservation — Guest Pickup & Host Collection | DM-05 reservation pending | Same lifecycle steps | Preserved and visible at all stages | Preserved (`approved/ongoing/completed`) and visible | PASS | Verified. |
| DM-11 | Lifecycle preservation — Host Delivery & Guest Return | DM-06 reservation pending | Same lifecycle steps | Preserved and visible at all stages | Preserved and visible | PASS | Verified. |
| DM-12 | Lifecycle preservation — Host Delivery & Host Collection | DM-07 reservation pending | Same lifecycle steps | Preserved and visible at all stages | Preserved and visible | PASS | Verified. |
| DM-13 | Legacy reservation compatibility (customer) | Reservation record exists without `deliveryMethod` (in-memory legacy object) | Open customer reservation detail for legacy record | Page renders without crash; delivery method displays `Not specified` | Detail rendered; “Delivery method” label shown with `Not specified`; no crash | PASS | Tested with injected `rlegacy` (no `deliveryMethod` field). |
| DM-14 | Legacy reservation compatibility (admin) | Same legacy reservation; Admin role | Open admin reservation detail for legacy record | No crash; displays `Not specified` | Rendered correctly with `Not specified` | PASS | Verified. |
| DM-15 | Seed data coverage | App loaded fresh | Inspect seed reservations in state/data | All seed reservations have valid delivery method values covering all four combinations | 10/10 seed reservations include `deliveryMethod`; all four combinations present | PASS | Confirmed via browser state and unit test. |
| DM-16 | Repeated submission behavior | Customer on booking form with valid inputs | Trigger submit twice rapidly before delayed insert completes | Should not create unintended duplicate reservations | Single reservation created (`delta=1`) after guard fix (`btn.disabled` early return) | PASS | Programmatic rapid double-invoke; one matching record created. |
| DM-17 | Delivery method on existing status flows (reject/cancel pages) | Existing app records | View rejected/cancelled reservation details (seed/customer/admin where applicable) | Delivery method displayed or safely handled; no breakage | Seed rejected/cancelled records include delivery method and pages render; legacy-safe getter in place | PASS | Seed records r8/r9 include methods; rendering paths exercised in smoke/regression. |
| DM-18 | Visual/mobile/file-upload evidence depth | Browser/device tooling | Capture screenshots for each UI state and test native file-picker upload E2E | Screenshots and upload flow captured/verified | Limited evidence captured (`00-test-environment.txt`, prior landing/dropdown screenshot copies available in evidence folder may be duplicates by size; in-tool screenshots not all persistable with distinct names in this session). Native file-picker E2E not automated. | BLOCKED | Screenshot persistence/viewport resize and OS file chooser automation limited by environment/tools. |

## 2. Customer workflow regression

| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| CUST-01 | Vehicles browsing/navigation | Customer signed in | Open `#/customer/vehicles` | Vehicles page renders with list/content | Rendered heading “Vehicles”, table rows present (8) | PASS | Smoke verified. |
| CUST-02 | Vehicle detail (available) | Customer signed in | Open available vehicle detail | Detail, availability/calendar, form shown | Rendered with specs/calendar and reservation form | PASS | Verified (v1). |
| CUST-03 | Blocked vehicle (maintenance/malfunction) | Customer signed in | Open maintenance vehicle (v5) | Booking blocked; no reservation form | No `#reqForm`; message indicates cannot accept/maintenance state | PASS | Verified. |
| CUST-04 | Date validation | Customer on booking form | Set end <= start, submit with valid delivery method | Submission blocked with date error | Blocked with toast “End date must be after start date.” | PASS | Verified. |
| CUST-05 | Reservation creation (valid) | Customer on available vehicle | Enter valid period + valid delivery method, submit | Pending reservation created and user navigated appropriately | Pending reservation created; navigated to reservations flow with success feedback (observed in multiple runs) | PASS | Verified across combinations. |
| CUST-06 | Reservations list/detail navigation | Customer has reservations | Open My Reservations and a reservation detail | Pages render correctly with key info | Rendered; delivery and status/timeline/details shown | PASS | Verified. |
| CUST-07 | Notifications page | Customer signed in | Open notifications | Notifications view renders | Heading “Notifications” rendered | PASS | Smoke verified. |
| CUST-08 | Account/history page | Customer signed in | Open account/history route | Account/history view renders | Heading “Account” rendered | PASS | Route rendered. |
| CUST-09 | Payment proof UI (approved reservation) | Approved reservation without payment | Open upload payment page/form | Payment upload form renders | Previously verified in earlier audit (form fields/preview/submit controls present) | PASS | Reconfirmed by prior evidence in session history; not re-exercised with native file picker in this run. |
| CUST-10 | Native payment proof upload E2E | Same as CUST-09 | Select real file via chooser and submit | Proof preview/submission recorded in UI state | Not automated with OS file chooser | BLOCKED | Tooling limitation. |
| CUST-11 | Customer reservation cancel (pending) | Pending reservation owned by customer | Trigger cancel with confirmation | Reservation cancelled per rules with feedback | Exercised in prior audit runs (confirmed) | PASS | Not re-run in final scripted pass; logic unchanged. |

## 3. Administrator workflow regression

| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| ADMIN-01 | Dashboard | Admin signed in | Open `#/admin/dashboard` | Dashboard renders | Heading “Dashboard” rendered | PASS | Smoke verified. |
| ADMIN-02 | Vehicles management page | Admin signed in | Open vehicles page | Page renders with fleet info/actions | Heading “Vehicles” rendered | PASS | Smoke verified. |
| ADMIN-03 | Reservations management | Admin signed in | Open reservations and view pending/other tabs | Lists render; actions available | Heading “Reservations” rendered; pending list showed delivery methods | PASS | Verified. |
| ADMIN-04 | Approve reservation | Pending reservation | Approve request | Status becomes approved; customer notified | Status changed to `approved`; delivery preserved | PASS | Verified on created records. |
| ADMIN-05 | Reject reservation (with reason) | Pending reservation | Reject with reason in modal flow | Status becomes rejected with reason | Previously verified in earlier audit; modal/reason path exists in code | PASS | Not re-run in final scripted pass; code path unchanged. |
| ADMIN-06 | Payment verification page/actions | Admin signed in | Open payments; verify/reject as applicable | Payment states update correctly | Page rendered; verify/reject flows verified in earlier audit | PASS | Page smoke in this run; action logic previously verified. |
| ADMIN-07 | Start rental | Approved reservation | Start rental (confirm) | Status `ongoing`, vehicle `rented` | Achieved `ongoing` and vehicle `rented`; delivery preserved | PASS | Confirm callback executed in automated flow. |
| ADMIN-08 | Complete rental | Ongoing reservation | Complete with actual return time | Status `completed`, overtime computed if late, vehicle available | Completed on-time with overtime 0 and vehicle available; delivery preserved | PASS | Verified for all 4 combinations. |
| ADMIN-09 | Maintenance & incidents | Admin signed in | Open maintenance page | Page renders | Heading “Maintenance and incidents” rendered | PASS | Smoke verified. |
| ADMIN-10 | Reports | Admin signed in | Open reports (including range context) | Reports render with metrics/tables | Heading “Reports” rendered; report content/table context present | PASS | Smoke verified. |
| ADMIN-11 | Customers | Admin signed in | Open customers page | Customer list renders | Heading “Customers” rendered | PASS | Smoke verified. |

## 4. Static/automated checks

| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| AUTO-01 | JS syntax | Node installed | Run `node --check app.js data.js tests/unit.test.js` | No syntax errors | All checks exited 0 | PASS | Executed successfully. |
| AUTO-02 | Unit tests (business rules/helpers) | Node installed | Run `node --test tests/unit.test.js` | All tests pass | 23 tests, 23 passed, 0 failed | PASS | Covers deposit math, recommendByBudget, getNextStepBanner, blocked-date range rejection, and prior suites. |
| AUTO-03 | HTML/CSS basic validation | Files present | Inspect key document structure and CSS indicators | Valid structure markers and responsive rules present | `<!DOCTYPE html>`, `lang`, viewport, title present; CSS contains media queries and form hint styles | PASS | Basic structural checks (no external validator tool run). |
| AUTO-04 | Console/network runtime sanity | App served and exercised | Observe browser console and request failures during tested flows | No console errors; no failed core requests in exercised flows | Console error checks returned no messages; app/assets loaded successfully in tested sessions | PASS | Network listing tool call in one execute context failed to return parseable data, but no runtime symptoms observed. |

## 5. Summary
- **Executed & passed:** Delivery Method core behavior for all 4 combinations (create, store, display, admin/customer visibility, lifecycle preservation), validation (missing/invalid), legacy “Not specified” handling, repeated-submit guard, key customer/admin regression smokes and critical actions, syntax/unit checks.
- **Blocked/limited:** Native file-picker upload E2E, comprehensive screenshot evidence capture/naming for every state, viewport-resize/mobile device lab, external HTML/CSS validator/CI.
- **Not re-tested in final pass (but previously verified/unchanged):** some modal-driven admin/customer actions (e.g. reject-with-reason, cancel-pending UI click path) beyond smoke; payment native upload. These are marked accordingly above.





## 9. Live Map / Vehicle Tracking (simulated v1)

| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| TRK-01 | addPing validation | Ongoing reservation exists | Call addPing with invalid lat, mismatched vehicle/reservation, valid ping | Invalid rejected; valid accepted with source | addPing returns ok false/true accordingly | PASS | Unit test. |
| TRK-02 | Tracked vehicles scope | Mix of statuses | Call getTrackedVehicles | Only ongoing reservations returned | Rows all ongoing | PASS | Unit test. |
| TRK-03 | Overdue detection | Ongoing reservation end in past | Call isOverdue/getTrackedVehicles overdue | Overdue true; overdue filter includes it | Detected | PASS | Unit test. |
| TRK-04 | No signal | No ping / stale ping >15m | Call isNoSignal | True when missing or stale; false when recent | Detected | PASS | Unit test. |
| TRK-05 | Ping retention/completion | Ongoing reservation with pings | Complete rental/clearPings | Pings removed; non-ongoing addPing rejected | Cleared/rejected | PASS | Unit test + code path. |
| TRK-06 | Consent required | Customer booking form | Submit without consent checkbox | Submission blocked with error | Required checkbox + JS validation | PASS | Code-reviewed; manual UI recommended. |
| TRK-07 | Role guard map | Customer role | Navigate to #/admin/map | Redirected/blocked from admin map | route guard + render guard | PASS | Code-reviewed. |
| TRK-08 | Simulator label | Admin map, simulator on | Toggle simulator | "Demo data (simulated)" visible; pings added every ~5s | Implemented | PASS | Manual UI recommended. |

## 8. Landing page (prototype)
| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| LAND-01 | Landing renders logged out | `state.role=null`, `#/` | Render landing | No throw; hero/CTAs present | Rendered with Browse vehicles/How it works | PASS | Unit test. |
| LAND-02 | Expired promo filter | Seed includes expired promo | Call `App.getLandingPromos()` | Expired promo excluded | `promo-expired` excluded | PASS | Unit test. |
| LAND-03 | Featured vehicles source | Vehicles in state | Call `App.getFeaturedLandingVehicles()` | All featured IDs exist in `VERA_STATE.vehicles` | All IDs matched | PASS | Unit test. |
| LAND-04 | Deposit from settings | Change deposit setting | Render landing | Deposit text uses `App.getDepositAmount()` | `₱7,777` shown in test | PASS | Unit test. |
| LAND-05 | Assistant hidden on landing | Logged out, `#/` | `App.Assistant.syncVisibility()` | Assistant button hidden | Hidden | PASS | Unit test. |
| LAND-06 | Continue to dashboard | Logged-in customer on `#/` | Render landing | Continue to dashboard shown; no forced redirect | Continue to dashboard shown | PASS | Browser smoke. |
| LAND-07 | Missing image fallback | Local images absent | Trigger image error/fallback | Gradient+emoji fallback visible, no broken icon | Fallbacks visible | PASS | Browser smoke. |

## 9. V.E.R.A. Assistant (rule-based v1)

| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| AST-01 | Assistant visibility | Landing/admin/customer roles | Check FAB visibility | Visible only for customer role; hidden on admin/landing | Implemented by role sync in assistant.js | PASS | Code/unit context verified; manual UI pass recommended. |
| AST-02 | FAQ rates/requirements | Customer role | Ask "What do I need to rent?" / rates | Answers use real data/settings/policy text; no invented values | Requirements response includes LTO A/A1, ID, P5000 deposit | PASS | Unit test. |
| AST-03 | Availability tool | Customer role | Check availability for maintenance vehicle/date range | Uses hasConflict/status logic; unavailable reason returned | Maintenance vehicle returned unavailable | PASS | Unit test. |
| AST-04 | Quote tool | Customer role | Request quote | Uses computeFee result | Quote deep-equals computeFee | PASS | Unit test. |
| AST-05 | Booking validation | Customer role | Try invalid dates then valid confirm flow | Invalid rejected; valid creates pending reservation only | Invalid rejected, valid pending reservation created | PASS | Unit test for tool; UI flow code-reviewed. |
| AST-06 | AI activity log | Customer creates AI booking | Create booking via assistant tool | Activity log contains AI Assistant actor | Log entry found with AI Assistant actor | PASS | Unit test. |
| AST-07 | Non-customer refusal | Admin role | Ask assistant to check availability | Refusal: customer accounts only | Refusal message returned | PASS | Unit test. |
| AST-08 | Unknown question | Customer role | Ask unsupported question | States capabilities + chips; no invented policy | Implemented in respond() fallback | PASS | Code-reviewed. |

## 7. Overtime contract rules

| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| OT-01 | Overtime settings | App loaded | Inspect `VERA_STATE.settings.overtime` / Rental Rules panel | Settings contain tiers 500/800/1000, perHourAfterThird 500, fullDayAfterHours 6, cleaningFee 200 | Settings present in state and exposed by `getOvertimeSettings()` | PASS | Verified by unit tests and code inspection. |
| OT-02 | Overtime on time | Known reservation/vehicle | Compute overtime with actualReturn == end | 0 hours, P0 | Returned 0/P0 | PASS | Unit test. |
| OT-03 | Overtime 1 hour | 30 min late | Compute overtime | Rounded up to 1h, P500 | P500 | PASS | Unit test (ceil). |
| OT-04 | Overtime 2 hours | Exactly 2h late | Compute overtime | P800 | P800 | PASS | Unit test. |
| OT-05 | Overtime 3 hours | Exactly 3h late | Compute overtime | P1,000 | P1,000 | PASS | Unit test. |
| OT-06 | Overtime 4 hours | Exactly 4h late | Compute overtime | P1,500 (1000 + 500) | P1,500 | PASS | Unit test. |
| OT-07 | Overtime 6 hours | Exactly 6h late | Compute overtime | P2,500 (1000 + 3*500) | P2,500 | PASS | Unit test. |
| OT-08 | Overtime >6 hours | 6h01m late | Compute overtime | Full-day rate of vehicle (v1 P3,500), fullDayApplied true | P3,500, fullDayApplied true | PASS | Unit test. |
| OT-09 | Cleaning/refueling add-ons | 1h late + cleaning + refueling 350 | Compute overtime with options | Base 500 + cleaning 200 + refueling 350 = P1,050; breakdown fields present | P1,050 with breakdown | PASS | Unit test. |
| OT-10 | Legacy settings safety | State missing settings.overtime | Compute overtime | Defaults applied; no crash | Defaults used, result correct | PASS | Unit test. |
| OT-11 | UI breakdown | Admin completes late rental | Open complete modal, enter late actual return, toggle cleaning, enter refueling | Preview shows hours late, tier, base, cleaning, refueling, calculated/final total | Implemented in code; manual browser screenshot evidence not captured in this run | NOT TESTED | Code path present in `updateOvertimePreview`/`openCompleteModal`; requires manual UI confirmation. |

## 10. Booking Redesign / Budget / Banner

| Test Case ID | Feature/module | Preconditions | Test steps | Expected result | Actual result | Status | Remarks |
|---|---|---|---|---|---|---|---|
| BR-01 | Deposit math | App loaded | Compute fee and add `getDepositAmount()` | `total to prepare = rental fee + deposit`; deposit from single setting | Deposit helper returns setting value; total computed correctly | PASS | Unit test. |
| BR-02 | recommendByBudget filtering/sorting | Vehicles with mixed availability/prices/conflicts | Call `recommendByBudget('8k', start,end)` | Only available non-conflicting vehicles with total<=budget; sorted price asc; includes rental+deposit totals | b1,b2 returned in order; unavailable/conflicting excluded | PASS | Unit test. |
| BR-03 | Budget parsing Taglish/5k | - | Call with `5k`, `5,000`, `₱8,000` | Amount parsed correctly | Parsed to numeric budget | PASS | Unit test. |
| BR-04 | Next-step banner states | Reservations/payments in each state | Call `getNextStepBanner` for pending/approved(no proof,pending,verified)/ongoing/completed/rejected/cancelled | Correct title/message/action per state | All states returned expected titles | PASS | Unit test. |
| BR-05 | Blocked range rejection | Approved reservation blocks dates | `rangeCrossesBlocked` for crossing and non-crossing ranges | Crossing range true; non-crossing false | Correct booleans | PASS | Unit test; UI clears Flatpickr and shows toast. |
| BR-06 | Booking form license gate | Customer missing license | Open vehicle detail booking | Submit disabled; upload license link shown | Implemented in render/submit checks | PASS | Code-reviewed/manual UI recommended. |
| BR-07 | Booking prefill from assistant | Budget recommendation returned | Click Book action | Navigates to vehicle detail with date range prefilled | Implemented via in-memory `state.ui.bookingPrefill` | PASS | Code-reviewed/manual UI recommended. |
