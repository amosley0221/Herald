# Handoff: Herald — automated job application engine

Android app + desktop app (Windows/macOS) that reads the user's resume, scans thousands of new job postings daily, scores each against the resume and preferences, asks the user for approval (instant push for top matches, morning digest for the rest), and — once approved — auto-fills the application, shows a review screen, and submits on confirmation.

Read in this order: this README → `SPEC-engine.md` (backend/matching/apply pipeline) → `SPEC-release-and-updates.md` (OTA updates + Android release notes, a hard requirement) → `screenshots/` → `design/Herald.dc.html`.

## About the design files

Everything in `design/` is a **design reference built in HTML** — an interactive prototype showing intended look and behavior. It is **not** production code to ship. Recreate these screens in the target stacks (below) using their native patterns. `Herald.dc.html` opens in a browser only inside its original tool; use it as source-of-truth for copy, layout values, and interaction order, together with the screenshots.

## Fidelity

**High-fidelity.** Colors, type, spacing, copy and interaction flow are final. Recreate pixel-faithfully. The only placeholder content is the sample user ("Marcus Bell") and the eight sample postings — real data replaces them.

## Recommended stacks

Pick one; both satisfy the "update without reinstalling" requirement (see `SPEC-release-and-updates.md`):

1. **Flutter** (preferred) — one codebase for Android + Windows + macOS. Use Shorebird for code-push OTA on Android; Windows/macOS via auto-update from GitHub Releases.
2. **React Native + Expo** (Android) with **Tauri** (desktop), sharing a TypeScript core package. Expo Updates provides OTA; Tauri has a built-in updater.

The **engine** (crawl, match, apply) is a separate service — see `SPEC-engine.md`. The apps are thin clients over it.

## Screens (Android, 412×892 reference frame)

Navigation: bottom tab bar — TODAY · MATCHES · TRACKER · PREFERENCES. Hidden on Onboarding, Notification, and Review screens. Active tab: gold text + 1px gold top rule; inactive: stone.

### 1. Onboarding — three steps
- **Step I · Upload resume.** Crown emblem 40px, wordmark HERALD (Cinzel 28), label "STEP I OF III". Body (Jost 300, 16/1.6): "Provide your resume. Herald reads every posting published today against it and brings you only the ones worth your time." Dashed gold 1px dropzone, 44px vertical padding, label "UPLOAD RESUME" + "PDF · DOCX · TXT". Footer caption: "Nothing is submitted without your approval. Ever."
- **Step II · Parsing.** File name row with Cinzel percentage (gold) right-aligned; 1px progress hairline (graphite-2 track, gold fill). Status label cycles: Reading document → Extracting experience → Mapping skills → Building your profile → Profile ready. On complete: extracted skills as Tags, one-line profile summary, solid "CONTINUE" button.
- **Step III · Threshold.** Large Cinzel numeral (40px gold) = threshold, explainer "and above notify you instantly. The rest wait for the morning digest." Range slider 60–99. Three switches: Instant notifications · Morning digest · 7:00 · Tailor cover letter per posting. Solid CTA "BEGIN THE SEARCH" → Today.

### 2. Notification (Android lock screen / heads-up)
Graphite background, time in Cinzel 64. Card: onyx, hairline border. Header "HERALD" (with 14px emblem) · "now". Body: score (Cinzel 32 gold) · role (Jost 500 15) · "Company · Location" · "Strong match. Approve to prepare the application for your review." Actions (Android notification actions): **Approve** (solid) · View · Skip. Approve deep-links to the Review screen; View to Detail; Skip marks Skipped.

### 3. Today (summary)
Title TODAY · date as roman "18 · IX · MMXXVI". 2×2 hairline-grid stat cells: Read · Matched · Applied · Pending (Cinzel 28). Sentence: "Herald read {N} postings published since yesterday. {X} cleared your threshold and were sent to you directly; the remainder wait below in the digest." Then "AWAITING APPROVAL · {n}" list of pending rows (score, role, company) → Detail.

### 4. Matches (feed)
Title MATCHES · "{n} PENDING". Two sections separated by hairline label bars:
- **APPROVE NOW · {threshold}+** (gold label): rows 16px padding, score Cinzel 28 gold in a 44px column, role Jost 500 15, "Company · Location", "Pay · Source · Posted".
- **MORNING DIGEST · 7:00** (stone label): compact rows, score Cinzel 20 stone, role 14, "Company · Location".
Row hover/press: graphite background. Tap → Detail.

### 5. Match detail
Back link "← MATCHES". Score Cinzel 48 gold beside role (18/500) + company. 2×2 meta grid (Location · Compensation · Source · Posted) between hairlines. "WHY IT FITS" (gold label) bulleted with gold interpunct; "WHERE IT DOES NOT" (stone) bulleted in stone. Bottom: solid "APPROVE · PREPARE APPLICATION" over ghost "SKIP". If already actioned, show status in a hairline box instead of buttons.

### 6. Review before submitting (apply preview)
Back link, title REVIEW BEFORE SUBMITTING (Cinzel 22), subtitle "Role · Company · via Source". Key/value list (hairline rows): Name, Email, Phone, Resume, Portfolio, Authorization, Availability — populated from profile + the posting's form fields. "COVER LETTER · TAILORED" excerpt with 1px left hairline. Solid CTA "SUBMIT APPLICATION" → engine submits → toast "Application submitted · Company" → Tracker.

### 7. Tracker
Title TRACKER · "{n} APPLIED". Rows: role, "Company · date", right-aligned Badge with status. Badge tones: Applied = solid gold, Interview = success, Skipped/Pending = muted, Approved = gold outline. Tap → Detail (read-only).

### 8. Preferences
Roles as removable Tags; Location + Minimum salary (Cinzel numeral); threshold slider with live Cinzel numeral; three switches (same as onboarding); footnote "Sources · Greenhouse, Workday, Lever, Ashby, LinkedIn and 50 others. Refreshed hourly." Add: **About / What's new** row here that opens the release notes screen (see release spec).

### Toast
Bottom-anchored (above tab bar), graphite-2, hairline border, 13px text with leading gold interpunct. Auto-dismiss 2.4s.

## Desktop (1120×700 reference window; resizable, min 960×600)

Three-pane inbox, hairline dividers:
- **Sidebar 200px**: emblem 28px; nav TODAY · MATCHES · TRACKER · PREFERENCES (12px uppercase .18em; active gold with 1px gold left rule); footer "Last crawl · 6:58 / 2,418 postings read".
- **List 380px**: same Approve-now / Digest sections as mobile (score 24/18). Selected row background graphite. Tracker nav swaps the list to applications; Preferences swaps it to the settings form.
- **Detail pane (fluid, 44px padding)**: score Cinzel 64 gold; role 22/500; meta line; two-column "Why it fits" / "Where it does not"; actions at bottom. Approve switches the pane to the Review layout (fields in two columns, cover letter, Submit + Back). Today shows the stat grid (4 across, Cinzel 40) + sentence.

Window chrome in the prototype is a placeholder; use native title bars.

## Interactions & state

- `status` per match: pending → approved → applied → interview | rejected; pending → skipped. Approve sets `approved` and opens Review; Submit sets `applied`; Skip sets `skipped`.
- Instant vs digest: `score >= threshold` → push immediately; else include in the 7:00 digest push (one notification summarizing N matches, tap opens Matches).
- Threshold slider updates the Approve-now/Digest split live.
- All transitions: 200ms ease, opacity/background only. No bounces, no slide-ins.
- Optimistic UI: mark applied on tap; roll back with a danger-tone toast if the engine reports failure.

## Design tokens (Crowned Pixel)

Colors: onyx `#0C0A09` (bg) · graphite `#161318` (raised) · graphite-2 `#1E1A21` (cards/toast) · gold `#C6A75E` (accent; ~8% of any screen) · gold-bright `#E3C57E` (hover) · bone `#EDE8DC` (text) · stone `#8F8A80` (secondary) · line `rgba(198,167,94,.25)` (all hairlines) · success `#7E8F6E` · danger `#B05A4A`.

Type: **Cinzel** 500–700 for headings, scores, numerals, dates (.02em tracking). **Jost** 300–500 for body/UI, 1.6 line-height. Labels: Jost 12px uppercase .18em tracking. Both fonts are OFL (Google Fonts) — bundle them.

Shape: border-radius 0 everywhere. Borders 1px `line`. No gradients, no glows. Spacing scale 8/16/24/44/88/120.

Buttons: Solid = gold bg, onyx text (one per screen). Outline = 1px gold, gold text, fills gold on hover. Ghost = bone text → gold-bright on hover. All uppercase Jost 12px .18em, padding 12×32.

Full token files: `design/tokens/`.

## Assets

`design/assets/emblem-flat-gold.svg` — the only mark. No icon set is used; if an icon is unavoidable use Lucide at 1.5px stroke in stone.

## Files

- `design/Herald.dc.html` — interactive prototype (phone + desktop, shared state). Logic class at the bottom holds sample data, status machine, and derived lists.
- `design/android-frame.jsx` — device bezel used by the prototype only.
- `screenshots/android/*.png`, `screenshots/desktop/*.png` — every state.
- `SPEC-engine.md`, `SPEC-release-and-updates.md`.
