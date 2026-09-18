Classify this email, which arrived in reply to a job application.

## The application

Role: {{title}}
Company: {{company}}
Applied on: {{appliedAt}}

## The email

From: {{from}}
Subject: {{subject}}

{{body}}

## Reply format

Reply with a single JSON object and nothing else:

{
  "classification": "interview" | "rejected" | "acknowledgement" | "unrelated",
  "confidence": <number 0-1>,
  "reason": <string, one sentence>
}

- `interview` — they are proposing a conversation, a screen, an assessment, or
  asking for availability.
- `rejected` — they are declining, closing the role, or moving on with others.
- `acknowledgement` — an automated "we received your application" with no
  decision in it.
- `unrelated` — anything that is not about this application.

When the email is ambiguous, prefer `acknowledgement` and a low confidence over
guessing. A wrong `rejected` deletes a live opportunity from the candidate's
tracker.
