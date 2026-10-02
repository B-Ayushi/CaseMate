# CaseMate: project rules

## What this is
A website for individual advocates in India: store upcoming hearings, get automatic reminders, manage clients, log hearing outcomes and next dates, and bill clients for time. One lawyer per account in v1. The full design, with screen layouts, is in docs/design-document.md. Follow it.

## Stack
- client: React 18 + Vite + TypeScript + Tailwind + React Router + TanStack Query + React Hook Form + zod
- server: Node 20 + Express + TypeScript + Prisma + MySQL 8 + zod
- auth: bcrypt password hashes, JWT in an httpOnly, secure, sameSite cookie
- reminders: node-cron in the server, Nodemailer (SMTP) for email, Twilio for SMS behind a swappable provider interface
- invoices: PDFKit
- tests: Vitest + Supertest against a separate real test database; Playwright for end-to-end

## Non-negotiable rules
- NO MOCK DATA. No hardcoded cases, clients, hearings, invoices or users. No seed scripts with fake records. No faked API responses, stubbed services or dummy return values. Every screen reads and writes real data through the API and MySQL. Show a helpful empty state when there is no data yet.
- NO PLACEHOLDERS. No TODOs, no "coming soon" buttons, no tabs or menu items for features that are not built. If something cannot be finished, stop and tell me why.
- OWNERSHIP. Every query for user data is filtered by the logged-in lawyer's id. A lawyer can never read or change another lawyer's records; return 404 for anything they do not own.
- VALIDATION. Validate every request body, query and URL parameter with zod on the server. Share or mirror the same rules in client forms.
- TIME. Store every timestamp in UTC. Interpret user input and display all dates in Asia/Kolkata (IST) using date-fns and date-fns-tz.
- MONEY. Store amounts as integer paise. Display as rupees with Indian digit grouping, for example ₹1,20,000.
- SECRETS live only in .env. Keep .env.example up to date.
- DONE MEANS VERIFIED. After each task, run lint, typecheck and tests, start the app, check the feature end to end against the real database, then commit with a conventional commit message.

## Folder structure
- server/src: routes, controllers, services, middleware, validators, jobs, lib
- server/prisma: schema and migrations
- client/src: pages, components, features, api, hooks, lib

## Reminder rules
- Day-before reminder: 24 hours before the hearing, by email and SMS
- Final reminder: 2 hours before the hearing, by SMS
- Daily summary: 7:00 AM IST on days with at least one hearing, by email
- Missing next-date nudge: 6:00 PM IST on a hearing day if no outcome is logged, by email plus a dashboard alert
- The scheduler runs every 5 minutes. A failed send is retried up to 3 times, then marked FAILED and shown on the dashboard.
- When a hearing date changes, unsent reminders for the old date are cancelled and new ones created. No reminder is ever sent twice.
- Lawyers can change these defaults in Settings and override them per case.

## UI
Left sidebar: Dashboard, Cases, Calendar, Clients, Billing, Settings. Fully responsive: on mobile the sidebar folds into a menu button. Calm, clean and accessible, with labelled inputs, keyboard support and good contrast.
