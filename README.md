# Durga Puja Online Receipt Management System

Lightweight receipt system for **ଜୟ ଦୁର୍ଗା ସାଂସ୍କୃତିକ ପରିଷଦ**.
HTML + CSS + vanilla JavaScript front end; Node.js + Express back end; MongoDB Atlas (Free Tier).

## What it does

1. An authorized creator logs in.
2. Enters **Donor Name (English)** and **Amount (INR)** only.
3. Clicks **Save & Download Receipt**. The server validates the input, saves one record to MongoDB
   (server-generated date/time), and only then generates the PDF (Odia header, English donor details) and the browser downloads it.
4. The dashboard totals (collection + receipt count) are recalculated from MongoDB after every save.
5. **Download All Records as Excel** produces a real `.xlsx` (Donor Name, Amount (INR), Date, Time + summary section).

## Setup

```bash
npm install
cp .env.example .env        # then edit .env (MONGODB_URI, JWT_SECRET)
npm run create-user -- collector1 "a-strong-password" creator   # create an authorized login
npm start                   # http://localhost:3000
```

### MongoDB Atlas (free tier)
1. Create a free **M0** cluster, a database user, and allow your server's IP under *Network Access*.
2. Copy the connection string into `MONGODB_URI` (include a database name such as `/durga_puja`).

### Authorized users (no public registration)
There is no sign-up page or endpoint. The administrator adds or resets users from the server:

```bash
npm run create-user -- <username> <password> [creator|admin]   # password >= 10 chars
npm run create-user -- --deactivate <username>                 # revoke access immediately
```

## Data stored

`receipts` collection — only: `donorName`, `amount` (integer **paise**, e.g. ₹501.00 → `50100`), `dateTime`
(plus MongoDB's own `_id`).
`users` holds login accounts (hashed passwords) and `submissions` holds short-lived (24 h) technical keys that
prevent duplicate receipts on double-clicks/retries. Neither appears on receipts or in the Excel file.

## Security notes

- bcrypt password hashing; signed JWT session in an `HttpOnly`, `SameSite=Strict` (and `Secure` in production) cookie.
- Every `/api` endpoint except login requires an active, authorized user (checked against the database on each request).
- Login rate limiting (10 attempts / 15 min / IP), general API rate limiting, `helmet` security headers, 10 KB JSON body limit.
- Server-side validation of name (English letters, spaces, `. ' -`) and amount (max 2 decimals, ₹1 – ₹1,00,00,000).
- Credentials only in environment variables (`.env` is git-ignored).

## Receipt PDF

Generated with PDFKit using the embedded **Noto Sans Oriya** font (`fonts/`, SIL OFL license) so Odia conjuncts
(e.g. ସ୍କୃ, ନ୍ଦ୍ର) render correctly on any device. The header text is in `src/pdf.js` (`HEADER_LINES`).
The layout is an original red/orange/yellow/gold design (no receipt image was attached to the request).
Date/time use the Asia/Kolkata time zone.

## Tests

```bash
npm test                                                   # in-memory data layer
TEST_MONGODB_URI="mongodb+srv://.../durga_test" npm test   # real MongoDB (db name must contain "test"; it is wiped)
```

Covers login, access control, validation, save, duplicate prevention, PDF content, dashboard totals and Excel export.

## Deploying

Any Node host works (Render, Railway, a VPS…). Set the same environment variables, `NODE_ENV=production`,
`TRUST_PROXY=1` behind a proxy, and serve over HTTPS.
