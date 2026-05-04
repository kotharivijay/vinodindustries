# Petpooja API Reference (KSI / VI)

Everything we know about Petpooja's payroll + attendance APIs in one place.
Last verified: 2026-05-04 against `payroll.petpooja.com` and
`attendanceinfo.petpooja.com`.

---

## Tenant identifiers (Vinod Industries / KSI)

| Field                | Value |
|----------------------|-------|
| `orgId`              | `112679` (organization, "Vinod Industries") |
| `orgName`            | `Vinod Industries` |
| `hoId`               | `22956` (head office) |
| `userId`             | `69015` (user `OFFICE`) |
| `username`           | `OFFICE` |
| `uniqueCode`         | `d4zkshb9` |
| `AWS_ACCESS_TOKEN`   | `605ab775311eeee0ffa2c1d999e2968474f5381d` |

`AWS_ACCESS_TOKEN` is per-tenant — it's the `access_token` value baked into
the Petpooja SPA bundle for this org. **It is NOT the JWT.** It must be
sent in the JSON **body** of every `attendanceinfo.*` request *alongside*
the JWT in the Authorization header.

---

## Base URLs

| Subdomain                           | Used for                                         |
|-------------------------------------|--------------------------------------------------|
| `https://payroll.petpooja.com/api`  | Reports — attendance, payroll, daily punch       |
| `https://attendanceinfo.petpooja.com` | Master data — departments, employees, orgs    |

Both subdomains accept the **same JWT** in `Authorization: Bearer …`. The
attendanceinfo subdomain *additionally* requires `access_token` and
`user_id`/`username` in the body.

---

## Authentication

### JWT capture
- The Petpooja SPA stores its JWT in `sessionStorage.authUser` (and
  `localStorage.userData` mirrors `userId` / `username`).
- App captures via [POST /api/attendance/save-token](app/api/attendance/save-token/route.ts).
- DB table: `PetpoojaToken` (fields: `token`, `userId`, `username`,
  `hoId`, `orgId`, `orgName`, `uniqueCode`, `expiresAt`).
- JWT is opaque (encrypted payload) — `decodePetpoojaJwt()` only extracts
  `iat`/`exp`. Validity ≈ 60 days.

### Refresh
```
POST https://payroll.petpooja.com/api/V1/authentication/refresh_token
```
We don't currently call this — the user re-captures via
[/attendance/token](app/(dashboard)/attendance/token/page.tsx) when expired.

### Body shape for attendanceinfo.* calls
```json
{
  "is_web_req": 1,
  "method": "<discriminator>",
  "access_token": "605ab775311eeee0ffa2c1d999e2968474f5381d",
  "username": "OFFICE",
  "user_id": 69015,
  "device_type": "web"
}
```
The `method` discriminator changes the operation against the same URL
(e.g. `department_list`, `employee_list_tmp`).

### Headers (all hosts)
```
Authorization: Bearer <JWT>
Accept: application/json, text/plain, */*
Content-Type: application/json
```

---

## Endpoints

### 1) Departments — full master list (verified)

```
POST https://attendanceinfo.petpooja.com/division/get_department
```
Body:
```json
{
  "is_web_req": 1,
  "method": "department_list",
  "access_token": "<AWS_ACCESS_TOKEN>",
  "username": "OFFICE",
  "user_id": 69015,
  "device_type": "web"
}
```
Sample response:
```json
{
  "status": 1,
  "message": "Data found",
  "statusCode": 200,
  "data": [
    {
      "id": 141675,
      "name": "Managment",
      "employee_count": 1,
      "employee_status_counts": "{\"All\":1,\"Left\":0,\"Active\":1,\"Inactive\":0,\"Terminated\":0}"
    },
    { "id": 142004, "name": "Vi Marketing", "employee_count": 0, ... }
  ]
}
```
**KSI live distribution (10 departments):**
- Kothari Synthetic — 27
- Vinod Industries — 22
- Vi Folding — 3
- Vi Tractor — 2
- Vi Etp — 1
- Ksi Dyeing — 1
- Managment — 1
- Vi Dyeing, Vi Office, Vi Marketing — 0

### 2) Employees — full master list (verified, returns 57 rows)

```
POST https://attendanceinfo.petpooja.com/get_employees
```
Body:
```json
{
  "is_web_req": 1,
  "method": "employee_list_tmp",
  "active_tag_only": false,
  "access_token": "<AWS_ACCESS_TOKEN>",
  "username": "OFFICE",
  "user_id": 69015,
  "device_type": "web"
}
```
Each row carries the full HR record. Notable fields:
```
id, empId, code, name, gender, dob, doj
mobile_number, address, permanent_address
emg_mobile_no, emg_contact_name, emg_contact_relation, emg_contact_address
designation_id, designation
department_id, department
master_branch_id, branch_ids, employee_organization_id
status, scheduled_status, effective_date, tag_updated_at
employeement_type, attendance_method, is_geo_track
photo, aadhar_doc, pan_card_doc, dl_doc, profile_doc
salary_type, pf, uan, esic, earning, bank_details
```
**Use this — not `attendance_master` — when the goal is "full headcount".**

### 3) Attendance Master — roster-only (verified, partial)

```
POST https://payroll.petpooja.com/api/reports/attendance_master
```
Body:
```json
{
  "filter_start_date": "YYYY-MM-DD",
  "filter_end_date": "YYYY-MM-DD",
  "filter_branch": null
}
```
**Limitation:** roster-filtered to one branch. For our tenant it returns
only the **27 Vinod-Industries-side** employees on today's roster, even
with a 365-day window. The 27 Kothari Synthetic + 2 Vi Tractor + 1
Ksi Dyeing employees never appear here. Useful for daily punch reports;
NOT useful for the employees master.

Row keys:
```
employee_id, code, device_employee_id, name, attandance_date,
master_branch_id, is_geo_track, tag, designation, department,
first_punch, last_punch, status, working_hrs, break_hrs,
error_state, leave_name, holiday_name, employee_status,
tag_updated_at, total_distance_meters, travel_time_seconds
```
`employee_status`: `1` = active, `4` = recently inactive. Other status
values exist (left, archived…) but are filtered server-side here.

### 4) Daily Punch — for the daily WhatsApp report

```
POST https://payroll.petpooja.com/api/reports/daily_punch
```
Body:
```json
{
  "filter_start_date": "YYYY-MM-DD",
  "filter_end_date": "YYYY-MM-DD",
  "filter_branch": null
}
```
Returns `data[]` with one row per employee per date, with a
`day_<M>_<D>` field containing comma-separated punch times (alternating
IN/OUT) and `err_day_<M>_<D>` flagging odd-count days. Decoded by
[fetchDailyPunches()](lib/petpooja.ts#L45) in the codebase.

### 5) Organizations — branches list (token-scoped, currently 403)

```
GET https://attendanceinfo.petpooja.com/organizations/get_organizations
Headers: token: <JWT>     ← OLD pattern, may not work
```
Returns "Missing Authentication Token" with the current capture flow.
Probably needs the same body-with-access_token pattern the other
attendanceinfo endpoints use — TODO if branches list is ever needed.

---

## Existing app integration

| Concern             | Where |
|---------------------|-------|
| Token capture page  | [app/(dashboard)/attendance/token/page.tsx](app/(dashboard)/attendance/token/page.tsx) |
| Token POST          | [app/api/attendance/save-token/route.ts](app/api/attendance/save-token/route.ts) |
| Token retrieval     | `getPetpoojaAuth()` in [lib/petpooja.ts](lib/petpooja.ts) |
| Employee sync       | [app/api/attendance/employees/route.ts](app/api/attendance/employees/route.ts) |
| Daily report        | [app/api/attendance/daily/route.ts](app/api/attendance/daily/route.ts) |
| Daily punch helper  | [lib/petpooja.ts](lib/petpooja.ts) — `fetchDailyPunches()` |

---

## Lessons / gotchas

1. **`attendance_master` is NOT the master.** It's the roster of employees
   recently active on a single branch. To get the full headcount, hit
   `attendanceinfo/get_employees` instead.
2. **Two body keys are non-obvious and required:** `is_web_req: 1` and
   `access_token` (the AWS one, not the JWT). Without either you get
   `"Please provide a valid access token."` even with a perfectly valid
   JWT.
3. **Brute-force URL guessing on payroll fails** because the
   employees/departments endpoints aren't there — they're on
   `attendanceinfo.petpooja.com`. Don't waste time on `/employees`,
   `/master/employees`, `/reports/employee_master` against payroll.
4. **JWT staleness manifests as `access_token` errors.** If a stored JWT
   has been around long enough, attendanceinfo rejects body's
   `access_token` even though the JWT itself isn't expired by `exp`.
   Re-capture via the SPA when this happens.
5. **`master_branch_id` matters.** Multi-branch orgs (like KSI/VI) split
   employees across branches. `attendance_master` filters to one branch;
   `get_employees` ignores branch and returns the full roster.

---

## Dev-time SPA hooking trick

To capture a fresh JWT or inspect a request without DevTools, paste this
into the Petpooja SPA's console:

```js
const _f = window.fetch
window.fetch = async (...args) => {
  console.log('FETCH', args[0], args[1]?.body)
  const r = await _f.apply(window, args)
  return r
}
```

Then click around the SPA. The console will log every fetch URL + body
that the page makes, including the `Authorization` header (visible in
`args[1].headers`). That's how the Bearer JWT + AWS_ACCESS_TOKEN combo
was discovered.
