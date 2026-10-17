# Private Docker-proef

Deze eerste containeropzet blijft op `127.0.0.1` luisteren. Eén gedeelde bot, één replica;
geen publiek domein of Coolify-proxy aansluiten. Gebruikersisolatie en publieke HTTPS-configuratie
zijn nog een aparte stap. De Compose-opzet gebruikt Linux host networking om de lokale binding te behouden.

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
`data/commands.json`, `data/access.json` en `data/moderation-audit.json` staan in het persistente volume. Back-up dat volume.
Containerhealth controleert alleen de webserver, niet of TikTok LIVE is of tokens geldig zijn.

Voor gemounte secretbestanden worden deze varianten ondersteund:
`DISCORD_CLIENT_SECRET_FILE`, `EULER_API_KEY_FILE`, `TIKTOK_SESSION_ID_FILE`,
`TIKTOK_TARGET_IDC_FILE`, `TIKTOK_MS_TOKEN_FILE`, `TIKTOK_VERIFY_FP_FILE`.
Gebruik per instelling de waarde óf de bestandsvariant. Mount bestanden read-only, leesbaar voor UID1000.
Wijzigingen aan credentials vereisen een herstart. De botcookieverversingen bestaan uitsluitend in RAM.

`LIVE_AUTO_RECONNECT=true` herstelt een onderbroken verbinding met begrensde wachttijden;
Stop annuleert herstel. `LIVE_AUTO_CONNECT=true` maakt na starten automatisch een verbinding;
standaard blijft dit uit. Geen bericht wordt opnieuw verstuurd.

De lokale moderatieproef is door TikTok geaccepteerd en door de gebruiker bevestigd. Nog te bewijzen vóór een publieke productieversie: langdurige tokenvernieuwing/herauthenticatie,
server-IP-acceptatie en HTTPS/gebruikersisolatie. Een lokale geslaagde chatproef
garandeert geen maandenlange serverlogin. Docker-build op een Docker-host controleren;
de ontwikkelomgeving heeft momenteel geen Docker-engine.

[Coolify Compose](https://coolify.io/docs/applications/builds/docker-compose) ·
[Docker servicereferentie](https://docs.docker.com/reference/compose-file/services/)
