# Faynominaal LIVE

Eén Node.js 24-app in TypeScript met browserdashboard, TikTok LIVE-chat en optionele botantwoorden. Eén serverproces, geen Electron of database. Alleen de browsercode wordt naar JavaScript gecompileerd; de server draait TypeScript rechtstreeks via Node.js.

```sh
npm ci
# Kopieer .env.example naar .env en vul de gewenste instellingen in.
npm start
```

Open [het dashboard](http://127.0.0.1:3000). `npm run dev` herstart de server bij wijzigingen. `npm run check` en `npm test` controleren de app zonder TikTok te benaderen.

`npm run build` compileert de browsercode naar `dist/browser`; `npm start` en de Windows-snelkoppeling doen dat automatisch. Bij browserwijzigingen tijdens `npm run dev`: voer opnieuw `npm run build` uit en vernieuw de pagina. `npm run typecheck` controleert server, browser en tests met strikte types. `npm run start:server` start alleen de server als de browsercode al gebouwd is; hiervoor is de TypeScript-compiler niet nodig.

De code is gescheiden in `src/server/` (bot en server), `src/server/http/` (routes, beveiliging, assets en SSE), `src/client/` (dashboardmodules) en `src/shared/` (eventtypes). `public/` bevat alleen HTML en CSS. TypeScript en Node-types zijn uitsluitend ontwikkeldependencies.

Windows: de snelkoppeling **Faynominaal Dashboard** op het bureaublad start de server op de achtergrond als dat nodig is en opent daarna je standaardbrowser. De server blijft draaien wanneer je de browser sluit. De launcher staat in `scripts/open-dashboard.ps1` en respecteert HOST/PORT uit `.env`.

Klik op Verbinden om één gedeelde TikTok-verbinding te starten. Zonder credentials wordt alleen publieke chat geprobeerd. Voor botantwoorden zijn alle drie TikTok/Euler-instellingen én `BOT_ENABLED=true` nodig. De bot reageert op `!discord`, `!socials` en `!dono`, met 60 seconden cooldown en minimaal één seconde tussen berichten. Dempen en moderatoracties blijven lokale demoacties.

De laatste 500 liveberichten blijven in het servergeheugen beschikbaar bij vernieuwen, een tweede tabblad of herstel van de browserverbinding. Stop bewaart deze berichten; opnieuw verbinden begint een lege chat. Een serverherstart wist de chat. De knop Demo toont lokale voorbeelden zonder de gedeelde verbinding te stoppen; Livechat tonen haalt de serverchat weer op. Filters en demoacties blijven per browser lokaal.

De server accepteert uitsluitend lokale hosts zolang login ontbreekt. Discord OAuth, gebruikersisolatie en publieke Coolify/Docker-deployment volgen later. Eén gedeeld kanaal is nog geen omgeving voor meerdere accounts. Maak geen publieke tunnel of proxy naar deze versie.

Secrets blijven in `.env`, buiten Git en toekomstige Docker-context. `.env.example` bevat geen secrets. Oude projecten staan lokaal in `.local-archive`, buiten Git. Lokale werkaantekeningen staan in `.dev_docs`; `AGENTS.md` verwijst nieuwe chats ernaar. Configureer op een nieuwe checkout zelf `.dev_docs/` in `.git/info/exclude`.
