# Design Document for a Lawyer's Case Management Website

Oct 1, 2026  @AyushiBindroo

## 1. What  will this website serve?

This is a website where a lawyer records every upcoming court hearing and gets an automatic reminder before each one. It also keeps client details, a record of what happened at each hearing, and the time and fees billed to each client.

### The problem it solves

Many advocates still track hearing dates in a paper diary, a notebook or a WhatsApp chat with their clerk. Indian courts adjourn cases often, so the next date changes after almost every hearing, and one missed update can mean a missed appearance. Client details, notes and fee records sit in different places, which makes billing slow and easy to forget.

### Who it is for

Version 1 is built for an individual advocate managing their own practice: one lawyer per account. Shared accounts for chambers (a senior advocate with juniors and a clerk) can come in a later version without redesigning the system.

### How to read this document

Sections 2 to 4 describe what the lawyer sees and does, with a picture of each screen. Sections 5 to 7 explain what happens behind the screen, using everyday comparisons. Sections 8 to 10 cover technology, security and the build plan, and a glossary at the end explains every technical word.

All screens use made-up sample data: Adv. Priya Sharma, a lawyer in Pune, and her clients. CaseMate is a working name and can be changed (for the website: just for ease to read).

## 2. Features at a glance

CaseMate has two core features and three extras, all sharing one database, so a hearing logged on a case page also shows up on the client's page and as billable time.

| Feature | What the lawyer can do | Why it matters | Type |
| --- | --- | --- | --- |
| Case diary | Add each case with case number, court, courtroom, judge, hearing date, time, opposing party and notes; see cases as a list or on a month calendar | One reliable list replaces the paper diary | Core |
| Hearing reminders | Get an email the day before and an SMS 2 hours before each hearing, plus a 7 AM summary of the day's hearings | No hearing is missed, even on a crowded day | Core |
| Client management | Keep each client's contact details, all their cases, payments and call notes on one page | Answers a client's "what's happening in my case?" in seconds | Extra |
| Hearing log and next-date tracker | Record what happened at each hearing and the next date; new reminders are created automatically | Handles frequent adjournments without re-entering the case | Extra |
| Billing and time tracking | Log time spent on each case, set an hourly or fixed fee, create invoices and track payments | The lawyer gets paid for all the work done, on time | Extra |

## 3. A day in the life of a CaseMate user

One case, followed from the first meeting to the invoice, shows how the five features work together for Adv. Priya Sharma.

1. **Evening, after meeting a new client.** Ramesh Gupta hires Priya for a property dispute. She adds him as a client, then fills the Add Case form: case number, Civil Court in Pune, Room 4, hearing on 14 October at 10:30 AM, and a note to bring the original sale agreement.
2. **13 October, 10:30 AM.** An email arrives: the hearing is tomorrow, with the court, room and her own note.
3. **14 October, 7:00 AM.** Her daily summary lists the three hearings she has that day, in time order. At 8:30 AM an SMS reminds her about the Gupta hearing.
4. **14 October, after the hearing.** The judge adjourns the matter. Standing outside the courtroom, she opens CaseMate on her phone, picks "Adjourned", enters the new date and 1 hour of time spent. Reminders for the new date are set up automatically.
5. **End of the month.** On the Billing page she selects Ramesh's unbilled hours and creates an invoice. His client page now shows the amount due, and the dashboard flags it if it goes unpaid.

## 4. The screens, one by one

The site has seven main screens, reached from a menu on the left; on a phone, the menu folds into a button at the top. The pictures below are mock-ups with sample data, so final colours, fonts and spacing can change.

### 4.1 Login and sign-up

A lawyer signs up with name, email, phone number and Bar Council enrolment number, then logs in with email and password. A "Forgot password" link sends a reset link by email. This is a standard two-field form, so it has no picture here.

### 4.2 Dashboard

The dashboard is the first screen after login and answers one question: what do I have today, and what needs my attention? Count cards sit on top, today's hearings are listed in time order on the left, and urgent items are flagged on the right. The strip at the bottom previews the coming week, and the Calendar menu shows the same hearings on a month grid.

&#91;embedded content: Dashboard mock-up · sample data\]

**Behind the scenes:** when the page opens, the browser asks the backend for today's hearings. The backend fetches only this lawyer's cases from the database and sends them back as a list.

### 4.3 Add a case

One form captures everything needed to reach the right court at the right time. Required fields are marked with a star, and the client is picked from a dropdown, with an option to add a new one. At the bottom, the lawyer chooses when and how to be reminded; the defaults come from Settings.

&#91;embedded content: Add a case form mock-up · sample data\]

**Behind the scenes:** on Save, the backend checks that the date is not in the past and the required fields are filled, stores the case, and calculates the reminder times straight away.

### 4.4 Case page and hearing log

Each case has its own page with the next hearing highlighted at the top and the full hearing history below it, newest first. After a hearing, the lawyer fills the small "Log today's outcome" card: what happened, the next date and the time spent. One click saves the entry, adds the time to billing and schedules reminders for the new date.

&#91;embedded content: Case page and hearing log mock-up · sample data\]

**Behind the scenes:** saving an outcome writes one new hearing record, cancels any reminders left for the old date, and creates fresh ones for the new date.

### 4.5 Clients

The Clients screen lists every client on the left and opens one profile on the right: contact details, all their cases with next dates, a billing summary and short notes from calls or meetings.

&#91;embedded content: Client profile mock-up · sample data\]

**Behind the scenes:** the profile is assembled from three tables (clients, cases and invoices) that are linked by the client's ID.

### 4.6 Billing and time tracking

The Billing screen shows what has been billed, received and is still due this month. Time entries that are not yet billed sit in one list; the lawyer ticks the ones to include and clicks Create invoice. Each invoice can be downloaded as a PDF or emailed to the client, and its status moves from Draft to Sent to Paid, or to Overdue after its due date.

&#91;embedded content: Billing and time tracking mock-up · sample data\]

**Behind the scenes:** the invoice total is calculated by the backend from the hours and the client's rate, never typed by hand, so totals always match the time entries.

### 4.7 The reminders the lawyer receives

Reminders are not a page the lawyer visits; they arrive in the email inbox and as SMS. Each one carries everything needed to reach court without opening the website: case, date, time, court, room, purpose and the lawyer's own note. In Settings, the lawyer can change the default timings, turn channels on or off and pick the time of the daily summary.

&#91;embedded content: Reminder email and SMS mock-up · sample data\]

## 5. Under the hood: how the parts work together

Every click travels through three layers (frontend, backend and database), while a fourth part, the reminder scheduler, works on its own clock to send reminders.

Think of a restaurant. The **frontend** is the dining room and the menu: everything the customer sees and touches. The **backend** is the kitchen and the waiter: it takes the order, checks it and prepares what was asked for. The **database** is the pantry and the order book, where everything is stored, labelled and kept in order. The **scheduler** is the kitchen's alarm clock: it rings when something is due, without anyone asking.

&#91;embedded content: System architecture · the restaurant analogy in italics\]

The top row handles everything the lawyer does on the site; the scheduler and the two messaging services run on their own and only read from the database.

### What happens when Priya clicks "Save case"

1. The browser packs the form into a message and sends it to the backend over a secure HTTPS connection.
2. The backend checks that Priya is logged in and that the required fields (court, date, time) are filled in and valid.
3. It saves the case in the database, then calculates the reminder times and saves those too.
4. It replies "saved", and the browser shows the new case on her dashboard.

The frontend never talks to the database directly. Every request goes through the backend, which acts as a gatekeeper and is the only part allowed to read or change stored data.

## 6. How reminders work

Reminder times are calculated the moment a case or next date is saved, and a scheduler checks every 5 minutes for any that are due, so each reminder goes out within 5 minutes of its set time.

### Default reminder schedule

| Reminder | When it is sent | Channel |
| --- | --- | --- |
| Day-before reminder | 24 hours before the hearing | Email and SMS |
| Final reminder | 2 hours before the hearing | SMS |
| Daily summary | 7:00 AM on every day with at least one hearing | Email |
| Missing next-date nudge | 6:00 PM on a hearing day if no outcome has been logged | Email and a dashboard alert |

The lawyer can change these defaults in Settings or turn off any of them for a single case. All times use Indian Standard Time.

&#91;embedded content: Reminder flow · 2 decisions, a retry loop and the next-date loop\]

The top row runs every time a date is saved; the loop on the left is what keeps reminders going through every adjournment without the lawyer re-entering anything.

### When things change or go wrong

- **Date changes:** when a hearing date is edited or a new next date is logged, unsent reminders for the old date are cancelled and new ones are created.
- **Case closed or deleted:** all of its unsent reminders are removed.
- **Delivery fails:** the system retries up to 3 times, a few minutes apart. If all attempts fail, the dashboard shows an alert so the lawyer can check the phone number or email.
- **Server restart:** reminders are stored in the database, not in memory, so none are lost if the server restarts; the next check simply picks them up.

## 7. Database design: what is stored and how it connects

All information lives in seven linked tables. Think of each table as a register in a lawyer's office, where each row is one entry and the links say which entries belong together.

&#91;embedded content: Database tables · each arrow points from one record to the many it owns\]

Read each arrow as "one ... has many ...": one lawyer has many clients, one case has many hearings, and one invoice groups many time entries.

| Table | Office equivalent | One row means |
| --- | --- | --- |
| Lawyers | The enrolment register | One lawyer's account |
| Clients | The client address book | One client |
| Cases | The case diary | One case, such as Gupta vs. Mehta Builders |
| Hearings | The cause list entries for each case | One hearing date and what happened at it |
| Reminders | The clerk's to-remind list | One message to send at a set time |
| Time entries | The work register | One block of work, such as 2 hours of drafting |
| Invoices | The fee book | One bill sent to a client |

Every row is tied, directly or through its case or client, to the lawyer who owns it. The backend uses this link on every request, which is how one lawyer is kept from ever seeing another lawyer's data.

## 8. Technology choices

The proposed stack uses JavaScript from end to end (React, Node.js and MySQL), so one programming language covers the whole project.

| Part | Tool | What it does, in plain words | Why this one |
| --- | --- | --- | --- |
| Frontend | React with Tailwind CSS | Builds the screens and makes them fit both phones and laptops | Widely used, with many ready-made building blocks |
| Backend | Node.js with Express | Receives every request, applies the rules and talks to the database | Same language as the frontend; simple to start with |
| Database | MySQL | Stores all records in linked tables | Free, reliable and built for linked data like cases and hearings |
| Scheduler | node-cron (BullMQ later, if volume grows) | Runs the reminder check every 5 minutes | Simple for version 1; a queue adds built-in retries at scale |
| Email | Nodemailer with an email provider such as SendGrid or Amazon SES | Sends reminder emails, daily summaries and invoices | Providers make sure emails reach the inbox, not spam |
| SMS | MSG91 or Twilio | Sends SMS reminders; WhatsApp can be added later | MSG91 is India-based and helps with the DLT template registration required for business SMS in India |
| Login | JWT tokens and bcrypt | Keeps the lawyer logged in and scrambles passwords | Industry standard and well documented |
| Invoices | PDFKit | Turns an invoice into a downloadable PDF | Lightweight, runs inside the backend |
| Hosting | Vercel for the frontend; Render or Railway for the backend and database | Puts the site on the internet | Simple deployment straight from GitHub |

If your company already uses a different stack, the design in sections 4 to 7 stays the same; only the tools in this table change.

## 9. Security and privacy

Lawyers store confidential client information, so privacy is built into version 1 rather than added later.

- **Passwords are scrambled:** they are stored as a one-way hash (bcrypt), so not even the developer can read them.
- **Secure connection:** all traffic uses HTTPS, the padlock in the browser bar, so data cannot be read while it travels.
- **Each lawyer sees only their own data:** every database request is filtered by the logged-in lawyer's ID.
- **Input checking:** the backend validates every field, which blocks attacks that hide harmful commands in form text.
- **Automatic logout:** a login expires after a period of inactivity; a phone OTP for login can be added in a later version.
- **Backups:** the database is backed up automatically every day.
- **Personal data law:** the design follows the spirit of India's Digital Personal Data Protection Act, 2023: collect only what is needed, and let a lawyer export or delete their account data.

## 10. Build plan

The plan assumes an eight-week internship: the core features (cases and reminders) are finished by week 4 and shown to the mentor, the three extras follow in weeks 5 to 7, and week 8 is for testing and launch.

&#91;embedded content: Eight-week build plan · 6 phases, 2 gates\]

If the internship is shorter, billing can move to a later version without affecting anything else, because no other feature depends on it.

## 11. Glossary

| Term | What it means |
| --- | --- |
| Frontend | The part of the website people see and click: pages, buttons, forms |
| Backend | The program on a server that receives requests, applies rules and talks to the database |
| Database | Organised storage for all the records, kept as linked tables |
| Table and row | A table is like one register; a row is one entry in it |
| Server | A computer, usually rented online, that runs the backend all day and night |
| API | The fixed set of requests the frontend is allowed to make to the backend, like a restaurant menu |
| Scheduler (cron job) | A task that runs automatically at set intervals, like an alarm clock |
| Authentication | Checking who someone is, usually with email and password |
| Hashing | Scrambling a password one way, so it can be checked but never read back |
| HTTPS | A secure, encrypted connection between the browser and the server |
| Hosting and deployment | Putting the finished website on the internet so anyone with the link can use it |
| Responsive design | Pages that rearrange themselves to fit a phone, tablet or laptop screen |
| Mock-up | A drawing of how a screen will look, made before it is built |
