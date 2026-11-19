# V.E.R.A. — Feature Specification

## 1. Scope
This document specifies implemented and expected behavior for the V.E.R.A. interactive prototype, with emphasis on the **Delivery Method / Pickup & Return Configuration** feature integrated into the reservation workflow.

## 2. Feature descriptions

### 2.1 Core reservation and rental management (existing)
- Customers browse vehicles, view availability/conflicts, and submit reservation requests.
- Administrators review requests (approve/reject), verify payments, start rentals, and complete rentals.
- System tracks statuses, fees/overtime, notifications, maintenance, and basic reports.

### 2.2 Delivery Method / Pickup & Return Configuration (implemented)
Allows a customer to select how the vehicle will be handed over at pickup and return for a reservation request.

**Supported combinations (exact options):**
1. `Guest Pickup & Guest Return`
2. `Guest Pickup & Host Collection`
3. `Host Delivery & Guest Return`
4. `Host Delivery & Host Collection`

**Lifecycle coverage:** selection at booking → validation → stored in reservation record → visible in customer/admin views → preserved through status updates/transitions (approve, start/ongoing, complete, reject/cancel as applicable).

## 3. Functional requirements

### 3.1 Delivery Method
| ID | Requirement | Status |
|---|---|---|
| DM-FR-01 | Display a Delivery Method control in the customer reservation request form on vehicle detail pages where booking is allowed. | Implemented |
| DM-FR-02 | Present all four supported pickup/return combinations as selectable options plus a non-submittable placeholder prompt. | Implemented |
| DM-FR-03 | Allow the customer to select one preferred combination. | Implemented |
| DM-FR-04 | Require a valid delivery method before reservation submission (client-side validation). | Implemented |
| DM-FR-05 | Store the selected delivery method in the created reservation record (`deliveryMethod`). | Implemented |
| DM-FR-06 | Display the delivery method in customer reservation list and reservation detail views. | Implemented |
| DM-FR-07 | Display the delivery method in administrator reservation list and reservation detail views. | Implemented |
| DM-FR-08 | Preserve the delivery method value throughout the reservation lifecycle and status transitions. | Implemented |
| DM-FR-09 | Handle existing/legacy reservations without a delivery method without crashing; display `Not specified`. | Implemented |
| DM-FR-10 | Use existing V.E.R.A. UI patterns and remain responsive. | Implemented |

### 3.2 Reservation workflow (relevant existing requirements)
| ID | Requirement | Status |
|---|---|---|
| RES-FR-01 | Block submission when end date/time is not after start date/time. | Implemented |
| RES-FR-02 | Block submission when dates conflict with `approved`/`ongoing` reservations or vehicle is `maintenance`/`malfunction`. | Implemented |
| RES-FR-03 | Calculate estimated rental fee from duration and vehicle daily rate (`days = ceil`, minimum 1). | Implemented |
| RES-FR-04 | Support status transitions: `pending → approved|rejected|cancelled`, `approved → ongoing|cancelled`, `ongoing → completed`. | Implemented |
| RES-FR-05 | Compute overtime on completion when actual return is after scheduled end. | Implemented |

## 4. Non-functional requirements
| ID | Requirement | Notes |
|---|---|---|
| NFR-01 | **Usability:** clear labels, placeholder prompt, helper hint, and actionable validation feedback. | Implemented within existing form style (`field-label`, `select`, `field-hint`, toast messages). |
| NFR-02 | **Consistency:** align with existing design system/components (panels, key-value rows, tables, badges, toasts). | Implemented. |
| NFR-03 | **Responsiveness:** usable on mobile and desktop layouts. | Existing responsive CSS retained; delivery field uses standard form controls. |
| NFR-04 | **Reliability:** no crashes for legacy records missing `deliveryMethod`. | Implemented via safe getter/default display. |
| NFR-05 | **Performance:** no unnecessary backend calls or heavy processing (client-only prototype). | No additional network logic added. |
| NFR-06 | **Maintainability:** minimal, localized changes preserving existing behavior. | Implemented. |
| NFR-07 | **Privacy/prototype safety:** no real PII/payment transmission or server storage introduced. | Preserved. |

## 5. User interactions

### 5.1 Customer — select delivery method during booking
1. Customer signs in as Customer and opens an available vehicle detail page.
2. Customer enters start and end date/time and selects a **Delivery method** option.
3. System shows fee preview/conflict feedback as applicable.
4. Customer clicks **Submit reservation request**.
5. On success, reservation is created as `pending` and customer is redirected to reservations with confirmation feedback.

**Validation feedback:**
- Missing/invalid delivery method: toast “Please select a delivery method.” and focus on the field (submission blocked).
- End before/at start: toast “End date must be after start date.” (submission blocked).
- Conflict/unavailable: inline conflict message and error toast (submission blocked).

### 5.2 Customer/Admin — view delivery method
- **Customer list:** reservation row shows `Delivery: <method>` (or `Not specified` for legacy).
- **Customer detail:** “Delivery method” shown in reservation details key-value section.
- **Admin list:** delivery method shown in period/details context for reservations.
- **Admin detail:** “Delivery method” shown in reservation details.

## 6. Business rules
- **Allowed delivery method values:** only the four specified combinations are accepted for new submissions.
- **Storage:** `reservation.deliveryMethod` stores the selected value as a string.
- **Legacy/default behavior:** if missing/null/empty, display as `Not specified` (no crash, no inferred value).
- **Lifecycle preservation:** delivery method is not modified by approve/reject/start/complete/cancel/payment verification actions.
- **No invented rules:** the application does **not** infer or enforce delivery/collection locations, special instructions, eligibility constraints, or additional fees based on delivery method because these are not defined in the existing application.

## 7. Expected system behavior
- A valid booking request includes vehicle, customer, period, computed fee fields, status/timestamps, and `deliveryMethod`.
- Users can identify the chosen pickup/return arrangement from customer and administrator reservation views.
- Existing seed and legacy-like records without `deliveryMethod` remain viewable and stable.
- Delivery method functionality does not break overlap checks, fee/overtime calculation, or status transitions.

## 8. Future considerations (not implemented)
- Capture delivery/collection addresses and contact instructions per method.
- Define conditional required fields (e.g. address required for host delivery/collection).
- Configure and apply delivery/collection fees if business rules are approved.
- Add admin workflow prompts/checklists based on handoff method.
- Persist data and files via backend services in a production version.
