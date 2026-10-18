# Docker en Coolify

## Publiek HTTPS-dashboard

Gebruik één gedeelde bot met Discord-toegang; dit maakt geen afzonderlijke bots per gebruiker.
De standaardconfiguratie en private Compose-bestanden blijven lokaal gebonden.
Publieke toegang vereist expliciet `PUBLIC_ORIGIN` en volledig ingestelde Discord-client, secret en vaste beheerders.
Bewaar echte domeinen en secrets uitsluitend in de runtimeconfiguratie, niet in Git.

Coolify-configuratie voor de publieke variant:

- Git-gebaseerde Compose-app; Base Directory `/`, Compose Location `/compose.coolify.public.yaml`.
- Advanced → Docker compose → Compose deployment: **Managed by Coolify**. Gebruik geen host networking.
- Advanced → Build → Build arguments: **Managed manually in Dockerfile**; secrets blijven runtimevariabelen.
- Environment Variables: `PUBLIC_ORIGIN=https://dashboard.example.com`, plus de bestaande Discord/Euler/TikTok-instellingen.
  Gebruik het eigen domein als runtimewaarde. `DISCORD_REDIRECT_URI` mag leeg zijn (automatisch afgeleid),
  of moet exact dezelfde origin met `/auth/discord/callback` bevatten.
- Registreer die exacte HTTPS-callback ook in de Discord Developer Portal onder OAuth2 → Redirects.
- Domains: HTTPS, eigen hostname, service `dashboard`, interne poort **3000**, pad leeg; HTTP → HTTPS ingeschakeld.
  De bezoekers-URL gebruikt geen `:3000`; de poort verwijst uitsluitend naar de container.
- DNS: wijs de hostname naar de Coolify-server. Bij Cloudflare-proxying: SSL/TLS **Full (strict)** en een geldig origin-certificaat.
  Coolify verzorgt TLS; poorten80/443 moeten de proxy bereiken. Publiceer poort3000 niet op de host.
- Behoud de bestaande resource en named volume `dashboard-data:/app/data`; gebruik één replica.
  De publieke variant gebruikt bridge networking met `HOST=0.0.0.0`, `PORT=3000` en `expose: 3000`.

Deploy na samenvoegen van de wijziging. Controleer `/health`, de loginpagina, HTTPS-callback en Discord-toegang;
onbekende Discord-IDs mogen niet binnenkomen. Test daarna opslaan en uitloggen.
Start met `BOT_ENABLED=false`, `TIKTOK_MODERATION_ENABLED=false`, `LIVE_AUTO_CONNECT=false`.
Echte TikTok-verzend-/moderatieproeven vereisen aparte toestemming.

De app vertrouwt uitsluitend de ingestelde origin, niet `X-Forwarded-Host` of `X-Forwarded-Proto`.
De proxy moet de oorspronkelijke Host behouden. OAuth- en sessiecookies gebruiken `Secure`, `HttpOnly`, `SameSite=Lax`.
API-mutaties vereisen de exacte HTTPS-origin en de bestaande requestheader; Discord-toegang blijft verplicht.
De lokale `/health` blijft voor Docker beschikbaar, andere lokale routes worden in publieke modus geweigerd.

`npm run config:check` controleert de runtimeconfiguratie zonder secrets te tonen.
CI test lokale en publieke requestgrenzen met fictieve credentials, plus beide containerconfiguraties op Linux.

## Private Docker-proef

Deze eerste containeropzet blijft op `127.0.0.1` luisteren. Eén gedeelde bot, één replica;
geen publiek domein of Coolify-proxy aansluiten. De private Compose-opzet gebruikt Linux host networking.

## Eerste private versie

Gebruik in Coolify een Git-gebaseerde Compose-app met Base Directory `/` en Compose Location `/compose.coolify.yaml`.
Deze variant verwijst expliciet naar Coolify-runtimevariabelen en vereist geen meegestuurde `.env`.
Vul de vereiste velden in Environment Variables; het standaard Compose-bestand blijft voor lokale Docker-proeven beschikbaar.
Kies Advanced → Docker compose → Compose deployment → Raw (deploy file as-is), zodat host networking behouden blijft.
Gebruik geen predefined network of domein. Zet build arguments op Managed manually in Dockerfile; secrets zijn uitsluitend runtimevariabelen.
De callback wordt lokaal uit HOST/PORT opgebouwd, standaard `http://127.0.0.1:3000/auth/discord/callback`.

De app is technisch geschikt voor een private alpha: Discord-toegang, gedeelde bot, moderatie/audit,
privé-cookieopslag en Docker-smoketests zijn aanwezig. Nog niet bewezen: TikTok-acceptatie vanaf jouw server-IP
en langere LIVE-sessies zonder herlogin.

- Stop de lokale bot vóór de overstap; gebruik één actieve instantie voor dit kanaal.
- Start op Coolify eerst met `BOT_ENABLED=false`, `TIKTOK_MODERATION_ENABLED=false` en `LIVE_AUTO_CONNECT=false`.
  Controleer via de SSH-tunnel Discord-login, diagnose, anonieme ontvangst en de botsessie zonder berichten te sturen.
- Vul de Coolify-runtimeomgeving/privé-`.env` met de bootstrapcredentials en Discord/Euler-instellingen.
  Behoud de named datavolume, UID1000, host networking en localhostbinding; stel geen domein/router in.
- Beheerders kunnen daarna onder Instellingen → Botcookies herstellen de vier TikTok-cookies vernieuwen.
  Dit stopt LIVE, verifieert het vaste BOT_USERNAME en schrijft alleen bij correcte identiteit naar het volume.
  Waarden worden niet teruggelezen of in de browser bewaard. Herstel logt alleen Discord-ID en tijd in het serverlog.
- Schakel bot/moderatie pas na die controle in via de serverconfiguratie. Aanvullende echte schrijfproeven
  vragen nog steeds toestemming volgens AGENTS.md. Controleer na een containerherstart dat de sessiestatus klopt.

Een toekomstige browser-exporttool hoort op de eigen pc te draaien: handmatig inloggen/challenges oplossen,
alleen de vier benodigde cookievelden meenemen en via het beheerdersformulier overdragen. De Coolify-host
heeft daarvoor geen browser nodig. Automatische herlogin is hiermee nog niet geregeld.

1. Kopieer `.env.example` naar een lokale `.env` buiten Git en vul de eigen instellingen in.
2. Registreer `http://127.0.0.1:3000/auth/discord/callback` bij Discord.
3. Controleer lokaal met `npm run config:check` (toont geen secretwaarden).
4. Op een Linux-server: `docker compose up -d --build`.
5. Bereik het dashboard via een SSH-tunnel: `ssh -L 3000:127.0.0.1:3000 gebruiker@server`.
   Open lokaal `http://127.0.0.1:3000`. De lokale poort moet vrij zijn.

Voor een private Coolify Compose-proef: gebruik deze definitie zonder domein/router,
behoud host networking en beheer de runtime-instellingen via de resourceconfiguratie.
Maak `.env` uitsluitend op de server beschikbaar; commit dit bestand nooit.
Controleer vooraf of poort 3000 vrij is. Geen tweede replica starten.

De image draait als niet-root met uitsluitend runtime-dependencies en vooraf gecontroleerde
openbare signerbestanden. Secrets komen pas bij starten binnen; niet via build arguments.
Eén herbruikbare signerworker start pas bij ondertekening, heeft64MiB heap en geen netwerktoegang.
Na100 aanvragen, RSS boven128MiB, een fout of15 minuten inactiviteit sluit hij; de volgende aanvraag
mag een nieuw proces starten. Een mislukte aanvraag wordt nooit automatisch opnieuw verstuurd.
`data/commands.json`, `data/access.json`, `data/moderation-audit.json`, `data/filters.json`, `data/branding.json` en in direct-modus `data/tiktok-session.json` staan in het persistente volume. Het sessiebestand bevat logincredentials: houd het volume en eventuele back-ups privé. Linuxbestandsrechten zijn0600. Het dashboardicoon wordt via een afzonderlijke openbare afbeeldingsroute aangeboden; de bestanden in het volume zijn niet rechtstreeks via HTTP beschikbaar.
Containerhealth controleert alleen de webserver, niet of TikTok LIVE is of tokens geldig zijn.

Voor gemounte secretbestanden worden deze varianten ondersteund:
`DISCORD_CLIENT_SECRET_FILE`, `EULER_API_KEY_FILE`, `TIKTOK_SESSION_ID_FILE`,
`TIKTOK_TARGET_IDC_FILE`, `TIKTOK_MS_TOKEN_FILE`, `TIKTOK_VERIFY_FP_FILE`.
Gebruik per instelling de waarde óf de bestandsvariant. Mount bestanden read-only, leesbaar voor UID1000.
Wijzigingen aan credentials vereisen een herstart. Ontvangen cookie-rotaties, expiries en verwijderingen worden atomair opgeslagen; ongewijzigde bootstrapcredentials gebruiken de bewaarde state. Nieuwe env/secretfilecredentials vervangen die state voor de volgende sessie. Beschadigde of onveilig leesbare state blokkeert startup; bewaar die uitsluitend lokaal voor onderzoek en herstel daarna met actuele botcookies. Dit automatiseert geen herlogin of challenge-oplossing.

In direct-modus ontvangt de SDK zonder TikTok-accountcookies; de lokale sender beheert ze apart.
Instellingen toont sessiestatus en serverdiagnose. `/api/readiness` en `/api/diagnostics` zijn authenticated JSON-interfaces;
gebruik ze niet als Docker-healthcheck. `/health` blijft proces-liveness.

`LIVE_AUTO_RECONNECT=true` herstelt een onderbroken verbinding met begrensde wachttijden;
Stop annuleert herstel. `LIVE_AUTO_CONNECT=true` maakt na starten automatisch een verbinding;
standaard blijft dit uit. Geen bericht wordt opnieuw verstuurd.

De lokale moderatieproef is door TikTok geaccepteerd en door de gebruiker bevestigd. Nog te bewijzen vóór een publieke productieversie: langdurige tokenvernieuwing/herauthenticatie,
server-IP-acceptatie en gebruikersisolatie. Een lokale geslaagde chatproef
garandeert geen maandenlange serverlogin. Docker-build op een Docker-host controleren;
de ontwikkelomgeving heeft momenteel geen Docker-engine.

[Coolify Compose](https://coolify.io/docs/applications/builds/docker-compose) ·
[Docker servicereferentie](https://docs.docker.com/reference/compose-file/services/)
