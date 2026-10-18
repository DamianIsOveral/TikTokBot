# Faynominaal LIVE

Eén lichte Node.js 24-app in TypeScript: TikTok LIVE-chat, commands, moderatie en een Discord-beveiligd dashboard. Geen Electron, browserproces, database of frontendframework.

```sh
npm ci
# Kopieer .env.example naar .env en vul de eigen instellingen in.
npm run config:check
npm start
```

Open http://127.0.0.1:3000. De Windows-snelkoppeling start de server indien nodig en opent het dashboard. De server blijft werken als je het dashboard sluit. Standaard blijft de chat leeg tot je verbinding maakt; **Lokale test** toont uitsluitend voorbeeldchat.

Discord vereist `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` en `DISCORD_ADMIN_IDS`. Registreer exact `http://127.0.0.1:3000/auth/discord/callback`. Alleen toegelaten Discord-IDs krijgen toegang; beheerders beheren die lijst onder **Toegang**. Alle gebruikers bedienen dezelfde bot. Na een serverherstart moet je opnieuw inloggen.

**Compacte weergave** verkleint de tussenruimte en toont commandokaarten naast elkaar als er ruimte is. Deze voorkeur blijft in je browser bewaard. De commandeditor toont onopgeslagen wijzigingen in amber, bevestigde opslag in groen en fouten in rood. **Toon wijzigingen** springt naar de bewerking. Bij navigeren, herladen of uitloggen word je gewaarschuwd; je kunt opslaan, teruggaan of expliciet verwerpen.

## Samen gebruiken

Alle toegelaten Discord-gebruikers delen één LIVE-verbinding, bot, commandoconfiguratie en moderatielog. Er zijn maximaal tien gelijktijdige chatstreams (tabs). Verbinden/Stop heeft effect voor iedereen. Bij gelijktijdig opslaan wint één revisie; een verouderde versie krijgt een conflictmelding en behoudt de bewerkingen in het scherm. Andere editors krijgen een melding van nieuwe opslag. Uitloggen sluit alleen de eigen streams. Filters, lokaal negeren en handmatig markeren zijn per browser, geen gedeelde beoordelingen. Publieke toegang en afzonderlijke bots per gebruiker zijn nog niet ingericht; de server blijft lokaal gebonden.

## Bot en commands

`TIKTOK_CHAT_TRANSPORT=direct` gebruikt de rechtstreeks geteste TikTok-route. Daarvoor zijn `TIKTOK_SESSION_ID`, `TIKTOK_TARGET_IDC`, `TIKTOK_MS_TOKEN` en `TIKTOK_VERIFY_FP` van dezelfde botsessie nodig. De Community-sleutel `EULER_API_KEY` blijft voor de SDK-chatontvangst gebruikt. `BOT_USERNAME` moet bij de sessie horen; `BOT_ENABLED=true` schakelt commandverwerking in.

De standaardroute `euler` blijft beschikbaar en controleert Webcast Premium-rechten. `WHITELIST_AUTHENTICATED_SESSION_ID_HOST=api.eulerstream.com` staat alleen aan na toestemming om botcookies naar deze Euler-host te sturen. Directe botberichten gaan naar vaste TikTok-hosts.

De commandeditor toont de echte verdeling over chatberichten. Lange tekst wordt op woordgrenzen opgesplitst; een te lange link wordt geweigerd. Maximaal 1200 tekens en zes uitgaande berichten per antwoord, elk maximaal 200 tekens. Minimaal drie seconden tussen berichten, tien seconden tussen antwoordreeksen en maximaal tien botberichten per minuut. Een gebruiker en een trigger hebben minstens dertig seconden cooldown. Te drukke triggers worden overgeslagen; er ontstaat geen commandwachtrij. Wijzigingen of Stop breken een lopende reeks af.

Voeg onder **Aliases** maximaal tien alternatieve commands toe, gescheiden door komma’s, bijvoorbeeld `!dc, !community` voor `!discord`. Ze delen het antwoord, de aan/uit-instelling en cooldown van het hoofdcommando. Namen moeten uniek zijn over alle commands en aliases; de antwoordpreview herkent aliases ook.

## Moderatie en log

`TIKTOK_MODERATION_ENABLED=true` schakelt de directe moderatiekoppeling in. Het botaccount moet in de betreffende LIVE afzonderlijk mute- en/of blokkeerrechten hebben. Acties gebruiken gebruikersgegevens uit serverberichten of een actuele moderatielijst. Het bot modereert zichzelf, de host of andere moderators niet.

Dempen: 5, 30, 60 of 300 seconden, of de gehele LIVE. **⋯** naast een chatbericht of rechtsklikken opent een contextmenu voor dempen, blokkeren, lokaal negeren of expliciet markeren voor beoordeling. Het menu openen markeert niets. Bij ontbrekende rechten, verbinding of gebruikersgegevens staat de reden bij de uitgeschakelde acties. Onder **Moderatie** staan de gedempte en geblokkeerde gebruikers met **Dempen opheffen** en **Deblokkeren**. Er is geen automatische herhaling van acties. Op 2026-10-17 accepteerde TikTok de vier acties op een toegestaan testaccount; de gebruiker bevestigde de werking. TikTok weigerde een aparte muteproef op een moderator.

Het moderatielog bewaart Discord-gebruiker, doel, actie, tijd, duur en resultaat. De intentie wordt vóór de TikTok-actie opgeslagen; bij opslagfalen wordt niet gehandeld. Onzekere resultaten blijven herkenbaar en worden niet opnieuw uitgevoerd. Maximaal 1000 gebeurtenissen/1 MiB, zonder cookies, tokens of ruwe API-antwoorden. CLI-proeven zijn apart herkenbaar als **CLI-test (geen Discordsessie)**. Dit log dekt acties via deze app, niet handmatige acties in TikTok zelf.

## Herstel en credentials

`LIVE_AUTO_RECONNECT=true` herstelt een onderbroken verbinding met maximaal vijf oplopende pogingen. Stop annuleert herstel; authenticatiefouten starten geen lus. `LIVE_AUTO_CONNECT=true` verbindt na starten automatisch; dit staat standaard uit. Dashboardvernieuwing herstelt de gedeelde chat via SSE zonder een tweede TikTok-verbinding.

De botidentiteit wordt iedere vijf minuten gecontroleerd. Ontvangen cookieverversingen en vervaldatums worden in RAM verwerkt. Er is nog geen bewezen automatische vernieuwing van botlogin, msToken of verifyFp, en geen gegarandeerde geldigheidsduur. Bij chatfouten pauzeert verzending tot hercontrole. Bijgewerkte credentials vereisen een herstart; RAM-cookies overleven die niet.

Secrets blijven in `.env` of read-only gemounte secretbestanden. Ondersteunde `_FILE`-varianten en de private containeropzet staan in [DEPLOYMENT.md](DEPLOYMENT.md). Alleen `data/` vereist persistente opslag: commands, Discord-toegang en moderatielog. `.dev_docs/` staat uitsluitend lokaal in `.git/info/exclude`.

## Controles en GitHub

`npm run check` controleert types, bronlengte en verboden Git-bestanden. `npm test` gebruikt nepverzoeken en voert geen echte TikTok-acties uit. GitHub Actions draait deze controles op Linux en Windows en bouwt/test een private Docker-container met fictieve credentials, inclusief beveiliging en databehoud. De workflows publiceren of deployen niets en hebben geen TikTok/Discord-secrets nodig.

`npm run probe:tiktok -- --prepare-signed` en `npm run probe:tiktok-moderation -- --inspect @testaccount` zijn alleen-lezen diagnoses. De expliciete verzend-/moderatieproeven vragen aparte toestemming volgens AGENTS.md. Signerbronnen zijn op revisie en hashes vastgezet; TikToks echte SDK doet de ondertekening in een tijdelijk Node-proces. Geen automatische upstreamupdates of eigen signature-algoritme.
