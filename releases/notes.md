### Fixed
- Every request to the model was rejected with `400 \`temperature\` is
  deprecated for this model`. Current models refuse sampling parameters
  outright, and the model is configurable, so `temperature` is no longer sent
  at all — it would have worked only on older ones. This affected the hosted
  engine exactly as much as the apps.
- Drafting a cover letter threw before it reached the model: the prompt asks
  for the profile, the top reason the posting matched and a word limit, and
  none of the three were being supplied. Approving a match would have failed
  for everyone running without an engine.
