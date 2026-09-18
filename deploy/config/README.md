Put `herald.config.json` here, plus any service-account JSON files it points at
(`fcm-service-account.json`, `gmail-credentials.json`). This directory is
mounted read-only into the container at `/config`.

Nothing in here should be committed — see the .gitignore in this directory.
