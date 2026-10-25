# JIP — Jaideep Internship Platform

JIP is a React placement portal for live internship openings at product companies. It reads current openings from the companies' public Greenhouse career-board API, filters for intern/co-op titles, and links applicants directly to each employer's listing. It does not invent a role, stipend, closing date, or eligible batch when a company does not publish that information.

## Run locally

```sh
npm install
npm run dev
```

The local `.env.local` file configures Google sign-in and the admin account. A checked-in template is provided at `.env.local.example`. Add both `http://localhost:5173` and `http://127.0.0.1:5173`, plus the production website origin, to the OAuth client's authorized JavaScript origins in Google Cloud Console.

To build and run the production server:

```sh
npm run build
npm start
```

Set `NODE_ENV=production`, `PORT`, and a strong unique `SESSION_SECRET` in the deployment environment. The production server serves the built app and its API from the same origin.

## Deploy on Vercel

The `api/` directory contains the Vercel functions for jobs, Google sign-in, sessions, and admin postings. Redeploy the project after adding or changing API files. Set these environment variables in **Vercel → Project → Settings → Environment Variables** for Production (and Preview if needed):

- `VITE_GOOGLE_CLIENT_ID` — the Google OAuth Web client ID; add `https://jip-rosy.vercel.app` to its authorized JavaScript origins in Google Cloud Console.
- `GOOGLE_CLIENT_ID` — the same client ID, used by the server to verify Google credentials.
- `ADMIN_EMAILS` — the admin Google account email.
- `SESSION_SECRET` — a unique, long random secret; do not use the local development value.
- `BLOB_READ_WRITE_TOKEN` — create a Vercel Blob store and add its read/write token to persist admin-posted opportunities across serverless instances.

Save the variables and redeploy so Vercel applies them to the build and functions. Job feeds work without Blob; publishing admin-added jobs requires Blob storage.

## Live careers feeds

Openings are fetched from public Greenhouse job-board endpoints for Airbnb, Asana, Cloudflare, Coinbase, Discord, Dropbox, Duolingo, Figma, Groww, Gusto, InMobi, Lyft, MongoDB, Pinterest, Reddit, and Stripe. The server refreshes these sources every ten minutes and the **Refresh** button requests a fresh fetch. A source that is temporarily unavailable is reported; available feeds continue to load.

Feed fields vary by company. The portal labels unavailable stipend, closing date, and graduating-batch information as undisclosed instead of guessing. Batch filters match only graduation years explicitly described as class, graduation, or batch eligibility in the job title or description. Confirm details on the employer's page before applying.

## Google sign-in and admin jobs

The Google Identity Services button returns a Google credential to the same-origin server. The server verifies it with Google's token verification library and issues a signed, HTTP-only, same-site session cookie. It does not trust a client-supplied email address.

Only the account listed in `ADMIN_EMAILS` can publish a manual opening. On Vercel, manual posts are persisted in a Vercel Blob named `jip/manual-jobs.json`; locally, posts are saved to `data/manual-jobs.json`, which is excluded from version control. Saved openings are kept in that user's browser.

## Checks

```sh
npm run lint
npm run build
```
