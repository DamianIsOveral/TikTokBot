# Faynominaal LIVE

Eén Node.js 24-app in TypeScript met browserdashboard, TikTok LIVE-chat en optionele botantwoorden. Eén serverproces, geen Electron of database. Alleen de browsercode wordt naar JavaScript gecompileerd; de server draait TypeScript rechtstreeks via Node.js.

```sh
npm ci
# Kopieer .env.example naar .env en vul de gewenste instellingen in.
npm start
```

Open [het dashboard](http://127.0.0.1:3000). `npm run dev` herstart de server bij wijzigingen. `npm run check` en `npm test` controleren de app zonder TikTok te benaderen.

Discord-login is verplicht. Stel in `.env` `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` en de vaste beheerders via `DISCORD_ADMIN_IDS` (komma’s) in. Registreer lokaal exact `http://127.0.0.1:3000/auth/discord/callback` bij OAuth2 → Redirects in de Discord Developer Portal. De Client Secret komt uitsluitend op de server; de login vraagt alleen `identify` aan. Ontbrekende instellingen geven geen toegang zonder login.

Beheerders voegen onder **Toegang** Discord-IDs toe als gebruiker of beheerder. Alleen toegevoegde IDs krijgen toegang; gewone gebruikers mogen de gedeelde bot bedienen en commands aanpassen. Vaste beheerders uit `.env` kunnen niet via het dashboard worden verwijderd of gedegradeerd. De lijst staat in `data/access.json`. Intrekken beëindigt bestaande sessies en eventstreams. Sessies staan uitsluitend in RAM en verlopen na acht uur of bij een serverherstart. De bot blijft werken wanneer je uitlogt of de browser sluit.

`npm run build` compileert de browsercode naar `dist/browser`; `npm start` en de Windows-snelkoppeling doen dat automatisch. Bij browserwijzigingen tijdens `npm run dev`: voer opnieuw `npm run build` uit en vernieuw de pagina. `npm run typecheck` controleert server, browser en tests met strikte types. `npm run start:server` start alleen de server als de browsercode al gebouwd is; hiervoor is de TypeScript-compiler niet nodig.

De code is gescheiden in `src/server/` (bot en server), `src/server/http/` (routes, beveiliging, assets en SSE), `src/client/` (dashboardmodules) en `src/shared/` (eventtypes). `public/` bevat alleen HTML en CSS. TypeScript en Node-types zijn uitsluitend ontwikkeldependencies.

Windows: de snelkoppeling **Faynominaal Dashboard** op het bureaublad start de server op de achtergrond als dat nodig is en opent daarna je standaardbrowser. De server blijft draaien wanneer je de browser sluit. De launcher staat in `scripts/open-dashboard.ps1` en respecteert HOST/PORT uit `.env`.

Klik op Verbinden om één gedeelde TikTok-verbinding te starten. Zonder credentials wordt alleen publieke chat geprobeerd. Voor botantwoorden zijn alle drie TikTok/Euler-instellingen én `BOT_ENABLED=true` nodig. De bot begint met `!discord`, `!socials` en `!dono`, met standaard 60 seconden cooldown en minimaal één seconde tussen berichten. Dempen en moderatoracties blijven lokale demoacties.

Voor aanmelden met het botaccount vereist de connector ook `WHITELIST_AUTHENTICATED_SESSION_ID_HOST=api.eulerstream.com`. Stel dit alleen in als je toestaat dat de bestaande TikTok-sessiecookies naar die Euler-host worden gestuurd. Zonder deze instelling weigert de connector de accountverbinding; het dashboard toont de oorzaak zonder cookies of sleutels.

Chat lezen en botberichten versturen hebben afzonderlijke rechten. De connector verstuurt via Eulers `Send room chat`-endpoint; de huidige SDK meldt dat daarvoor een API-sleutel met toegang tot de betaalde verzendfunctie nodig is. Een geslaagde LIVE-verbinding bevestigt alleen chatontvangst. Verzendfouten staan apart in het dashboard en veranderen de verbindingsstatus niet. Controleer bij geweigerde verzending de sleutelrechten en het Euler-abonnement; er wordt niet automatisch opnieuw verzonden.

De server controleert Euler-rechten bij starten en iedere vijf minuten. Zonder Webcast Premium worden commands grijs en weigert de API wijzigingen. De opgeslagen antwoorden blijven beschikbaar voor de lokale preview. LIVE-mutes en bans zijn nog niet aangesloten.

Rechtstreekse verzending wordt apart onderzocht in `src/server/tiktok/direct-client.ts`. `npm run probe:tiktok` controleert alleen de identiteit van de ingestelde botsessie. `npm run probe:tiktok -- --send-once` probeert expliciet één herkenbaar testbericht in het ingestelde LIVE-kanaal te plaatsen. De proef volgt geen redirects, verstuurt cookies uitsluitend naar vaste TikTok-hosts en probeert mislukte berichten niet opnieuw. De lokale proef op 2026-10-16 kreeg HTTP403, ook na ophalen van CSRF- en apparaatgegevens uit de LIVE-pagina. Deze experimentele client is daarom niet actief in het dashboard. De automatische tests gebruiken uitsluitend nepantwoorden.

Voor vergelijking met een handmatig browserverzoek: bewaar een lokale HAR-export in `.local-archive/` en gebruik `npm run inspect:tiktok-har -- .local-archive/tiktok.har`. De analyse toont uitsluitend bekende veldnamen en HTTP-statussen van de chatroute; geen cookies, tokenwaarden, berichten of response-inhoud. HAR-bestanden zijn uitgesloten van Git en de Docker-context.

Op **Commands** voeg je commando’s toe, wijzig je antwoorden, stel je cooldowns in en schakel je commando’s aan of uit. Iedere regel wordt één bericht (1–10 regels van maximaal 200 tekens); cooldowns liggen tussen 5 en 3600 seconden. Commando’s matchen het volledige bericht, zonder verschil tussen hoofd- en kleine letters. De lokale antwoordpreview verstuurt niets. Klik op Commands opslaan om wijzigingen direct op de server toe te passen. Een gewijzigd of uitgeschakeld commando breekt een nog lopende antwoordreeks af.

De server bewaart commands in `data/commands.json`, buiten Git en de Docker-buildcontext. Maak hiervan een backup; bij latere Docker-deployment heeft deze map een persistent volume nodig. Bij conflicterende wijzigingen vanuit twee tabbladen wordt overschrijven geweigerd. **Commando’s werken zonder geopend dashboard** zolang de server draait, TikTok verbonden is en botantwoorden aanstaan. Een serverherstart behoudt de commands, maar de TikTok-verbinding start daarna nog handmatig.

De laatste 500 liveberichten blijven in het servergeheugen beschikbaar bij vernieuwen, een tweede tabblad of herstel van de browserverbinding. Stop bewaart deze berichten; opnieuw verbinden begint een lege chat. Een serverherstart wist de chat. De knop Demo toont lokale voorbeelden zonder de gedeelde verbinding te stoppen; Livechat tonen haalt de serverchat weer op. Filters en demoacties blijven per browser lokaal.

De server accepteert uitsluitend lokale hosts. Discord regelt de toegang tot één gedeeld kanaal; gebruikersisolatie en publieke Coolify/Docker-deployment volgen later. Maak geen publieke tunnel of proxy naar deze versie. Cookies zijn HttpOnly en SameSite=Lax voor lokale HTTP; publieke deployment vereist daarnaast HTTPS en Secure-cookies.

Secrets blijven in `.env`, buiten Git en toekomstige Docker-context. `.env.example` bevat geen secrets. Oude projecten staan lokaal in `.local-archive`, buiten Git. Lokale werkaantekeningen staan in `.dev_docs`; `AGENTS.md` verwijst nieuwe chats ernaar. Configureer op een nieuwe checkout zelf `.dev_docs/` in `.git/info/exclude`.
