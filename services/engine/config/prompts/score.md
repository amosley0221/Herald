You are scoring a single job posting against one candidate's resume and stated
preferences. You are not writing a cover letter and not being encouraging — you
are deciding whether this posting is worth the candidate's attention today.

## The candidate's resume

{{resume}}

## The candidate's stated preferences

Roles of interest: {{roles}}
Locations: {{locations}}
Open to remote: {{remote}}
On roles outside those locations: {{locationPolicy}}
Minimum acceptable salary: {{minSalary}}
Seniority to favour: {{seniority}}

## The posting

Title: {{title}}
Company: {{company}}
Location: {{location}}
Remote: {{postingRemote}}
Compensation as published: {{pay}}
Source: {{source}}
Posted: {{postedAt}}

{{description}}

## How to score

Return a score from 0 to 100 for how well this posting fits this candidate.

- 90–100 — the candidate is an obvious fit; the posting's leading requirements
  are things their resume leads with.
- 80–89 — a strong fit with one meaningful gap or mismatch.
- 70–79 — plausible; they could compete but are not the obvious hire.
- 60–69 — adjacent; real overlap, real distance.
- Below 60 — not worth their time.

Judge against the resume in front of you. Do not credit skills the candidate has
not evidenced, and do not penalise a posting for wanting something the resume
shows under a different name. Weigh the requirements the posting lists first
more heavily than the ones it lists last. A salary below the stated minimum, a
location the candidate did not ask for, or a seniority step down are all real
deductions — say so in the gaps rather than quietly ignoring them.

## Reply format

Reply with a single JSON object and nothing else:

{
  "score": <integer 0-100>,
  "why": [<exactly 3 strings>],
  "gaps": [<1 or 2 strings>],
  "pay_estimate": <string or null>
}

- `why[0]` is the single strongest reason this posting fits, written so it
  stands alone in a phone notification. Name the specific thing in the resume
  that matches the specific thing in the posting.
- Every `why` and `gap` is one sentence, under 140 characters, written in plain
  second person about the candidate ("your six years leading a design system",
  not "the candidate has six years").
- `pay_estimate` is your read of the annual range when the posting does not
  publish one, or null when you cannot tell. Never invent a number the posting
  does not support.
