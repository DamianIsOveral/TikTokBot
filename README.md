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

De verzendroute staat in `TIKTOK_CHAT_TRANSPORT`: standaard `euler`, of `direct` voor rechtstreekse TikTok-chat. In Euler-modus controleert de server iedere vijf minuten de sleutelrechten; zonder Webcast Premium worden commands grijs en weigert de API wijzigingen. De directe route gebruikt de botcookies `TIKTOK_SESSION_ID`, `TIKTOK_TARGET_IDC`, `TIKTOK_MS_TOKEN` en `TIKTOK_VERIFY_FP`. De Community-sleutel blijft voor de bestaande chatontvangst gebruikt. `BOT_ENABLED=true` schakelt het verwerken van commands in. LIVE-mutes en bans zijn nog niet aangesloten.

Rechtstreekse verzending staat in `src/server/tiktok/direct-client.ts`. Op 2026-10-17 is één ondertekend JSON-bericht door TikTok geaccepteerd en teruggezien in de livechat. De dashboardkoppeling gebruikt dezelfde route via `direct-chat.ts`. `npm run probe:tiktok` controleert alleen de botsessie; `--send-once` is de oude ongetekende diagnose en `--send-signed-once` de expliciete verzendproef. De client volgt geen redirects, verstuurt cookies uitsluitend naar vaste TikTok-hosts en probeert mislukte berichten niet opnieuw. Automatische tests gebruiken uitsluitend nepantwoorden.

De aanvullende proef gebruikt [nglmercers Node-package](https://github.com/nglmercer/tiktok-signer/tree/a94d9d26602163a0f4e0e88ce26c633c6f50a034/packages/tiktok-live) en TikToks openbare script. De upstream-API `sign(url, PRODUCT.fetch)` ondertekent intern een GET zonder body. Chat gebruikt daarom een kleine POST-adapter die de ongewijzigde upstream-bootstrap en echte TikTok-SDK dezelfde JSON-body geeft als de HTTP-client. De URL-only upstream-API blijft beschikbaar voor bodyloze proeven en weigert POST-invoer. Dit is eigen aanroeplogica, geen eigen signature-algoritme. Upstreamrevisie, hashes en adapter moeten bij updates samen worden gecontroleerd.

`npm run probe:tiktok-signing` haalt vijf vastgelegde bestanden op, controleert hun SHA-256 en ondertekent alleen fictieve POST-invoer. De bestanden blijven in het genegeerde `.local-archive/`; geen nieuwe dependencies of browser nodig.

Ondertekenen draait tijdelijk in een afzonderlijk Node-proces met begrensde heap, beperkte bestandsrechten en uitgeschakelde netwerk-fetch. Cookiecontext wordt alleen in RAM doorgegeven aan de signer, nooit opgeslagen of gelogd. Dit is geen volledige OS-sandbox.

`npm run probe:tiktok -- --prepare-signed` controleert de botsessie, haalt de LIVE-context en Webcast-CSRF op en bereidt de ondertekende aanvraag voor. Deze diagnose laadt geen connector en blokkeert alle methoden behalve GET/HEAD vóór verzending; de uitvoer toont aantallen en methoden. `npm run probe:tiktok -- --send-signed-once` verstuurt expliciet één herkenbaar testbericht en controleert vervolgens of het terugkomt in de chat. De browsercapture gebruikte `x-secsdk-csrf-token: DOWNGRADE`; de client volgt dezelfde publieke SDK-terugval als het tokenendpoint geen token geeft. Geslaagde voorbereiding bewijst nog geen geaccepteerde verzending.

De ondertekende proeven met scriptversies `1.0.0.388` en `1.0.0.417` kregen op 2026-10-17 HTTP403, ook na overstappen op de upstream-API. Versie `1.0.0.417` is vastgelegd; de proef stopt vóór ondertekenen/verzenden als de LIVE-pagina een andere of onduidelijke scriptversie aangeeft.

Een latere vergelijking bevestigde dat de browser een JSON-body ondertekent; de eerdere Node-proeven ondertekenden en verstuurden een lege body. De client geeft nu dezelfde vijf actievelden aan query, ondertekenaar en transport, inclusief numerieke `input_type` en milliseconden-tijdstempel. Die tijdstempel gebruikt lokaal `Date.now()`; de browser gebruikt zijn NTP-clientklok. Offline controle bevestigt de body-, query- en UA-hash in de gegenereerde signature.

Verdere vergelijking vond een lege `msToken` in de directe aanvraag, terwijl het geslaagde browserverzoek een gevulde token had. De upstream-signer verwacht deze sessiecontext als invoer. Optioneel voor de proef: zet de `msToken`-cookie van het botaccount lokaal bij `TIKTOK_MS_TOKEN` en de `s_v_web_id`-cookie bij `TIKTOK_VERIFY_FP`. Gebruik dezelfde botsessie als `TIKTOK_SESSION_ID`; deel deze waarden niet. De voorbereiding meldt alleen aanwezigheid van context en blokkeert de chat-POST bij een lege token. `inputStatus: present` bevestigt alleen aanwezige invoer, geen geldige of geaccepteerde token. Browserparameters sluiten aan op de signer-UA; apparaatgegevens worden alleen uit de LIVE-pagina overgenomen als ze aanwezig zijn.

De directe route controleert de botidentiteit iedere vijf minuten zonder berichten te versturen. Ontvangen cookieverversingen en vervaldatums blijven in één RAM-context; ze worden nooit naar `.env` geschreven. Een verzendfout pauzeert commands tot een handmatige hercontrole via Instellingen. Stop of disconnect tijdens voorbereiding blokkeert de POST. Er is geen bewezen automatische vernieuwing van `msToken`, `verifyFp` of de botlogin: de upstream-bootstrap slaat tokenupdates niet op. Een vaste geldigheidsduur is niet gegarandeerd, en een geldige login bewijst geen geldige chattoken. Langdurige werking en sessieherstel vanaf een server-IP moeten vóór deployment nog worden getest.

Voor vergelijking met een handmatig browserverzoek: bewaar een lokale HAR-export in `.local-archive/` en gebruik `npm run inspect:tiktok-har -- .local-archive/tiktok.har`. De analyse toont uitsluitend bekende veldnamen, HTTP-status en numerieke TikTok-statuscode van de chatroute; geen cookies, tokenwaarden, berichten of overige response-inhoud. HAR-bestanden zijn uitgesloten van Git en de Docker-context.

Op **Commands** voeg je commando’s toe, wijzig je antwoorden, stel je cooldowns in en schakel je commando’s aan of uit. Iedere regel wordt één bericht (1–10 regels van maximaal 200 tekens); cooldowns liggen tussen 5 en 3600 seconden. Commando’s matchen het volledige bericht, zonder verschil tussen hoofd- en kleine letters. De lokale antwoordpreview verstuurt niets. Klik op Commands opslaan om wijzigingen direct op de server toe te passen. Een gewijzigd of uitgeschakeld commando breekt een nog lopende antwoordreeks af.

De server bewaart commands in `data/commands.json`, buiten Git en de Docker-buildcontext. Maak hiervan een backup; bij latere Docker-deployment heeft deze map een persistent volume nodig. Bij conflicterende wijzigingen vanuit twee tabbladen wordt overschrijven geweigerd. **Commando’s werken zonder geopend dashboard** zolang de server draait, TikTok verbonden is en botantwoorden aanstaan. Een serverherstart behoudt de commands, maar de TikTok-verbinding start daarna nog handmatig.

De laatste 500 liveberichten blijven in het servergeheugen beschikbaar bij vernieuwen, een tweede tabblad of herstel van de browserverbinding. Stop bewaart deze berichten; opnieuw verbinden begint een lege chat. Een serverherstart wist de chat. De knop Demo toont lokale voorbeelden zonder de gedeelde verbinding te stoppen; Livechat tonen haalt de serverchat weer op. Filters en demoacties blijven per browser lokaal.

De server accepteert uitsluitend lokale hosts. Discord regelt de toegang tot één gedeeld kanaal; gebruikersisolatie en publieke Coolify/Docker-deployment volgen later. Maak geen publieke tunnel of proxy naar deze versie. Cookies zijn HttpOnly en SameSite=Lax voor lokale HTTP; publieke deployment vereist daarnaast HTTPS en Secure-cookies.

Secrets blijven in `.env`, buiten Git en toekomstige Docker-context. `.env.example` bevat geen secrets. Oude projecten staan lokaal in `.local-archive`, buiten Git. Lokale werkaantekeningen staan in `.dev_docs`; `AGENTS.md` verwijst nieuwe chats ernaar. Configureer op een nieuwe checkout zelf `.dev_docs/` in `.git/info/exclude`.
