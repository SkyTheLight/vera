# V.E.R.A. — Test Plan

## 1. Testing objectives
- Verify the **Delivery Method / Pickup & Return Configuration** feature is correctly implemented across selection, validation, storage, display, and lifecycle preservation for all four combinations.
- Confirm existing customer and administrator workflows continue to function after changes (regression confidence for prototype scope).
- Detect JavaScript/runtime errors, broken navigation, UI/validation issues, and data inconsistencies introduced by the feature.
- Provide repeatable, evidence-based verification suitable for academic thesis documentation.

## 2. Testing scope

### In scope
- **Feature under test:** Delivery Method dropdown/options, selection handling, submission validation, reservation record persistence (in-memory), customer/admin visibility, lifecycle preservation, legacy-record handling.
- **Customer flows:** vehicle browsing/detail, availability/date validation, reservation creation/cancellation paths (as applicable), reservation/payment/notification/history/account views, navigation.
- **Administrator flows:** dashboard, vehicles, reservations (approve/reject/start/complete), payments, maintenance/incidents, reports, customers.
- **Quality checks:** JavaScript syntax checks, browser console errors, basic network/load sanity, responsive layout considerations (code/inspection), lightweight automated unit tests for business rules/helpers.

### Out of scope (prototype/environment constraints)
- Real authentication, authorization enforcement, backend APIs, database persistence/integrity.
- Real payment gateway processing and server-side file storage.
- Full cross-browser/device lab, accessibility certification, performance/load/stress benchmarking.
- Native OS file-picker end-to-end automation for payment proof upload (tooling/environment limitation).

## 3. Testing environment
| Item | Value |
|---|---|
| Date | 2026-11-20 |
| Project path | `C:\Users\Skyth\Documents\vera\` |
| Application type | Static SPA (HTML/CSS/vanilla JS), no build step |
| Runtime (local server) | `python -m http.server 8765` serving `http://localhost:8765/` |
| Node.js (checks/tests) | v24.14.0 (built-in `node --test`) |
| Platform | Windows (win32) |
| Browser execution | In-app browser automation/tab (Chromium-based environment via harness tools) for functional verification and console observation |
| Repository/commit (if available) | Git HEAD observed: `9037f75` (workspace not fully clean; unrelated parent-directory warnings present) |

## 4. Test methodology
- **Static inspection:** source review and repository-wide searches for delivery/pickup/return fields, UI controls, and data usage.
- **Static checks:** `node --check` for `app.js`, `data.js`, and test files; basic HTML/CSS presence checks.
- **Automated unit testing (lightweight):** Node built-in test runner (`node --test tests/unit.test.js`) loading app/data in a VM harness to validate exported helpers, seed data integrity, and core business rules.
- **Functional/manual-in-browser automation:** scripted interactions and state inspection in the running app to exercise UI flows, validation, lifecycle transitions, and visibility across roles; console/network observation via browser tools where available.
- **Regression testing:** smoke/navigation and key workflow checks across major customer/admin pages and critical reservation behaviors after implementation.
- **Evidence handling:** record actual observed outputs/results; capture environment notes and available screenshots/artifacts under `docs/evidence/` without fabrication.

## 5. Test scenarios

### 5.1 Delivery Method feature
- Dropdown presence, label, placeholder, hint, required behavior, and four options on booking form.
- Selection and submission for each combination:
  1. Guest Pickup & Guest Return
  2. Guest Pickup & Host Collection
  3. Host Delivery & Guest Return
  4. Host Delivery & Host Collection
- Validation: missing selection, invalid selection value.
- Record correctness: created reservation contains selected `deliveryMethod`.
- Visibility: customer list/detail and admin list/detail display selected method.
- Lifecycle preservation: value unchanged after approve, start (ongoing), and complete.
- Legacy compatibility: reservation without `deliveryMethod` displays `Not specified` with no crash (customer/admin).
- Submission behavior: repeated/rapid submit does not create unintended duplicates (guard behavior).

### 5.2 Regression scenarios
- **Customer:** vehicles list/detail access, blocked maintenance/malfunction vehicle behavior, date validation, reservation creation flow integrity, reservations/notifications/account/history navigation.
- **Admin:** dashboard/vehicles/reservations/payments/maintenance/reports/customers navigation, reservation approve/start/complete actions, report rendering.
- **Cross-cutting:** no console errors in exercised flows, app loads over HTTP, seed/state initializes.

## 6. Expected results
- All four delivery combinations can be selected, validated, stored, displayed to customer and admin, and preserved across reservation status changes.
- Invalid or missing delivery method prevents submission with clear user feedback.
- Legacy reservations without delivery method render safely as `Not specified`.
- Existing workflows and routes remain functional; no new JavaScript console errors in tested scenarios.
- Automated unit tests for covered helpers/rules pass.

## 7. Acceptance criteria
- Delivery Method feature classified as **fully functional** for implemented prototype scope (all four combinations verified through lifecycle in testing).
- No critical/functional regressions observed in exercised core customer/admin workflows.
- Validation and legacy handling behave as specified.
- Documentation reflects actual implementation and actual test outcomes (PASS/FAIL/BLOCKED/NOT TESTED) with no fabricated evidence.
- Prototype limitations (no backend/auth/persistence/real payments, undefined delivery fees/locations/instructions) are explicitly documented.
