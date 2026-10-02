# CaseMate

CaseMate is a web app for independent advocates in India. It keeps one reliable list of
cases and hearings, and sends automatic reminders by email and SMS before each hearing.
It also keeps clients' details, a log of what happened at each hearing with the next
date, and billing: time spent, invoices and payments. Each account belongs to one lawyer,
and every date is shown and entered in Indian Standard Time (IST).

## Features

- **Case diary:** cases with case number, court, courtroom, judge, opposing party and
  notes, each with its hearings.
- **Hearing reminders:**
  - a day-before reminder (24 hours before, by email and SMS)
  - a final reminder (2 hours before, by SMS)
  - a daily summary (7:00 AM by default)
  - a missing next-date nudge (6 PM on a hearing day with no outcome logged)

  A failed send is retried after 5, 10 and 15 minutes, then shown on the dashboard. A
  reminder is never sent twice.

- **Dashboard:**
  - today's hearings, the next 7 days and unpaid invoices
  - a "needs attention" list: missing next dates, failed reminders (with Retry) and
    overdue invoices
- **Calendar:** a month grid with hearing counts per day; on phones, a list grouped by
  day.
- **Client management:** contact details, the client's cases, call notes and a billing
  summary (billed, paid, due).
- **Hearing log with next-date tracking:** record the outcome, time spent and the next
  date in one step. Reminders for the new date are set up automatically.
- **Billing with time tracking:**
  - hourly rates per client, with a default rate
  - time entries that keep the rate they were logged at
  - invoices numbered INV-001, INV-002 and so on
  - A4 PDF invoices with the ₹ sign, which can be emailed to the client or marked as
    sent and paid
- **Settings:** profile, password change (logs out other devices), reminder preferences
  with a test reminder, and the default hourly rate.
- **Your data:** download everything as a JSON file, or delete the account and all its
  data.

## Screenshots

These were taken by `npm run screenshots`, which runs the app against the separate test
database and creates every record through the UI during the run.

| Dashboard                                    | Add a case                                        |
| -------------------------------------------- | ------------------------------------------------- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Add a case form](docs/screenshots/add-case.png) |

| Case page and hearing log                                     | Client profile                                         |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| ![Case page with hearing log](docs/screenshots/case-page.png) | ![Client profile](docs/screenshots/client-profile.png) |

| Billing                                       | Settings                                   |
| --------------------------------------------- | ------------------------------------------ |
| ![Billing page](docs/screenshots/billing.png) | ![Settings](docs/screenshots/settings.png) |

## Tech stack

| Part      | Tools                                                                                        | Role                                                         |
| --------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Client    | React 18, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query, React Hook Form, zod | The screens; talks only to the API                           |
| Server    | Node.js 20, Express 5, TypeScript, zod                                                       | The API: checks every request and applies the rules          |
| Database  | MySQL 8 with Prisma                                                                          | Stores everything; timestamps in UTC, money in integer paise |
| Auth      | bcrypt, JWT in an httpOnly cookie                                                            | Password hashing and login sessions                          |
| Reminders | node-cron, Nodemailer (SMTP), Twilio                                                         | Sends due reminders every 5 minutes by email and SMS         |
| PDFs      | PDFKit with the Noto Sans font                                                               | Invoice PDFs, including the ₹ sign                           |
| Testing   | Vitest, Supertest, Playwright                                                                | Unit, API and end-to-end tests against a real test database  |

## How it works

The browser only talks to the API. The API checks the logged-in lawyer and the input on
every request, and is the only part that reads or writes MySQL. Every query is filtered
by the lawyer's id, so one lawyer can never see another lawyer's records.

Reminder times are worked out and stored in MySQL as soon as a hearing is saved or moved.
The scheduler runs on its own clock, every 5 minutes. It claims the reminders that are
due, sends them, and records the result. It runs inside the API process when
`ENABLE_SCHEDULER=true`, and `npm run reminders:tick` runs one pass by hand. Reminders
live in the database, so nothing is lost when the server restarts. Claiming is done in
the database, so even two servers never send the same reminder twice.
The API uses the same mailer to email invoices, test reminders and password-reset links.

```mermaid
flowchart LR
  Browser["Browser<br/>React client"] -->|"/api requests"| API["Express API"]
  API -->|Prisma| DB[("MySQL 8")]
  Scheduler["Reminder scheduler<br/>every 5 minutes"] -->|"claims due reminders"| DB
  Scheduler -->|"email"| Mail["SMTP email"]
  Scheduler -->|"SMS"| SMS["Twilio SMS"]
```

The full design, with the screens, reminder rules and database tables, is in
[docs/design-document.md](docs/design-document.md).

## Project structure

| Folder                             | What lives there                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `client/src/pages`                 | One component per screen: dashboard, calendar, cases, clients, billing, settings, login |
| `client/src/features`              | API calls and TanStack Query hooks for each area                                        |
| `client/src/components`            | Shared UI: app shell and sidebar, form fields, cards, dialog                            |
| `client/src/lib`                   | Date (IST), money (₹) and validation helpers                                            |
| `server/src/routes`, `controllers` | API routes and their request handlers                                                   |
| `server/src/services`              | Business rules: cases, hearings, reminders, invoices, PDFs, settings                    |
| `server/src/validators`            | zod schemas for every request body, query and URL parameter                             |
| `server/src/jobs`                  | The reminder engine, the 5-minute scheduler and `reminders:tick`                        |
| `server/src/lib`                   | Environment, mailer, SMS provider, sessions, time and money helpers                     |
| `server/prisma`                    | Database schema and migrations                                                          |
| `server/assets/fonts`              | Noto Sans for the PDFs, with its licence (OFL)                                          |
| `server/tests`                     | Server tests (Vitest and Supertest)                                                     |
| `e2e`                              | Playwright end-to-end tests; `e2e/screenshots` makes the README screenshots             |
| `docs`                             | Design document and screenshots                                                         |

## Getting started on Windows

These steps were run in PowerShell on Windows 11, from a fresh clone of this repository.

### 1. Install the prerequisites

- **Node.js 20 or later.** `.nvmrc` names 20; the steps were also checked on Node 22.
  Check with `node -v`.
- **MySQL Server 8** from <https://dev.mysql.com/downloads/installer/>. Remember the
  `root` password you choose during setup.
- **Git** from <https://git-scm.com/download/win>.

### 2. Get the code and install packages

```powershell
git clone https://github.com/B-Ayushi/CaseMate.git
cd CaseMate
npm install
```

The repository is private, so ask the owner to add your GitHub account as a collaborator
first. `npm install` installs the client, the server and the test tools in one go, and
generates the Prisma client.

### 3. Create the two databases

CaseMate needs a development database and a separate test database. The tests empty the
test database, so it must never be the one you use.

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "CREATE DATABASE casemate CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE DATABASE casemate_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

Enter your MySQL `root` password when asked. You can also run the same two
`CREATE DATABASE` statements in MySQL Workbench.

### 4. Create `server/.env`

```powershell
Copy-Item server\.env.example server\.env
```

Open `server\.env` in any text editor. At minimum, set `DATABASE_URL`, `DATABASE_URL_TEST` and `JWT_SECRET` (see
[Environment variables](#environment-variables)). To make a long random `JWT_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Email and SMS can stay empty for now. The app still runs; sends fail with a clear "not
configured" message.

### 5. Create the tables

```powershell
cd server
npx prisma migrate deploy
cd ..
```

This creates the tables in the development database. The tests bring the test database
up to date by themselves.

### 6. Start the app

```powershell
npm run dev
```

This starts the API and the client together. Open:

- the app: <http://localhost:5173>
- the API health check: <http://localhost:4000/api/health>, which should show
  `{"status":"ok","database":"ok"}`

Create an account on the sign-up page. You land on the dashboard.

## Environment variables

All server settings live in `server/.env`. Copy them from
[server/.env.example](server/.env.example) and never commit the real file.

| Variable                | What it does                                                                            | Required                             | Where to get the value                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | Port of the API server                                                                  | No (default `4000`)                  | Any free port                                                                                                                                 |
| `DATABASE_URL`          | MySQL connection for the app, e.g. `mysql://root:your-password@localhost:3306/casemate` | Yes                                  | Your MySQL user, password and database name                                                                                                   |
| `DATABASE_URL_TEST`     | MySQL connection for the tests; must be a different database                            | For tests                            | Same as above, with `casemate_test`                                                                                                           |
| `JWT_SECRET`            | Signs login sessions; at least 32 characters                                            | Yes                                  | Generate one with the command in step 4                                                                                                       |
| `CLIENT_URL`            | Address of the client, for CORS and links in emails                                     | No (default `http://localhost:5173`) | Where the client runs                                                                                                                         |
| `APP_TIMEZONE`          | Read from `.env` but not used: the app always works in Asia/Kolkata (IST)               | No                                   | Leave as `Asia/Kolkata`                                                                                                                       |
| `SMTP_HOST`             | Mail server                                                                             | For email                            | Gmail: `smtp.gmail.com`                                                                                                                       |
| `SMTP_PORT`             | `587` (STARTTLS) or `465` (TLS)                                                         | No (default `587`)                   | Your mail provider                                                                                                                            |
| `SMTP_USER`             | Mail account                                                                            | For email                            | Your Gmail address                                                                                                                            |
| `SMTP_PASS`             | Mail password                                                                           | For email                            | For Gmail, a 16-character App Password from <https://myaccount.google.com/apppasswords> (needs 2-Step Verification), not your normal password |
| `EMAIL_FROM`            | Sender shown on emails, e.g. `"CaseMate <you@gmail.com>"`                               | For email                            | Use the same address as `SMTP_USER`                                                                                                           |
| `TWILIO_ACCOUNT_SID`    | Twilio account id (starts with `AC`)                                                    | For SMS                              | Twilio Console, Account Info                                                                                                                  |
| `TWILIO_AUTH_TOKEN`     | Twilio auth token                                                                       | For SMS                              | Twilio Console, Account Info                                                                                                                  |
| `TWILIO_FROM_NUMBER`    | Your Twilio number in + form, e.g. `+14155550123`                                       | For SMS                              | Twilio Console, Phone Numbers                                                                                                                 |
| `ENABLE_SCHEDULER`      | `true` sends reminders every 5 minutes from the API server                              | No (default `false`)                 | Set `true` once email or SMS is configured                                                                                                    |
| `SIGNUP_LIMIT_PER_HOUR` | Sign-ups allowed from one network per hour                                              | No (default `20`)                    | Leave as is                                                                                                                                   |

**Special characters in the MySQL password must be URL-encoded** in `DATABASE_URL` and
`DATABASE_URL_TEST`. For example, `@` becomes `%40`, `#` becomes `%23` and `/` becomes
`%2F`, so the password `p@ss#1` is written `p%40ss%231`.

The client has one optional setting, in `client/.env` (copy
[client/.env.example](client/.env.example)): `API_PROXY_TARGET` is where the development
server sends `/api` requests. The default is `http://localhost:4000`.

## Scripts

Run these from the repository root.

| Command                  | What it does                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Starts the API (with automatic restart) and the client together                                                                                                     |
| `npm run lint`           | ESLint, plus a Prettier formatting check                                                                                                                            |
| `npm run format`         | Formats every file with Prettier                                                                                                                                    |
| `npm run typecheck`      | TypeScript checks for the client, the server and the end-to-end tests                                                                                               |
| `npm test`               | Client and server tests (Vitest; the server tests use the test database)                                                                                            |
| `npm run test:e2e`       | Playwright end-to-end tests, desktop and mobile                                                                                                                     |
| `npm run screenshots`    | Retakes the README screenshots against the test database                                                                                                            |
| `npm run build`          | Production build of the client and the server                                                                                                                       |
| `npm run reminders:tick` | Runs one reminder pass now (the same code as the 5-minute job) and prints one line, e.g. `[reminders] claimed=0 sent=0 failed=0 cancelled=0 retrying=0 summaries=0` |

## Testing

All tests run against **real databases**, never mocks. The server and end-to-end tests
use the separate test database in `DATABASE_URL_TEST`. They apply the migrations to it
and empty it, and never touch the development database.

```powershell
npm test                        # client and server tests
npx playwright install chromium # once per machine, before the first end-to-end run
npm run test:e2e                # end-to-end tests
```

- **Server tests** (`server/tests`): the API routes, ownership between lawyers, IST day
  boundaries, the reminder engine (claiming, retries, no double sends) and billing
  (rounding, invoice numbering under concurrency, the PDF).
- **Client tests** (`client/src`): the date, money and validation helpers.
- **End-to-end tests** (`e2e`): start the real API and client on ports 4100 and 5174 and
  drive them in Chrome, including a phone-sized layout. Email and SMS are switched off
  for these runs, so no real message is ever sent.

## Known limitations

- **SMS to Indian numbers.** Twilio trial accounts can only send predefined templates to
  verified US numbers. Real SMS to Indian mobiles needs either a paid Twilio account or
  an Indian provider with DLT registration. SMS goes through a small `SmsProvider`
  interface (`server/src/lib/sms.ts`), so a provider such as MSG91 can be added without
  changing the reminder engine.
- **"self-signed certificate in certificate chain" from SMTP.** This happens on networks
  or with antivirus software that intercept secure connections. Fix it in one of these
  ways:
  - use another network
  - turn off the antivirus's email or HTTPS scanning
  - set the `NODE_EXTRA_CA_CERTS` environment variable to the path of the intercepting
    software's root certificate (a `.pem` file) before starting the server

  Never fix it by disabling certificate checks.

## Roadmap

- Shared accounts for chambers, with several advocates and clerks on one practice.
- WhatsApp reminders.
- An Indian SMS provider (for example MSG91) with DLT-registered templates.
- Deployment: a hosted client, API and managed MySQL database, with daily backups.

## Author

Ayushi, built as an internship project.

## Licence

[MIT](LICENSE)
