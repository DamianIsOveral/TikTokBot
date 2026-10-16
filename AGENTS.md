# Werkinstructies

Lees bij iedere nieuwe chat eerst `.dev_docs/README.md`, `.dev_docs/architecture.md` en `.dev_docs/progress.md` als ze aanwezig zijn. Werk voortgang en belangrijke besluiten daar beknopt bij. Deze lokale map hoort in `.git/info/exclude`, nooit in commits.

- Eén lichte Node.js-app; beperk dependencies en achtergrondprocessen.
- Streef naar maximaal 700 regels per bronbestand. Splits op verantwoordelijkheid; uitzonderingen moeten nut hebben. Gegenereerde lockfiles zijn uitgezonderd.
- Houd comments en documentatie kort en functioneel.
- Commit nooit secrets, `.env`, cookies, logs of lokale archieven. Gebruik alleen lege voorbeelden.
- Discord OAuth beschermt dashboard en API’s; alleen beheerders beheren de toegangslijst. Behoud de lokale binding totdat publieke deployment en gebruikersisolatie apart zijn uitgewerkt.
- Controleer wijzigingen met `npm run check` en `npm test`. Gebruik geen echte TikTok-acties voor tests.
