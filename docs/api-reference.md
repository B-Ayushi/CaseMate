# CaseMate API reference

The CaseMate server is a JSON API under `/api`. The React client uses it, and so can
Postman or any HTTP client. This page is written from the server code: the routes in
`server/src/routes`, the zod schemas in `server/src/validators` and the services in
`server/src/services`. The examples are real requests and responses from a run of the
[Postman collection](../postman/CaseMate.postman_collection.json), with ids shortened.

- Base URL in development: `http://localhost:4000`.
- Requests and responses are JSON (`Content-Type: application/json`). The exceptions are
  the invoice PDF and the data export, which are file downloads.
- Times are UTC instants in ISO 8601, for example `2026-10-04T05:00:00.000Z`, which is
  10:30 AM IST. Values you type as a date and time (`"date": "2026-10-04"`,
  `"time": "10:30"`) are read as **Indian Standard Time**. Calendar days (`workDate`,
  `issueDate`, `dueDate`) are plain `yyyy-MM-dd` IST days.
- Money is always **integer paise**: ₹3,000 is `300000`. The server calculates every
  amount and total; they can't be set by the client.
- Ids are cuids, such as `cmus3sobg0018oab0x0sp8tjh`.

> **Sends a real message:** three endpoints send real email or SMS through the server's
> SMTP and Twilio settings. They are marked 📨 below:
> [forgot password](#post-apiauthforgot-password), [test reminder](#post-apisettingstest-reminder)
> and [send invoice](#post-apiinvoicesidsend). The Postman collection keeps them in a
> separate folder that is not part of the run order.

## Contents

- [Authentication](#authentication)
- [Errors](#errors)
- [Summary of endpoints](#summary-of-endpoints)
- [Health](#health)
- [Auth](#auth)
- [Settings](#settings)
- [Clients](#clients)
- [Client notes](#client-notes)
- [Cases](#cases)
- [Hearings and hearing log](#hearings-and-hearing-log)
- [Reminders](#reminders)
- [Dashboard](#dashboard)
- [Calendar](#calendar)
- [Time entries](#time-entries)
- [Invoices](#invoices)
- [Billing summary](#billing-summary)

## Authentication

Sign up or log in, and the server sets a session cookie named `casemate_session`:

```http
Set-Cookie: casemate_session=<JWT>; Max-Age=604800; Path=/; Expires=Sat, 10 Oct 2026 08:01:45 GMT; HttpOnly; SameSite=Lax
```

- The cookie holds a signed JWT, valid for 7 days. It is `httpOnly`, so page scripts
  can't read it, and it is marked `Secure` in production.
- Browsers send the cookie automatically, and so does **Postman**: after the Log in (or
  Sign up) request, Postman's cookie jar keeps it for `localhost` and sends it with every
  later request. There is no `Authorization` header to set.
- Every route except Health and the Auth routes needs the cookie. Without a valid one,
  the API answers `401 {"error":"Please log in to continue."}`.
- The session is tied to the password. Changing the password (or resetting it) ends
  every other session. The session that made the change gets a new cookie.
- A session for a deleted account is rejected and its cookie cleared.
- Every record belongs to one lawyer, and every query is filtered by the logged-in
  lawyer. A record that belongs to someone else answers `404`, exactly as if it did not
  exist.

## Errors

Every error is JSON with an `error` message. Validation errors also have `fields`, with
one message per field (nested fields use dots, such as `firstHearing.date`):

```json
{
  "error": "Please check the highlighted fields.",
  "fields": {
    "name": "Enter the client's name",
    "phone": "Enter a valid Indian mobile number, for example 98765 43210"
  }
}
```

| Status | Meaning |
| --- | --- |
| `400` | The body, query or a rule failed validation (for example a hearing date in the past) |
| `401` | Not logged in, the session has ended, or the email and password don't match |
| `404` | No such route, a malformed id, or a record that does not exist or belongs to another lawyer |
| `409` | The request conflicts with the record's state (for example deleting a sent invoice) |
| `429` | Too many attempts (see the limits on each endpoint) |
| `502` | Sending an invoice email failed (the invoice is unchanged) |
| `500` | An unexpected server error: `{"error":"Something went wrong on the server. Please try again."}` |
| `503` | Health check only: the database can't be reached |

A malformed id in the URL (not a cuid) gets `404 {"error":"Not found."}`. An unknown
`/api` route gets `404 {"error":"Not found"}`. A body that is not valid JSON gets
`400 {"error":"The request body is not valid JSON."}`.

### Shared field rules

These rules come from the zod schemas and are used by several endpoints.

| Rule | Accepts | Error message |
| --- | --- | --- |
| Indian mobile | 10 digits starting 6-9, optionally `+91`, `91` or `0` first, spaces and dashes allowed. Stored as `+91XXXXXXXXXX` | `Enter a valid Indian mobile number, for example 98765 43210` |
| Email | A valid address, at most 191 characters; trimmed and lower-cased | `Enter a valid email address` |
| New password | At least 8 characters, at most 72 bytes, with at least one letter and one number | `Password must be at least 8 characters` / `Password is too long (maximum 72 bytes)` / `Password must include at least one letter and one number` |
| Date | `yyyy-MM-dd`, a real calendar day | `Enter a valid date` |
| Time | `HH:mm`, 24-hour | `Enter a valid time, for example 10:30` |
| Optional text | Trimmed; an empty string is stored as `null` | `<Field> is too long (maximum N characters)` |
| Hourly rate | Integer paise, 0 to 50,000,000 (₹5,00,000 an hour) | `Rate can be at most ₹5,00,000 an hour` |
| Id | A cuid | `404 Not found.` when in the URL |

## Summary of endpoints

"Login" means the session cookie is required. 📨 marks an endpoint that sends real email
or SMS.

| Method | Path | What it does | Login | Main errors |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | Checks the API and the database | No | 503 |
| POST | `/api/auth/signup` | Creates an account and logs in | No | 400, 409, 429 |
| POST | `/api/auth/login` | Logs in | No | 400, 401, 429 |
| POST | `/api/auth/logout` | Logs out (clears the cookie) | No | - |
| GET | `/api/auth/me` | The logged-in lawyer | Yes | 401 |
| POST | `/api/auth/forgot-password` | 📨 Emails a password-reset link | No | 400, 429 |
| POST | `/api/auth/reset-password` | Sets a new password from a reset link | No | 400 |
| GET | `/api/settings/profile` | Name, email, phone, Bar Council number | Yes | 401 |
| PATCH | `/api/settings/profile` | Updates name, phone, Bar Council number | Yes | 400 |
| POST | `/api/settings/password` | Changes the password; logs out other sessions | Yes | 400, 429 |
| GET | `/api/settings/reminders` | Reminder preferences | Yes | 401 |
| PATCH | `/api/settings/reminders` | Updates preferences and rebuilds pending reminders | Yes | 400 |
| GET | `/api/settings/billing` | Default hourly rate | Yes | 401 |
| PATCH | `/api/settings/billing` | Sets the default hourly rate | Yes | 400 |
| POST | `/api/settings/test-reminder` | 📨 Sends one email and one SMS to the lawyer | Yes | 429 |
| GET | `/api/settings/export` | Downloads all the lawyer's data as JSON | Yes | 401 |
| DELETE | `/api/settings/account` | Deletes the account and all its data | Yes | 400, 429 |
| GET | `/api/clients` | Lists clients, with search | Yes | 400 |
| POST | `/api/clients` | Adds a client | Yes | 400 |
| GET | `/api/clients/:id` | Client profile: cases, notes, billing summary | Yes | 404 |
| PUT | `/api/clients/:id` | Updates a client | Yes | 400, 404 |
| DELETE | `/api/clients/:id` | Deletes a client with no cases or invoices | Yes | 404, 409 |
| POST | `/api/clients/:id/notes` | Adds a call or meeting note | Yes | 400, 404 |
| DELETE | `/api/clients/:id/notes/:noteId` | Deletes a note | Yes | 404 |
| GET | `/api/cases` | Lists cases, with filters | Yes | 400 |
| POST | `/api/cases` | Adds a case with its first hearing | Yes | 400, 409 |
| GET | `/api/cases/:id` | Case with hearings, reminders and time totals | Yes | 404 |
| PUT | `/api/cases/:id` | Updates a case (and closes or reopens it) | Yes | 400, 404, 409 |
| DELETE | `/api/cases/:id` | Deletes a case with no time entries | Yes | 404, 409 |
| POST | `/api/cases/:id/hearings` | Schedules another hearing | Yes | 400, 404, 409 |
| GET | `/api/hearings` | Hearings in an IST date range | Yes | 400 |
| GET | `/api/hearings/missing-outcome` | Hearings past their nudge time with no outcome | Yes | 401 |
| PUT | `/api/hearings/:id` | Moves a hearing or edits its details | Yes | 400, 404, 409 |
| POST | `/api/hearings/:id/cancel` | Cancels a hearing | Yes | 404, 409 |
| POST | `/api/hearings/:id/outcome` | Logs the outcome, time spent and next date | Yes | 400, 404, 409 |
| PUT | `/api/hearings/:id/outcome` | Corrects a logged outcome | Yes | 400, 404, 409 |
| POST | `/api/reminders/:id/retry` | Retries a failed reminder | Yes | 404, 409 |
| GET | `/api/dashboard` | Today, the next 7 days and needs attention | Yes | 401 |
| GET | `/api/calendar` | A month of hearings | Yes | 400 |
| GET | `/api/time-entries` | Lists time entries, with filters | Yes | 400 |
| GET | `/api/time-entries/rate` | The rate new time on a case would use | Yes | 400, 404 |
| POST | `/api/time-entries` | Logs time | Yes | 400, 404 |
| PUT | `/api/time-entries/:id` | Edits time that is not invoiced | Yes | 400, 404, 409 |
| DELETE | `/api/time-entries/:id` | Deletes time that is not invoiced | Yes | 404, 409 |
| GET | `/api/invoices` | Lists invoices | Yes | 400 |
| POST | `/api/invoices` | Creates an invoice from unbilled time | Yes | 400, 404, 409 |
| GET | `/api/invoices/:id` | Invoice with its entries | Yes | 404 |
| PATCH | `/api/invoices/:id` | Edits the due date and notes | Yes | 400, 404, 409 |
| DELETE | `/api/invoices/:id` | Deletes a draft and frees its time | Yes | 404, 409 |
| GET | `/api/invoices/:id/pdf` | Downloads the invoice as an A4 PDF | Yes | 404 |
| POST | `/api/invoices/:id/send` | 📨 Emails the PDF to the client; marks it sent | Yes | 404, 409, 502 |
| POST | `/api/invoices/:id/mark-sent` | Marks sent without emailing | Yes | 404, 409 |
| POST | `/api/invoices/:id/mark-paid` | Records payment | Yes | 404 |
| GET | `/api/billing/summary` | Billed, received, outstanding and unbilled for a month | Yes | 400 |

---

## Health

### GET /api/health

Checks that the API is running and can query MySQL. No login.

```http
GET /api/health
```

`200 OK`

```json
{ "status": "ok", "database": "ok" }
```

`503 Service Unavailable` when the database can't be reached:

```json
{ "status": "error", "database": "error", "message": "Cannot connect to the database: …" }
```

---

## Auth

All Auth routes except `GET /me` work without a login.

### The lawyer object

Sign up, log in and `me` return the lawyer without any secrets:

```json
{
  "lawyer": {
    "id": "cmus3skb6…",
    "name": "Adv. Postman Tester",
    "email": "postman.tester+casemate1791014504274@example.com",
    "phone": "+919000000000",
    "barCouncilNumber": "MAH/0000/2026",
    "defaultHourlyRatePaise": 0,
    "emailEnabled": true,
    "smsEnabled": true,
    "dayBeforeEnabled": true,
    "twoHourEnabled": true,
    "dailySummaryEnabled": true,
    "dailySummaryTime": "07:00",
    "missingOutcomeNudgeEnabled": true,
    "createdAt": "2026-10-03T08:01:44.658Z",
    "updatedAt": "2026-10-03T08:01:44.658Z"
  }
}
```

### POST /api/auth/signup

Creates an account and starts a session (sets the cookie).

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | Required, trimmed, 1-100 characters (`Enter your name`) |
| `email` | string | Required, valid email; must not already have an account |
| `phone` | string | Required, Indian mobile (stored as `+91…`) |
| `barCouncilNumber` | string | Required, 1-50 characters (`Enter your Bar Council enrolment number`) |
| `password` | string | Required, new-password rules |

```json
{
  "name": "Adv. Postman Tester",
  "email": "postman.tester+casemate1791014504274@example.com",
  "phone": "9000000000",
  "barCouncilNumber": "MAH/0000/2026",
  "password": "Postman-test-2026"
}
```

`201 Created`: `{ "lawyer": { … } }`, plus the session cookie.

| Status | Error |
| --- | --- |
| 400 | Field errors, as above |
| 409 | `An account with this email already exists. Try logging in instead.` |
| 429 | `Too many sign-ups from this network. Please try again later.` (20 an hour per network by default; `SIGNUP_LIMIT_PER_HOUR`) |

### POST /api/auth/login

| Field | Type | Rules |
| --- | --- | --- |
| `email` | string | Required, valid email |
| `password` | string | Required (`Enter your password`), at most 200 characters |

```json
{ "email": "postman.tester+casemate1791014504274@example.com", "password": "Postman-test-2026" }
```

`200 OK`: `{ "lawyer": { … } }`, plus the session cookie.

| Status | Error |
| --- | --- |
| 400 | Field errors |
| 401 | `Email or password is incorrect.` |
| 429 | `Too many login attempts. Please wait 15 minutes and try again.` (10 failed attempts per 15 minutes per network; successful logins don't count) |

### POST /api/auth/logout

Clears the session cookie. No body is needed.

`200 OK`

```json
{ "message": "You have been logged out." }
```

### GET /api/auth/me

The logged-in lawyer. `200 OK`: `{ "lawyer": { … } }`. `401` if not logged in, or if
the account no longer exists.

### POST /api/auth/forgot-password

📨 **Sends a real email** (when the address has an account).

Creates a reset link valid for 30 minutes and emails it. The answer is identical whether
or not the address has an account, so it reveals nothing.

| Field | Type | Rules |
| --- | --- | --- |
| `email` | string | Required, valid email |

```json
{ "email": "priya@example.com" }
```

`200 OK`

```json
{ "message": "If an account exists for that email, we have sent a link to reset the password." }
```

| Status | Error |
| --- | --- |
| 400 | Field errors |
| 429 | `Too many reset requests. Please wait an hour and try again.` (5 an hour per network) |

### POST /api/auth/reset-password

Sets a new password using the token from the reset link (`/reset-password?token=…`). The
token works once. Every existing session ends.

| Field | Type | Rules |
| --- | --- | --- |
| `token` | string | Required, 1-200 characters |
| `password` | string | Required, new-password rules |

`200 OK`

```json
{ "message": "Your password has been changed. You can now log in." }
```

| Status | Error |
| --- | --- |
| 400 | Field errors, or `This reset link is invalid or has expired. Please request a new one.` |

---

## Settings

All Settings routes need a login and act on the logged-in lawyer only.

### GET /api/settings/profile

`200 OK`

```json
{
  "profile": {
    "id": "cmus3skb6…",
    "name": "Adv. Postman Tester",
    "email": "postman.tester+casemate1791014504274@example.com",
    "phone": "+919000000000",
    "barCouncilNumber": "MAH/0000/2026"
  }
}
```

### PATCH /api/settings/profile

Updates any of the three fields. The email is the login and can't be changed: an
`email` field in the body is ignored.

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | Optional, 1-100 characters |
| `phone` | string | Optional, Indian mobile (SMS reminders go to this number) |
| `barCouncilNumber` | string | Optional, 1-50 characters |

At least one field is required; an empty body gets `400` with `fields: { "_": "Nothing to update" }`.

```json
{ "name": "Adv. Postman Tester", "phone": "098220-12345", "barCouncilNumber": "MAH/0001/2026" }
```

`200 OK`: `{ "profile": { …, "phone": "+919822012345" } }`. `400` for field errors.

### POST /api/settings/password

Changes the password. Every other session is logged out. This session continues with a
new cookie.

| Field | Type | Rules |
| --- | --- | --- |
| `currentPassword` | string | Required (`Enter your current password`), at most 200 characters |
| `newPassword` | string | Required, new-password rules, different from the current one |

```json
{ "currentPassword": "Postman-test-2026", "newPassword": "Postman-test-2026-new1" }
```

`200 OK`

```json
{ "message": "Your password has been changed. Other devices have been logged out." }
```

| Status | Error |
| --- | --- |
| 400 | `Your current password is not correct.` with `fields.currentPassword: "This is not your current password"` |
| 400 | `Choose a new password that is different from the current one.` |
| 429 | `Too many attempts with a wrong password. Please wait 15 minutes and try again.` (10 failures per 15 minutes per account) |

### GET /api/settings/reminders

`200 OK`

```json
{
  "preferences": {
    "emailEnabled": true,
    "smsEnabled": true,
    "dayBeforeEnabled": true,
    "twoHourEnabled": true,
    "dailySummaryEnabled": true,
    "dailySummaryTime": "07:00",
    "missingOutcomeNudgeEnabled": true
  }
}
```

### PATCH /api/settings/reminders

Updates any of the preferences, then rebuilds the **pending** reminders of all the
lawyer's current hearings to match, in the same transaction.

- A reminder that no longer fits is cancelled.
- A missing one is created only if its send time is still ahead.
- Each case's own reminder settings still win.
- Sent, sending and failed reminders are never touched.

| Field | Type | Rules |
| --- | --- | --- |
| `emailEnabled`, `smsEnabled` | boolean | Optional: the two channels |
| `dayBeforeEnabled` | boolean | Optional: 24 hours before (email and SMS) |
| `twoHourEnabled` | boolean | Optional: 2 hours before (SMS) |
| `dailySummaryEnabled` | boolean | Optional: the morning summary (email) |
| `dailySummaryTime` | string | Optional, `HH:mm` IST on the quarter hour (`00`, `15`, `30`, `45`) |
| `missingOutcomeNudgeEnabled` | boolean | Optional: 6 PM nudge on a hearing day (email) |

At least one field is required (`fields._: "Nothing to update"` otherwise).

```json
{ "emailEnabled": false, "smsEnabled": false }
```

`200 OK`. `upcomingHearings` is how many future scheduled hearings the lawyer has:

```json
{
  "preferences": {
    "emailEnabled": false,
    "smsEnabled": false,
    "dayBeforeEnabled": true,
    "twoHourEnabled": true,
    "dailySummaryEnabled": true,
    "dailySummaryTime": "07:00",
    "missingOutcomeNudgeEnabled": true
  },
  "upcomingHearings": 0
}
```

`400`, for example `dailySummaryTime: "Choose a time on the quarter hour, for example 07:00 or 07:15"`.

### GET /api/settings/billing

`200 OK`: `{ "billing": { "defaultHourlyRatePaise": 200000 } }`

### PATCH /api/settings/billing

Sets the default hourly rate, used for clients without their own rate. It applies to
time logged from now on: each time entry keeps the rate it was created with.

| Field | Type | Rules |
| --- | --- | --- |
| `defaultHourlyRatePaise` | integer | Required, hourly-rate rules |

```json
{ "defaultHourlyRatePaise": 200000 }
```

`200 OK`: `{ "billing": { "defaultHourlyRatePaise": 200000 } }`. `400` for field errors.

### POST /api/settings/test-reminder

📨 **Sends a real email and a real SMS** to the lawyer's own address and mobile, right
away.

The two results are reported separately. A failure is still a `200`, with a plain-English
reason. No body is needed. **Limit:** 5 an hour per account.

`200 OK`

```json
{
  "email": { "status": "sent", "to": "priya@example.com" },
  "sms": {
    "status": "failed",
    "to": "+919822012345",
    "reason": "SMS could not be sent: sending is not set up yet (see server settings)"
  }
}
```

`429 You can send 5 test reminders an hour. Please try again later.`

### GET /api/settings/export

Downloads everything the lawyer owns as a JSON file:

```http
Content-Disposition: attachment; filename="casemate-data-2026-10-03.json"
```

The file holds `profile` (no password data), `clients`, `clientNotes`, `cases`,
`hearings`, `reminders`, `timeEntries` and `invoices`:

```json
{
  "exportedAt": "2026-10-03T08:01:48.005Z",
  "notes": "CaseMate data export. Times are UTC (ISO 8601); amounts are in paise (1 rupee = 100 paise).",
  "profile": { "id": "cmus3skb6…", "name": "Adv. Postman Tester", "email": "…", "…": "…" },
  "clients": [],
  "clientNotes": [],
  "cases": [],
  "hearings": [],
  "reminders": [],
  "timeEntries": [],
  "invoices": []
}
```

### DELETE /api/settings/account

Deletes the lawyer and all their data in one transaction (time entries, invoices,
reminders, hearings, cases, notes, clients, then the account), and logs them out. This
can't be undone.

| Field | Type | Rules |
| --- | --- | --- |
| `email` | string | Required; must be the account email (any case) |
| `password` | string | Required; the current password |

```json
{ "email": "postman.tester+casemate1791014504274@example.com", "password": "Postman-test-2026-new1" }
```

`200 OK`, with the cookie cleared:

```json
{ "message": "Your account and all its data have been deleted." }
```

| Status | Error |
| --- | --- |
| 400 | `The email you typed does not match your account.` (`fields.email`) |
| 400 | `Your current password is not correct.` (`fields.password`) |
| 429 | Wrong-password limit, as for the password change |

---

## Clients

### GET /api/clients

Lists the lawyer's clients by name, with their active case count and next hearing.

| Query | Type | Rules |
| --- | --- | --- |
| `search` | string | Optional, at most 100 characters; matches name, phone or email |

```http
GET /api/clients?search=Gupta
```

`200 OK`

```json
{
  "clients": [
    {
      "id": "cmus3smzk…",
      "name": "Ramesh Gupta",
      "phone": "+919822011223",
      "email": "ramesh.gupta@example.com",
      "preferredContact": "WHATSAPP",
      "activeCaseCount": 0,
      "nextHearingAt": null
    }
  ]
}
```

### POST /api/clients

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | Required, 1-191 characters (`Enter the client's name`) |
| `phone` | string | Required, Indian mobile |
| `email` | string or null | Optional, valid email; `""` is stored as `null` |
| `address` | string or null | Optional, at most 1000 characters |
| `preferredContact` | `PHONE`, `WHATSAPP` or `EMAIL` | Optional, default `PHONE`; `EMAIL` needs an email (`Add an email address, or choose another way to contact this client`) |
| `languages` | string or null | Optional, at most 191 characters |
| `hourlyRatePaise` | integer or null | Optional, hourly-rate rules; `null` uses the lawyer's default |

```json
{
  "name": "Ramesh Gupta",
  "phone": "98220 11223",
  "email": "ramesh.gupta@example.com",
  "address": "12, Shanti Nagar, Kothrud, Pune 411038",
  "preferredContact": "WHATSAPP",
  "languages": "Marathi, Hindi",
  "hourlyRatePaise": 300000
}
```

`201 Created`

```json
{
  "client": {
    "id": "cmus3smzk…",
    "lawyerId": "cmus3skb6…",
    "name": "Ramesh Gupta",
    "phone": "+919822011223",
    "email": "ramesh.gupta@example.com",
    "address": "12, Shanti Nagar, Kothrud, Pune 411038",
    "preferredContact": "WHATSAPP",
    "languages": "Marathi, Hindi",
    "hourlyRatePaise": 300000,
    "createdAt": "2026-10-03T08:01:48.129Z",
    "updatedAt": "2026-10-03T08:01:48.129Z"
  }
}
```

`400` example:

```json
{
  "error": "Please check the highlighted fields.",
  "fields": {
    "name": "Enter the client's name",
    "phone": "Enter a valid Indian mobile number, for example 98765 43210",
    "email": "Enter a valid email address"
  }
}
```

### GET /api/clients/:id

The client profile: contact details, notes (newest first), cases with their next
hearing, and a billing summary. Drafts are not counted in the billing summary;
`overduePaise` is sent invoices past their due date.

`200 OK`

```json
{
  "client": {
    "id": "cmus3smzk…",
    "name": "Ramesh Gupta",
    "phone": "+919822011223",
    "…": "…",
    "notes": [],
    "cases": [
      {
        "id": "cmus3sobg…",
        "title": "Gupta vs. Mehta Builders",
        "caseNumber": "RCS/412/2026",
        "courtName": "Civil Court (Senior Division), Pune",
        "status": "ACTIVE",
        "nextHearingAt": "2026-10-05T05:00:00.000Z"
      }
    ],
    "billing": {
      "billedPaise": 0,
      "paidPaise": 0,
      "duePaise": 0,
      "overduePaise": 0,
      "unbilledPaise": 0
    }
  }
}
```

`404 Client not found.`

### PUT /api/clients/:id

Replaces the client's details. The body and rules are the same as for `POST /api/clients`.
`200 OK`: `{ "client": { … } }`. `400` for field errors; `404 Client not found.`

### DELETE /api/clients/:id

Deletes a client with no cases and no invoices, together with their notes.

`204 No Content`

| Status | Error |
| --- | --- |
| 404 | `Client not found.` |
| 409 | `This client still has 2 cases and 1 invoice, so they cannot be deleted. Their records are kept for your billing history.` |

---

## Client notes

### POST /api/clients/:id/notes

| Field | Type | Rules |
| --- | --- | --- |
| `text` | string | Required, 1-5000 characters (`Write the note`) |
| `notedAt` | string | Optional ISO 8601 date-time with offset; default now |

```json
{ "text": "Called about the sale agreement; will bring the original." }
```

`201 Created`

```json
{
  "note": {
    "id": "cmus3snq4…",
    "lawyerId": "cmus3skb6…",
    "clientId": "cmus3smzk…",
    "notedAt": "2026-10-03T08:01:49.083Z",
    "text": "Called about the sale agreement; will bring the original.",
    "createdAt": "2026-10-03T08:01:49.085Z",
    "updatedAt": "2026-10-03T08:01:49.085Z"
  }
}
```

`400` for field errors; `404 Client not found.`

### DELETE /api/clients/:id/notes/:noteId

`204 No Content`. `404 Note not found.`

---

## Cases

### The case fields

| Field | Type | Rules |
| --- | --- | --- |
| `clientId` | string | Required, one of the lawyer's clients (`Choose one of your clients`) |
| `title` | string | Required, 1-191 characters |
| `caseNumber` | string | Required, 1-100 characters, unique per lawyer |
| `caseType` | string or null | Optional, at most 191 characters |
| `courtName` | string | Required, 1-191 characters (`Enter the court`) |
| `courtroom` | string or null | Optional, at most 100 characters |
| `judge`, `opposingParty`, `opposingCounsel` | string or null | Optional, at most 191 characters each |
| `notes` | string or null | Optional, at most 5000 characters |
| `emailReminderOverride`, `smsReminderOverride`, `dayBeforeReminderOverride`, `twoHourReminderOverride` | boolean or null | Optional. `null` follows the lawyer's settings; `true` or `false` overrides them for this case |

A **hearing slot** is `{ "date": "yyyy-MM-dd", "time": "HH:mm", "purpose": string|null (≤191), "notes": string|null (≤5000) }`.
The date and time are IST, and a new hearing must be in the future.

### GET /api/cases

Cases with their next scheduled hearing, soonest first. Cases with no next date come
after them.

| Query | Type | Rules |
| --- | --- | --- |
| `status` | `ACTIVE`, `CLOSED` or `ALL` | Optional, default `ACTIVE` |
| `search` | string | Optional, at most 100 characters; matches title, number, court, opposing party or client name |
| `clientId` | string | Optional cuid |

```http
GET /api/cases?status=ALL&search=Mehta
```

`200 OK`

```json
{
  "cases": [
    {
      "id": "cmus3sobg…",
      "title": "Gupta vs. Mehta Builders",
      "caseNumber": "RCS/412/2026",
      "caseType": "Civil suit",
      "courtName": "Civil Court (Senior Division), Pune",
      "courtroom": "Room 4",
      "status": "ACTIVE",
      "client": { "id": "cmus3smzk…", "name": "Ramesh Gupta" },
      "nextHearing": {
        "id": "cmus3sobm…",
        "scheduledAt": "2026-10-04T05:00:00.000Z",
        "purpose": "Evidence"
      }
    }
  ]
}
```

### POST /api/cases

Adds a case with its first hearing, as on the Add Case form, and plans the hearing's
reminders straight away. Body: the case fields plus `firstHearing` (a hearing slot).

```json
{
  "clientId": "cmus3smzk…",
  "title": "Gupta vs. Mehta Builders",
  "caseNumber": "RCS/412/2026",
  "caseType": "Civil suit",
  "courtName": "Civil Court (Senior Division), Pune",
  "courtroom": "Room 4",
  "opposingParty": "Mehta Builders Pvt. Ltd.",
  "firstHearing": {
    "date": "2026-10-04",
    "time": "10:30",
    "purpose": "Evidence",
    "notes": "Bring the original sale agreement"
  }
}
```

`201 Created`

```json
{
  "case": {
    "id": "cmus3sobg…",
    "lawyerId": "cmus3skb6…",
    "clientId": "cmus3smzk…",
    "title": "Gupta vs. Mehta Builders",
    "caseNumber": "RCS/412/2026",
    "caseType": "Civil suit",
    "courtName": "Civil Court (Senior Division), Pune",
    "courtroom": "Room 4",
    "judge": null,
    "opposingParty": "Mehta Builders Pvt. Ltd.",
    "opposingCounsel": null,
    "notes": null,
    "status": "ACTIVE",
    "emailReminderOverride": null,
    "smsReminderOverride": null,
    "dayBeforeReminderOverride": null,
    "twoHourReminderOverride": null,
    "createdAt": "2026-10-03T08:01:49.852Z",
    "updatedAt": "2026-10-03T08:01:49.852Z"
  }
}
```

| Status | Error |
| --- | --- |
| 400 | Field errors; `Choose one of your clients.` for another lawyer's client |
| 400 | `The hearing date and time must be in the future.` with `fields["firstHearing.date"]: "Choose a date and time in the future"` |
| 409 | `You already have a case with this number.` (`fields.caseNumber`) |

### GET /api/cases/:id

The case with its client, every hearing (newest first) with its reminders (cancelled
ones left out), and time totals.

`200 OK` (trimmed)

```json
{
  "case": {
    "id": "cmus3sobg…",
    "title": "Gupta vs. Mehta Builders",
    "status": "ACTIVE",
    "…": "…",
    "client": {
      "id": "cmus3smzk…",
      "name": "Ramesh Gupta",
      "phone": "+919822011223",
      "email": "ramesh.gupta@example.com",
      "hourlyRatePaise": 300000
    },
    "hearings": [
      {
        "id": "cmus3sobm…",
        "scheduledAt": "2026-10-04T05:00:00.000Z",
        "purpose": "Evidence",
        "notes": "Bring the original sale agreement",
        "status": "SCHEDULED",
        "outcome": null,
        "outcomeNotes": null,
        "timeSpentMinutes": null,
        "loggedAt": null,
        "reminders": [
          {
            "id": "cm…",
            "type": "DAY_BEFORE",
            "channel": "EMAIL",
            "sendAt": "2026-10-03T05:00:00.000Z",
            "status": "PENDING",
            "attempts": 0,
            "lastError": null,
            "sentAt": null
          }
        ]
      }
    ],
    "time": { "totalMinutes": 0, "totalPaise": 0, "unbilledMinutes": 0, "unbilledPaise": 0 }
  }
}
```

Reminder `type` is `DAY_BEFORE`, `TWO_HOUR`, `DAILY_SUMMARY` or `MISSING_OUTCOME`.
`channel` is `EMAIL` or `SMS`. `status` is `PENDING`, `SENDING`, `SENT`, `FAILED` or
`CANCELLED`. `404 Case not found.`

### PUT /api/cases/:id

Replaces the case fields, and sets `status` to `ACTIVE` or `CLOSED`. Changing the status
or the reminder overrides re-plans the case's pending reminders; closing a case cancels
them.

```json
{ "…case fields…": "…", "judge": "Hon. A. R. Deshpande", "status": "ACTIVE" }
```

`200 OK`: `{ "case": { … } }`. Errors: `400` field errors or `Choose one of your clients.`,
`404 Case not found.`, `409 You already have a case with this number.`

### DELETE /api/cases/:id

Deletes a case and its hearings and reminders, if it has no time entries.

`204 No Content`

| Status | Error |
| --- | --- |
| 404 | `Case not found.` |
| 409 | `This case has time entries, so it cannot be deleted. Close it instead to keep your billing history.` |

### POST /api/cases/:id/hearings

Schedules another hearing. Body: a hearing slot.

```json
{ "date": "2026-10-17", "time": "11:00", "purpose": "Arguments", "notes": null }
```

`201 Created`

```json
{
  "hearing": {
    "id": "cmus3souv…",
    "lawyerId": "cmus3skb6…",
    "caseId": "cmus3sobg…",
    "scheduledAt": "2026-10-17T05:30:00.000Z",
    "purpose": "Arguments",
    "notes": null,
    "status": "SCHEDULED",
    "outcome": null,
    "outcomeNotes": null,
    "timeSpentMinutes": null,
    "loggedAt": null,
    "createdAt": "2026-10-03T08:01:50.552Z",
    "updatedAt": "2026-10-03T08:01:50.552Z"
  }
}
```

| Status | Error |
| --- | --- |
| 400 | `The hearing date and time must be in the future.` (`fields["hearing.date"]`) |
| 404 | `Case not found.` |
| 409 | `This case is closed. Reopen it before adding a hearing.` |

---

## Hearings and hearing log

### GET /api/hearings

Hearings in an IST date range, in time order: those with an outcome, and scheduled ones
on open cases. Cancelled hearings are left out.

| Query | Type | Rules |
| --- | --- | --- |
| `from`, `to` | `yyyy-MM-dd` | Required IST days; `to` not before `from` (`The end date is before the start date`); at most 62 days apart (`Choose a range of at most two months`) |

```http
GET /api/hearings?from=2026-10-03&to=2026-11-02
```

`200 OK`

```json
{
  "hearings": [
    {
      "id": "cmus3sobm…",
      "scheduledAt": "2026-10-04T05:00:00.000Z",
      "purpose": "Evidence",
      "status": "SCHEDULED",
      "outcome": null,
      "case": {
        "id": "cmus3sobg…",
        "title": "Gupta vs. Mehta Builders",
        "caseNumber": "RCS/412/2026",
        "courtName": "Civil Court (Senior Division), Pune",
        "courtroom": "Room 4",
        "client": { "id": "cmus3smzk…", "name": "Ramesh Gupta" }
      }
    }
  ]
}
```

### GET /api/hearings/missing-outcome

Scheduled hearings of open cases that are past their nudge time (6 PM IST on the day,
or an hour after a later hearing) with no outcome logged.

`200 OK`

```json
{
  "hearings": [
    {
      "id": "cm…",
      "scheduledAt": "…",
      "purpose": "…",
      "case": { "id": "…", "title": "…", "caseNumber": "…", "courtName": "…" }
    }
  ]
}
```

### PUT /api/hearings/:id

Moves a scheduled hearing or edits its purpose and notes. Body: a hearing slot. A
changed date and time must be in the future (keeping the same time is allowed, to fix
the notes). Reminders for the old time are cancelled, and new ones planned.

```json
{ "date": "2026-10-05", "time": "10:30", "purpose": "Evidence", "notes": "Bring the original sale agreement" }
```

`200 OK`: `{ "hearing": { …, "scheduledAt": "2026-10-05T05:00:00.000Z" } }`

| Status | Error |
| --- | --- |
| 400 | `The hearing date and time must be in the future.` (`fields["hearing.date"]`) |
| 404 | `Hearing not found.` |
| 409 | `Only a scheduled hearing can be changed.` |

### POST /api/hearings/:id/cancel

Cancels a scheduled hearing. Its reminders are cancelled. No body is needed.

`200 OK`: `{ "hearing": { …, "status": "CANCELLED" } }`. Errors: `404 Hearing not found.`,
`409 Only a scheduled hearing can be cancelled.`

### POST /api/hearings/:id/outcome

Logs what happened, in one transaction:

1. The hearing is marked `COMPLETED` with its outcome, and its pending reminders are
   cancelled.
2. Time spent becomes a billable time entry at the client's rate (or the default),
   linked to the hearing.
3. A next hearing is scheduled with fresh reminders.
4. The case is closed, if asked.

| Field | Type | Rules |
| --- | --- | --- |
| `outcome` | `ADJOURNED`, `HEARD`, `ORDER_RESERVED`, `DISPOSED` or `OTHER` | Required (`Choose what happened`) |
| `outcomeNotes` | string or null | Optional, at most 5000 characters |
| `timeSpentMinutes` | integer or null | Optional, 0-1440 |
| `nextHearing` | hearing slot or null | Optional; must be after this hearing (`Choose a date after this hearing`) |
| `closeCase` | boolean | Optional, default `false`; not with a `nextHearing` (`A case with a next hearing cannot be closed`) |

```json
{
  "outcome": "ADJOURNED",
  "outcomeNotes": "Prosecution sought time to file a reply.",
  "timeSpentMinutes": 90,
  "nextHearing": { "date": "2026-10-10", "time": "11:00", "purpose": "Reply and arguments", "notes": null },
  "closeCase": false
}
```

`200 OK` (trimmed)

```json
{
  "hearing": {
    "id": "cmus3spbo…",
    "status": "COMPLETED",
    "outcome": "ADJOURNED",
    "outcomeNotes": "Prosecution sought time to file a reply.",
    "timeSpentMinutes": 90,
    "loggedAt": "2026-10-03T08:01:51.430Z",
    "…": "…"
  },
  "nextHearing": { "id": "cmus3spjy…", "scheduledAt": "2026-10-10T05:30:00.000Z", "status": "SCHEDULED", "…": "…" },
  "timeEntry": {
    "id": "cmus3spjs…",
    "hearingId": "cmus3spbo…",
    "workDate": "2026-10-03T00:00:00.000Z",
    "minutes": 90,
    "description": "Hearing: Adjourned (Bail hearing)",
    "ratePaise": 300000,
    "amountPaise": 450000,
    "invoiceId": null,
    "…": "…"
  }
}
```

`nextHearing` and `timeEntry` are `null` when not given.

| Status | Error |
| --- | --- |
| 400 | Field errors; `The next date must be after this hearing.` |
| 404 | `Hearing not found.` |
| 409 | `The outcome of this hearing has already been recorded.` |
| 409 | `You can record the outcome on the day of the hearing or later.` |

### PUT /api/hearings/:id/outcome

Corrects a logged outcome: what happened, the notes and the time spent. The hearing's
time entry follows:

- It is updated at its original rate.
- It is created if there was none.
- It is deleted if the time is now 0.

The time can't change once the entry is on an invoice. The other fields can still be
corrected.

| Field | Type | Rules |
| --- | --- | --- |
| `outcome` | as above | Required |
| `outcomeNotes` | string or null | Optional, at most 5000 characters |
| `timeSpentMinutes` | integer or null | Optional, 0-1440 |

```json
{ "outcome": "HEARD", "outcomeNotes": "Arguments heard in part.", "timeSpentMinutes": 120 }
```

`200 OK`: `{ "hearing": { …, "outcome": "HEARD", "timeSpentMinutes": 120 }, "timeEntry": { …, "minutes": 120, "ratePaise": 300000, "amountPaise": 600000 } }`

| Status | Error |
| --- | --- |
| 404 | `Hearing not found.` |
| 409 | `Only a hearing with a logged outcome can be edited.` |
| 409 | `This time is on invoice INV-001, which has been paid, so it can't be changed.` (also in `fields.timeSpentMinutes`); for a draft: `This time is on draft invoice INV-001. Delete that draft to change it.` |

---

## Reminders

Reminders are created and sent by the server: planned when a hearing is saved, and sent
by the scheduler every 5 minutes. They are listed on each hearing in
`GET /api/cases/:id`, and failed ones appear on the dashboard.

### POST /api/reminders/:id/retry

Puts a `FAILED` reminder back in the queue, with its attempts reset; the next scheduler
run sends it. This is allowed only while its hearing is still scheduled, in the future
and at the time the reminder was planned for. A daily summary can be retried on its own
day while a hearing is still ahead. No body is needed.

`200 OK`

```json
{ "reminder": { "id": "cm…", "status": "PENDING", "attempts": 0, "sendAt": "2026-10-03T05:00:00.000Z" } }
```

| Status | Error |
| --- | --- |
| 404 | `Reminder not found.` |
| 409 | `Only a reminder that failed can be retried.` |
| 409 | `This reminder can't be sent again. <reason>`, for example `The hearing has already taken place.` or `The outcome of the hearing has been logged.` |

---

## Dashboard

### GET /api/dashboard

Everything on the dashboard, in IST:

- `todayHearings`: every hearing today, in time order.
- `next7Days`: scheduled hearings from tomorrow to 7 days ahead, counted per day.
- `needsAttention`:
  - `missingOutcome`: hearings past their time with no outcome logged
  - `failedReminders`: reminders that failed in the last 7 days, each with a
    plain-English reason and whether it can be retried
  - `overdueInvoices`: sent invoices past their due date
- `counts.unpaidInvoices` and `counts.unpaidPaise`: sent invoices not yet paid.

`200 OK` (trimmed)

```json
{
  "today": "2026-10-03",
  "hasCases": true,
  "counts": { "today": 1, "next7Days": 2, "needNextDate": 0, "unpaidInvoices": 0, "unpaidPaise": 0 },
  "todayHearings": [
    {
      "id": "cmus3spbo…",
      "scheduledAt": "2026-10-03T18:29:00.000Z",
      "purpose": "Bail hearing",
      "status": "COMPLETED",
      "outcome": "HEARD",
      "case": {
        "id": "cmus3spab…",
        "title": "State vs. Kulkarni",
        "caseNumber": "BA/77/2026",
        "courtName": "Sessions Court, Pune",
        "courtroom": "Room 4",
        "client": { "id": "cmus3smzk…", "name": "Ramesh Gupta" }
      }
    }
  ],
  "next7Days": {
    "total": 2,
    "days": [
      { "date": "2026-10-04", "count": 0 },
      { "date": "2026-10-05", "count": 1 },
      { "date": "2026-10-06", "count": 0 },
      { "date": "2026-10-07", "count": 0 },
      { "date": "2026-10-08", "count": 0 },
      { "date": "2026-10-09", "count": 0 },
      { "date": "2026-10-10", "count": 1 }
    ]
  },
  "needsAttention": { "missingOutcome": [], "failedReminders": [], "overdueInvoices": [] }
}
```

A failed reminder looks like this:

```json
{
  "id": "cm…",
  "type": "DAY_BEFORE",
  "channel": "EMAIL",
  "failedAt": "…",
  "reason": "Email could not be sent: mail server connection failed",
  "detail": "Connection timeout",
  "summaryDate": null,
  "hearing": { "id": "…", "scheduledAt": "…" },
  "case": { "id": "…", "title": "…", "caseNumber": "…" },
  "canRetry": true,
  "retryBlockedReason": null
}
```

An overdue invoice looks like this:

```json
{
  "id": "…",
  "number": "INV-001",
  "totalPaise": 300000,
  "dueDate": "2026-10-02",
  "daysOverdue": 1,
  "client": { "id": "…", "name": "…" }
}
```

---

## Calendar

### GET /api/calendar

One month of hearings (same rules as `GET /api/hearings`). The month runs from midnight
IST on its first day to midnight IST after its last. Each hearing also carries its IST
`date` and `time`.

| Query | Type | Rules |
| --- | --- | --- |
| `month` | `YYYY-MM` | Required (`Choose a month in the form YYYY-MM, for example 2026-10`) |

```http
GET /api/calendar?month=2026-10
```

`200 OK` (trimmed)

```json
{
  "month": "2026-10",
  "hearings": [
    {
      "id": "cmus3spbo…",
      "scheduledAt": "2026-10-03T18:29:00.000Z",
      "purpose": "Bail hearing",
      "status": "COMPLETED",
      "outcome": "HEARD",
      "case": { "id": "cmus3spab…", "title": "State vs. Kulkarni", "…": "…" },
      "date": "2026-10-03",
      "time": "23:59"
    }
  ]
}
```

`400` for a missing or malformed month.

---

## Time entries

A time entry stores the hourly rate at the moment it is created: the client's own rate,
or else the lawyer's default. `amountPaise = round(ratePaise × minutes / 60)`, to the
nearest paisa, calculated by the server. An entry on an invoice (draft, sent or paid) is
locked.

### The time entry object

```json
{
  "id": "cmus3spys…",
  "workDate": "2026-10-03",
  "minutes": 60,
  "description": "Drafting the written statement",
  "ratePaise": 300000,
  "amountPaise": 300000,
  "hearingId": null,
  "createdAt": "2026-10-03T08:01:51.989Z",
  "case": {
    "id": "cmus3sobg…",
    "title": "Gupta vs. Mehta Builders",
    "caseNumber": "RCS/412/2026",
    "client": { "id": "cmus3smzk…", "name": "Ramesh Gupta" }
  },
  "invoice": null
}
```

When invoiced, `invoice` is
`{ "id": "…", "number": "INV-001", "status": "SENT", "displayStatus": "OVERDUE" }`.

### GET /api/time-entries

Newest work date first.

| Query | Type | Rules |
| --- | --- | --- |
| `clientId`, `caseId` | string | Optional cuids |
| `from`, `to` | `yyyy-MM-dd` | Optional IST days on `workDate`; `to` not before `from` |
| `billed` | `all`, `billed` or `unbilled` | Optional, default `all` |

```http
GET /api/time-entries?clientId=cmus3smzk…&billed=unbilled
```

`200 OK`: `{ "timeEntries": [ { … }, … ] }`

### GET /api/time-entries/rate

The rate new time on a case would use, so it can be shown before saving.

| Query | Type | Rules |
| --- | --- | --- |
| `caseId` | string | Required cuid (`Choose a case`) |

`200 OK`

```json
{ "rate": { "ratePaise": 300000, "source": "client", "clientName": "Ramesh Gupta" } }
```

`source` is `client` or `default`. `404 Case not found.`

### POST /api/time-entries

| Field | Type | Rules |
| --- | --- | --- |
| `caseId` | string | Required, one of the lawyer's cases |
| `workDate` | `yyyy-MM-dd` | Required (IST day) |
| `minutes` | integer | Required, 1-1440 (`Enter at least 1 minute`, `One entry can be at most 24 hours`) |
| `description` | string | Required, 1-1000 characters (`Describe the work done`); shown on the invoice |

`ratePaise` and `amountPaise` in the body are ignored.

```json
{ "caseId": "cmus3sobg…", "workDate": "2026-10-03", "minutes": 60, "description": "Drafting the written statement" }
```

`201 Created`: `{ "timeEntry": { …, "ratePaise": 300000, "amountPaise": 300000 } }`.
Errors: `400` field errors, `404 Case not found.`

### PUT /api/time-entries/:id

Changes the date, minutes and description. The case and the rate stay as they were,
and the amount is recalculated. For an entry made by a hearing outcome, the hearing's
time spent changes too.

```json
{ "workDate": "2026-10-03", "minutes": 90, "description": "Drafting the written statement" }
```

`200 OK`: `{ "timeEntry": { …, "minutes": 90, "amountPaise": 450000 } }`

| Status | Error |
| --- | --- |
| 400 | Field errors |
| 404 | `Time entry not found.` |
| 409 | `This time is on draft invoice INV-002. Delete that draft to change it.` |
| 409 | `This time is on invoice INV-001, which has been sent, so it can't be changed.` (or `paid`) |

### DELETE /api/time-entries/:id

`204 No Content`. Errors are the same as for editing, for example
`409 This time is on invoice INV-001, which has been paid, so it can't be changed.`

---

## Invoices

An invoice bills some of one client's unbilled time. Its total is the sum of the
entries' stored amounts.

- **Numbering:** invoices are numbered per lawyer: `INV-001`, `INV-002` and so on.
  Numbers are given out under a database lock, so two invoices created at once never
  share or skip a number. Deleting the latest draft frees its number.
- **Statuses:** `status` is `DRAFT`, `SENT` or `PAID`. `displayStatus` adds `OVERDUE`,
  which is calculated, not stored: a sent invoice whose due date is before today in
  IST. Drafts are never overdue.

### The invoice object

```json
{
  "id": "cmus3sqhu…",
  "number": "INV-001",
  "totalPaise": 1050000,
  "status": "DRAFT",
  "sentAt": null,
  "paidAt": null,
  "notes": "Payable by bank transfer within 15 days.",
  "createdAt": "2026-10-03T08:01:52.675Z",
  "client": { "id": "cmus3smzk…", "name": "Ramesh Gupta", "email": "ramesh.gupta@example.com" },
  "issueDate": "2026-10-03",
  "dueDate": "2026-10-18",
  "entryCount": 2,
  "displayStatus": "DRAFT"
}
```

Single-invoice responses also include `entries`:

```json
[
  {
    "id": "…",
    "workDate": "2026-10-03",
    "minutes": 90,
    "description": "…",
    "ratePaise": 300000,
    "amountPaise": 450000,
    "case": { "id": "…", "title": "…", "caseNumber": "…" }
  }
]
```

### GET /api/invoices

Newest issue date first.

| Query | Type | Rules |
| --- | --- | --- |
| `status` | `DRAFT`, `SENT`, `PAID` or `OVERDUE` | Optional |
| `clientId` | string | Optional cuid |

`200 OK`: `{ "invoices": [ { … } ] }` (no `entries`)

### POST /api/invoices

Creates a draft from unbilled time of one client, in one transaction.

| Field | Type | Rules |
| --- | --- | --- |
| `clientId` | string | Required, one of the lawyer's clients |
| `timeEntryIds` | string[] | Required, 1-500 ids of that client's unbilled entries |
| `issueDate` | `yyyy-MM-dd` | Optional, default today (IST) |
| `dueDate` | `yyyy-MM-dd` | Optional, default issue date + 15 days; not before the issue date |
| `notes` | string or null | Optional, at most 2000 characters; printed on the PDF |

```json
{
  "clientId": "cmus3smzk…",
  "timeEntryIds": ["cmus3spys…", "cmus3spjs…"],
  "notes": "Payable by bank transfer within 15 days."
}
```

`201 Created`: `{ "invoice": { …, "number": "INV-001", "totalPaise": 1050000, "dueDate": "2026-10-18", "entries": [ … ] } }`

| Status | Error |
| --- | --- |
| 400 | Field errors; `The due date cannot be before the issue date.` |
| 400 | `This invoice total is too large. Split the time into two invoices.` |
| 404 | `Client not found.` |
| 409 | `Some of the chosen time entries are already on an invoice or belong to another client. Refresh and choose again.` |

### GET /api/invoices/:id

`200 OK`: `{ "invoice": { …, "entries": [ … ] } }`. `404 Invoice not found.`

### PATCH /api/invoices/:id

Edits the due date and notes, until the invoice is paid.

| Field | Type | Rules |
| --- | --- | --- |
| `dueDate` | `yyyy-MM-dd` | Required; not before the issue date |
| `notes` | string or null | Optional, at most 2000 characters |

```json
{ "dueDate": "2026-11-02", "notes": "Payable by bank transfer within 30 days." }
```

`200 OK`: `{ "invoice": { … } }`. Errors: `400`, `404 Invoice not found.`,
`409 This invoice has been paid, so it can no longer be changed.`

### DELETE /api/invoices/:id

Deletes a **draft**. Its time entries go back to the unbilled list.

`204 No Content`

| Status | Error |
| --- | --- |
| 404 | `Invoice not found.` |
| 409 | `Invoice INV-001 has been sent, so it can't be deleted.` (or `paid`) |

### GET /api/invoices/:id/pdf

Downloads the invoice as an A4 PDF. It shows:

- the lawyer's name, phone and Bar Council number
- the client's name and address
- the invoice number, issue date and due date
- a table of entries: date, case, work done, hours, amount
- the total in rupees with Indian digit grouping, and the notes

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="INV-001.pdf"
```

`404 Invoice not found.`

### POST /api/invoices/:id/send

📨 **Sends a real email**: the PDF, attached, to the client's email address.

The invoice becomes `SENT` only if the email actually went out. A sent invoice can be
emailed again. No body is needed.

`200 OK`: `{ "invoice": { …, "status": "SENT", "sentAt": "…" } }`

| Status | Error |
| --- | --- |
| 404 | `Invoice not found.` |
| 409 | `Ramesh Gupta has no email address. Add one to the client, or share the PDF another way and use "Mark as sent".` |
| 409 | `This invoice has already been paid.` |
| 502 | The reason, in plain English, e.g. `Email could not be sent: the secure connection to the mail server failed. The invoice is still a draft.` |

### POST /api/invoices/:id/mark-sent

Marks a draft as sent without emailing it, for an invoice shared another way (WhatsApp,
in person). An already-sent invoice is returned unchanged. No body is needed.

`200 OK`: `{ "invoice": { …, "status": "SENT", "sentAt": "2026-10-03T08:01:53.514Z" } }`.
Errors: `404 Invoice not found.`, `409 This invoice has already been paid.`

### POST /api/invoices/:id/mark-paid

Records payment (`paidAt` = now). This works from draft or sent; a paid invoice is
returned unchanged. No body is needed.

`200 OK`: `{ "invoice": { …, "status": "PAID", "paidAt": "2026-10-03T08:01:53.860Z" } }`.
`404 Invoice not found.`

---

## Billing summary

### GET /api/billing/summary

One month's billing, in IST:

| Figure | What it covers |
| --- | --- |
| `billed` | Invoices issued in the month that have been sent or paid (drafts are not billed yet) |
| `received` | Invoices marked paid during the month |
| `outstanding` | Of the month's billed invoices, what is still unpaid, and how much of that is overdue |
| `unbilled` | Time logged in the month that is on no invoice |

| Query | Type | Rules |
| --- | --- | --- |
| `month` | `YYYY-MM` | Required |

```http
GET /api/billing/summary?month=2026-10
```

`200 OK`

```json
{
  "summary": {
    "month": "2026-10",
    "billed": { "paise": 1050000, "invoices": 1 },
    "received": { "paise": 1050000, "invoices": 1 },
    "outstanding": { "paise": 0, "invoices": 0, "overduePaise": 0 },
    "unbilled": { "paise": 0, "minutes": 0, "entries": 0 }
  }
}
```

`400` for a missing or malformed month.
