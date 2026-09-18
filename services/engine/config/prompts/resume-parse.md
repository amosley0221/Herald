Extract a structured profile from this resume. The text below was pulled out of
a PDF, DOCX or plain-text file, so spacing and column order may be mangled.

## Resume text

{{resume}}

## Reply format

Reply with a single JSON object and nothing else:

{
  "fullName": <string or null>,
  "email": <string or null>,
  "phone": <string or null>,
  "location": <string or null>,
  "portfolio": <string or null>,
  "linkedin": <string or null>,
  "summary": <string or null>,
  "skills": [<strings>],
  "titles": [<strings>],
  "years": <number or null>
}

- Use null for anything the resume does not state. Never guess an email address,
  a phone number, or a name.
- `skills` are the concrete, nameable ones — tools, languages, frameworks,
  methods, domains. At most 12, ordered by how prominent they are in the resume.
  Skip generic filler like "communication" or "team player".
- `titles` are the job titles this person has actually held, most recent first.
- `years` is total professional experience, rounded to the nearest whole year,
  inferred from the employment dates. Null if the dates are not legible.
- `summary` is one sentence, under 120 characters, in the style
  "Six years · Product design · Design systems · Charlotte, NC" — the throughline
  of this person's career, not a pitch.
