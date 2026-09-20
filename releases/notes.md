### Added
- **Job sites, not just company boards.** Herald could only watch employers you
  named one at a time, which is no help when the question is "who is hiring at
  all". Six sources that search across employers can now be turned on in
  Preferences → Job sources: **Adzuna** (broad nationwide coverage, free key),
  **USAJOBS** (federal, free key), and **Remotive**, **Arbeitnow**,
  **RemoteOK** and **Jobicy** (remote, no account). The searching ones use the
  roles and location you already set.
- **Test, on each source.** These are definitions pointing at somebody else's
  API, and the failure that matters is not an error — it is a field mapping
  that reads nothing, which looks exactly like a quiet day. Test fetches the
  source live and shows the first posting as Herald read it, plus any field
  that came back empty across every posting.
- A `json` source's URL, body and headers now take `{query}`, `{location}`,
  `{since}` and any of its own string options as placeholders, which is what
  lets one definition ask an aggregator the user's own question. `{query}`
  issues one request per role, capped by `maxQueries`, because these APIs take
  a phrase rather than a boolean expression.

### Fixed
- The **Also consider roles elsewhere** switch was missing from the Android
  Preferences screen in 0.2.3 — the preference and the scoring behind it
  shipped and worked, but there was no way to turn it on from the phone.
  Desktop was unaffected.
- A `json` source publishing its posted date as epoch seconds dated every
  posting to the moment of the scan, so nothing ever aged out of the window.

### Notes
- Indeed and LinkedIn are deliberately absent. Neither offers a public job
  search API any more, both forbid scraping, and both defend against it well
  enough that a scraper would fail by silently returning nothing. Adzuna covers
  much of the same ground through an interface meant to be used.
