# Faynominaal LIVE

Eén lichte Node.js 24-app in TypeScript: TikTok LIVE-chat, commands, moderatie en een Discord-beveiligd dashboard. Geen Electron, browserproces, database of frontendframework.

```sh
npm ci
# Kopieer .env.example naar .env en vul de eigen instellingen in.
npm run config:check
npm start
```

Open http://127.0.0.1:3000. De Windows-snelkoppeling start de server indien nodig en opent het dashboard. De server blijft werken als je het dashboard sluit. Standaard blijft de chat leeg tot je verbinding maakt; **Lokale test** toont uitsluitend voorbeeldchat.

Discord vereist `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` en `DISCORD_ADMIN_IDS`. Registreer exact `http://127.0.0.1:3000/auth/discord/callback`. Alleen toegelaten Discord-IDs krijgen toegang; beheerders beheren die lijst onder **Toegang**. Alle gebruikers delen dezelfde bot. Na een serverherstart moet je opnieuw inloggen.

Onder **Toegang** kun je per Discord-ID een opmerking van maximaal 120 tekens bewaren, ook bij vaste beheerders. Deze opmerkingen wijzigen geen rechten.

**Compacte weergave** verkleint de tussenruimte en toont commandokaarten naast elkaar als er ruimte is. Deze voorkeur blijft in je browser bewaard. De commandeditor toont onopgeslagen wijzigingen in amber, bevestigde opslag in groen en fouten in rood. **Toon wijzigingen** springt naar de bewerking. Bij navigeren, herladen of uitloggen word je gewaarschuwd; je kunt opslaan, teruggaan of expliciet verwerpen.

**Gebruikerskleuren** is een aparte browservoorkeur: dezelfde @naam houdt dezelfde leesbare kleur. **MOD** markeert door TikTok bevestigde moderators; **BOT** blijft het eigen botaccount aanduiden. De navigatie gebruikt vaste icoon- en tekstkolommen.

## Samen gebruiken

Dashboardrollen staan los van TikTok-rollen. **Moderator** kan de LIVE bekijken en modereren. **Hoofd-Moderator** kan daarnaast commands en gedeelde filters bewerken en de LIVE-verbinding starten/stoppen. **Beheerder** beheert ook de Discord-toegang, botcookies en het dashboardicoon. Bestaande gebruikers worden Moderator; hun opgeslagen rol `member` blijft compatibel en krijgt geen extra rechten. Alleen een beheerder kan iemand Hoofd-Moderator maken. De server controleert deze rechten bij ieder verzoek; een rolwijziging geldt ook voor bestaande sessies.

Alle toegelaten Discord-gebruikers delen één LIVE-verbinding, bot, commandoconfiguratie, filterinstellingen en moderatielog. Er zijn maximaal tien gelijktijdige chatstreams (tabs). Verbinden/Stop heeft effect voor iedereen. Bij gelijktijdig opslaan wint één revisie; een verouderde versie krijgt een conflictmelding en behoudt de bewerkingen in het scherm. Andere editors krijgen een melding van nieuwe opslag. Uitloggen sluit alleen de eigen streams. Lokaal negeren en handmatig markeren blijven per browser; filters markeren berichten ter beoordeling en voeren geen automatische moderatie uit. De server blijft standaard lokaal gebonden. Publieke HTTPS-toegang via Coolify vereist expliciete runtimeconfiguratie volgens [DEPLOYMENT.md](DEPLOYMENT.md); alle gebruikers blijven dezelfde bot delen.

Onder **Weergave** staan persoonlijke voorkeuren voor kleuren, compactheid, afwisselende rijkleur en hoog contrast. Rollen en beoordelingen hebben ook tekstlabels. Het optionele paneel **LIVE-activiteit** toont binnenkomers, cadeaus, volgers en gedeelde LIVE's, met maximaal honderd gebeurtenissen. De cooldownstrook op Livechat toont de gedeelde wachttijd, actieve commandcooldowns en resterende berichtbudgetten. Een individuele kijker kan daarnaast nog een eigen cooldown hebben.

De knop boven het linkermenu klapt de navigatie in of uit. Op brede schermen kun je de scheidingslijn tussen Livechat en Verdachte berichten verslepen; met focus op de lijn werken ook de pijltoetsen. Enter of dubbelklikken herstelt de standaardverdeling. Menu en paneelverdeling blijven per browser bewaard; op smalle schermen staan de panelen onder elkaar.

Beheerders kunnen bij Discord-toegang een korte herkenningsnotitie toevoegen en onder **Instellingen → Dashboardicoon** een gedeeld icoon uploaden. Dat verschijnt naast het kanaal en als favicon; zonder upload valt het dashboard terug op een letter. PNG, JPG en WebP worden in de browser naar een begrensde PNG omgezet en op de server gevalideerd. Alleen dit icoon is openbaar beschikbaar; bestaande botcookies worden nooit door dashboard-API's teruggestuurd.

## Bot en commands

`TIKTOK_CHAT_TRANSPORT=direct` gebruikt de rechtstreeks geteste TikTok-route. Daarvoor zijn `TIKTOK_SESSION_ID`, `TIKTOK_TARGET_IDC`, `TIKTOK_MS_TOKEN` en `TIKTOK_VERIFY_FP` van dezelfde botsessie nodig. De Community-sleutel `EULER_API_KEY` blijft voor de SDK-chatontvangst gebruikt. `BOT_USERNAME` moet bij de sessie horen; `BOT_ENABLED=true` schakelt commandverwerking in.

De standaardroute `euler` blijft beschikbaar en controleert Webcast Premium-rechten. `WHITELIST_AUTHENTICATED_SESSION_ID_HOST=api.eulerstream.com` staat alleen aan na toestemming om botcookies naar deze Euler-host te sturen. Directe botberichten gaan naar vaste TikTok-hosts.

In **direct**-modus ontvangt de connector anoniem: alleen de Euler-signingsleutel gaat naar de ontvangstdienst, geen TikTok-accountcookies. De lokale direct-client bewaart die afzonderlijk. `BOT_USERNAME` is de verwachte botnaam zonder @ (standaard `faynominaalbot`). TikTok moet dezelfde identiteit bevestigen voordat de bot mag verzenden. Eigen chatberichten krijgen een BOT-label op basis van het gecontroleerde gebruikers-ID, met naam als fallback; de automatische dashboardfilters slaan ze over. Andere kijkers met dezelfde tekst blijven beoordeeld worden. Handmatig beoordelen blijft mogelijk.

Onder **Globale botberichtlimieten** stel je de gedeelde pauze (30–300 seconden) en het maximum in een schuivend uurvenster (5–120 berichten) in. Standaard: **30 seconden en 20 berichten per uur**. Dit zijn eigen volumelimieten, geen door TikTok gegarandeerde veilige grenzen. Elk deelbericht telt mee, ook bij mislukte verzending; een antwoord dat niet volledig in het resterende uurmaximum past wordt overgeslagen. Geen commandwachtrij. Het budget blijft bij herverbinden behouden; een serverherstart begint opnieuw. Een gebruiker en een hoofdcommando hebben daarnaast minstens dertig seconden cooldown; tussen antwoordreeksen zit minstens tien seconden pauze.

De editor toont de verdeling en duur na taginvulling, met een bovengrens voor de langste namen. Lange tekst wordt op woordgrenzen opgesplitst; een te lange link wordt geweigerd. Maximaal 1200 tekens en zes uitgaande berichten per antwoord, elk maximaal 150 tekens als eigen voorzichtige grens. Tijdens één antwoordreeks worden andere commands overgeslagen. Wijzigingen of Stop breken de reeks af, inclusief een actieve wachttimer.

Voeg tags toe met de knoppen bij het antwoord: `{username}` (zonder @), `{displayname}` (maximaal 40 tekens), `{channel}` en `{command}` (hoofdcommando). Bijvoorbeeld: `Hey {username}, onze Discord: https://discord.gg/voorbeeld`. Tags worden als tekst ingevuld; er wordt geen code uitgevoerd. De preview gebruikt een instelbare voorbeeldgebruikersnaam en verstuurt niets. Statische tekst blijft toegestaan; er worden geen willekeurige tekens of tijdstempels toegevoegd.

**Wie mag dit gebruiken?** beperkt de TikTok-kijkers tot moderators/host, abonnees plus moderators/host, of topgifters plus abonnees/moderators/host. Topgifters vereist een herkende top-3-badge; ontbrekende rolgegevens geven geen toegang tot beperkte commands. Nieuwe commands starten met moderators/host; bestaande commands zonder toegangsregel blijven voor alle kijkers beschikbaar. Discord-dashboardtoegang is hiervan onafhankelijk.

Voeg onder **Aliases** maximaal tien alternatieve commands toe, gescheiden door komma’s, bijvoorbeeld `!dc, !community` voor `!discord`. Ze delen het antwoord, de aan/uit-instelling en cooldown van het hoofdcommando. Namen moeten uniek zijn over alle commands en aliases; de antwoordpreview herkent aliases ook.

## Moderatie en log

`TIKTOK_MODERATION_ENABLED=true` schakelt de directe moderatiekoppeling in. Het botaccount moet in de betreffende LIVE afzonderlijk mute- en/of blokkeerrechten hebben. Acties gebruiken gebruikersgegevens uit serverberichten of een actuele moderatielijst. Het bot modereert zichzelf, de host of andere moderators niet.

Dempen: 5, 30, 60 of 300 seconden, of de gehele LIVE. **⋯** naast een chatbericht of rechtsklikken opent een contextmenu voor dempen, blokkeren, lokaal negeren of expliciet markeren voor beoordeling. Het menu openen markeert niets. Bij ontbrekende rechten, verbinding of gebruikersgegevens staat de reden bij de uitgeschakelde acties. Onder **Moderatie** staan de gedempte en geblokkeerde gebruikers met **Dempen opheffen** en **Deblokkeren**. Er is geen automatische herhaling van acties. Op 2026-10-17 accepteerde TikTok de vier acties op een toegestaan testaccount; de gebruiker bevestigde de werking. TikTok weigerde een aparte muteproef op een moderator.

Het moderatielog bewaart Discord-gebruiker, doel, actie, tijd, duur en resultaat. De intentie wordt vóór de TikTok-actie opgeslagen; bij opslagfalen wordt niet gehandeld. Onzekere resultaten blijven herkenbaar en worden niet opnieuw uitgevoerd. Maximaal 1000 gebeurtenissen/1 MiB, zonder cookies, tokens of ruwe API-antwoorden. CLI-proeven zijn apart herkenbaar als **CLI-test (geen Discordsessie)**. Dit log dekt acties via deze app, niet handmatige acties in TikTok zelf.

## Herstel en credentials

`LIVE_AUTO_RECONNECT=true` herstelt een onderbroken verbinding met maximaal vijf oplopende pogingen. Stop annuleert herstel; authenticatiefouten starten geen lus. `LIVE_AUTO_CONNECT=true` verbindt na starten automatisch; dit staat standaard uit. Dashboardvernieuwing herstelt de gedeelde chat via SSE zonder een tweede TikTok-verbinding.

De botidentiteit wordt iedere vijf minuten gecontroleerd. Ontvangen cookieverversingen en vervaldatums worden verwerkt en in direct-modus atomair bewaard in `data/tiktok-session.json` (privébestand, Linux0600). Alleen gewijzigde cookies worden opgeslagen. Geldige opgeslagen waarden overleven een herstart; verwijderingen en expiries blijven bewaard en vallen niet terug op oude `.env`-waarden. De state hoort bij het botaccount en de bootstrapcredentials: wijzig je `.env`/`*_FILE`-cookies, dan begint de app na herstart met die nieuwe waarden. Deel dit sessiebestand en back-ups ervan nooit; het bevat echte logincredentials.

Dit bewaart ontvangen rotaties, maar vernieuwt geen verlopen login uit zichzelf. Langdurige automatische herauthenticatie van botlogin, msToken of verifyFp blijft onbewezen. Bij authenticatiefouten, een challenge of429 stopt verzending tot handmatige hercontrole. Instellingen toont de sessiestatus en een handmatig verversbare diagnose met tellers, RAM en signerlatency. `/api/readiness` en `/api/diagnostics` vereisen Discord; `/health` blijft alleen proces-liveness, zodat een offline LIVE geen containerherstart veroorzaakt.

Onder **Instellingen → Botcookies herstellen** kunnen Discord-beheerders de vier cookies van dezelfde botsessie invullen. Dit stopt de gedeelde LIVE, controleert het vaste botaccount en bewaart alleen een geldige sessie privé op de server. Bestaande waarden worden nooit teruggestuurd; de invoervelden worden na afloop gewist. Gewone dashboardleden krijgen geen toegang. De `.env` blijft bootstrap: dashboardherstel overleeft herstarts zolang die bootstrap niet wordt gewijzigd. Discord/Euler-sleutels blijven serverinstellingen. Er is nog geen browser-exporttool.

De signer gebruikt één geïsoleerde, herbruikbare Node-worker met verse TikTok-context per aanvraag. Geen extra dependencies of netwerk in die worker. Hij stopt bij fouten, na100 aanvragen, boven128MiB RSS of na15 minuten inactiviteit; een volgende aanvraag mag opnieuw starten. Geen automatische herhaling van een mislukte aanvraag. Zie DEPLOYMENT.md voor de private alpha en nog onbewezen server-IP/duurproeven.

Secrets blijven in `.env` of read-only gemounte secretbestanden. Ondersteunde `_FILE`-varianten en de private containeropzet staan in [DEPLOYMENT.md](DEPLOYMENT.md). Alleen `data/` vereist persistente opslag: commands, Discord-toegang, moderatielog, gedeelde filters, dashboardicoon en de directe botsessie. Houd servertoegang en back-ups privé; beheerders daarvan kunnen de opgeslagen credentials lezen.

## Controles en GitHub

De broncode valt onder de [GNU GPL versie 3](LICENSE) (`GPL-3.0-only`).

`npm run check` controleert types, bronlengte en verboden Git-bestanden. `npm test` gebruikt nepverzoeken en voert geen echte TikTok-acties uit. `npm run test:coverage` meet geladen server/shared-modules met Node zelf; minimum94% regels/90% branches/93% functies (frontend en nooit geïmporteerde modules vallen buiten deze meting). `npm run audit:prod` controleert runtime-dependencies op bekende kwetsbaarheden. GitHub Actions draait check/coverage/audit op Linux en Windows en bouwt/test een private Docker-container met fictieve credentials, inclusief beveiliging en databehoud. De workflows publiceren of deployen niets en hebben geen TikTok/Discord-secrets nodig.

`npm run probe:tiktok -- --prepare-signed` en `npm run probe:tiktok-moderation -- --inspect @testaccount` zijn alleen-lezen diagnoses. De expliciete verzend-/moderatieproeven vragen aparte toestemming volgens AGENTS.md. Signerbronnen zijn op revisie en hashes vastgezet; TikToks echte SDK doet de ondertekening in een tijdelijk Node-proces. Geen automatische upstreamupdates of eigen signature-algoritme.
