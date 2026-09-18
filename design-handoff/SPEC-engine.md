# Herald — engine specification

The apps are clients. The engine runs on a schedule and does the work. Recommended: a small always-on service (Node or Python) on a $5–10/mo VPS or the user's desktop; the desktop app may embed it, but the Android app must not depend on the desktop being awake — run it server-side.

## Pipeline (hourly)

1. **Ingest** — pull postings published since last run. Prefer an aggregator that already normalizes ATS feeds (e.g. Pinloop CLI, which exposes Greenhouse, Workday, Lever, Ashby and ~50 others plus LinkedIn; the user referenced it). Fallback: direct public JSON endpoints for Greenhouse (`boards-api.greenhouse.io`), Lever (`api.lever.co/v0/postings`), Ashby; Workday via each tenant's `/wday/cxs/.../jobs` endpoint. Store raw + normalized (`title, company, location, remote, pay, url, source, posted_at, description, apply_url`).
2. **Dedupe** — hash on (company, normalized title, location); collapse cross-posts (LinkedIn copy of a Greenhouse posting) to the ATS original.
3. **Prefilter** — cheap rules from Preferences: role keywords, location/remote, salary floor, seniority. Drops ~90% before any LLM call.
4. **Score** — LLM call (Claude) with the resume text, preferences, and the posting. Return strict JSON: `{score: 0-100, why: string[3], gaps: string[1-2], pay_estimate}`. `why[0]` must be the strongest single reason — the UI shows it alone in notifications. Cache by posting hash; never re-score.
5. **Route** — `score >= threshold` → send push immediately (FCM on Android; native notifications on desktop). Else → queue for the 7:00 local-time digest push. Everything scored ≥ 60 appears in the Matches feed regardless.
6. **Approve** — user action from notification, phone, or desktop hits `POST /matches/:id/approve`. Engine then **prepares** the application: fetch the apply form, map fields to profile (name, email, phone, resume file, portfolio, work authorization, availability, EEO opt-outs), generate the tailored cover letter (Claude; ≤ 180 words; mention `why[0]`), and return the filled form as JSON for the Review screen.
7. **Submit** — on `POST /matches/:id/submit`, a headless browser (Playwright) opens `apply_url`, fills the form from the reviewed JSON, uploads the resume, submits, and screenshots the confirmation. Store the screenshot; status → `applied`. If a CAPTCHA or login wall blocks it, status → `needs_you` and push "Finish this one yourself" with a deep link. Never bypass CAPTCHAs.
8. **Track** — poll the user's mailbox (Gmail API, read-only label filter) for replies from applied companies; classify → `interview` / `rejected`; update Tracker.

## API (client ↔ engine)

- `POST /resume` (file) → parsed profile `{skills[], years, titles[], summary}`
- `GET/PUT /preferences` `{roles[], locations[], remote, min_salary, threshold, instant, digest_hour, tailor_letter}`
- `GET /matches?status=` → list with score/why/gaps
- `POST /matches/:id/approve` → prepared application JSON
- `POST /matches/:id/submit` · `POST /matches/:id/skip`
- `GET /stats/today` → `{read, matched, applied, pending}`
- `POST /devices` (FCM token) — notifications
- Auth: single-user; bearer token generated at setup and shown as a QR on desktop for the phone to scan.

## Data model

`postings`, `matches (posting_id, score, why[], gaps[], status, decided_at, submitted_at, confirmation_png)`, `profile`, `preferences`, `applications_log`. SQLite is enough.

## Guardrails

- Never submit without an explicit Submit tap on the Review screen; the "approve" step only prepares.
- Hard daily cap on submissions (default 15) — configurable in Preferences.
- Respect robots/ToS of each source; use official APIs where they exist. LinkedIn Easy Apply automation violates LinkedIn ToS — route those to `needs_you`.
- Keep every generated cover letter and filled form in the log so the user can see exactly what was sent.
