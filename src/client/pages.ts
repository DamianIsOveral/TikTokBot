import { element, escapeHTML } from './dom.js';
import { mountFilters } from './filter-editor.js';
import { pending, state } from './model.js';
import { mountCommands } from './commands.js';
import { mountAccess } from './access.js';
import { mountChatAccess } from './capabilities.js';
import { mountModeration } from './moderation.js';
import {mountDiagnostics} from './diagnostics.js';
import {mountCredentials} from './credentials.js';
import {mountBranding} from './branding.js';
import {canOpenPage} from './auth.js';

export function renderPage(onChange: () => void): void {
  const node = element('#otherpage');
  if (!canOpenPage(state.page)) {
    node.innerHTML='<h2>Geen toegang</h2><p>Je dashboardrol geeft geen toegang tot deze pagina.</p>';
    return;
  }
  if (state.page === 'Toegang') {
    mountAccess();
  } else if (state.page === 'Commands') {
    mountCommands();
  } else if (state.page === 'Overzicht') {
    node.innerHTML = `<h2>Overzicht</h2><p>Faynominaal LIVE Dashboard</p>
      <p>${state.messages.length} berichten · ${pending().length} te beoordelen · ${state.activity.length} demoacties.</p>
      <p>Livechat en herkenning van verdachte berichten zijn lokaal uit te proberen. TikTok LIVE is beschikbaar via Verbinden.
      Discord-toegang is beschikbaar. Moderatieacties en hun log staan op de pagina Moderatie.</p>`;
  } else if (state.page === 'Moderatie') {
    mountModeration();
  } else if (state.page === 'Filters') {
    mountFilters(onChange);
  } else if (state.page === 'Instellingen') {
    node.innerHTML = `<h2>Instellingen</h2><p>Kanaal: @${escapeHTML(state.username)}<br>Botaccount: @${escapeHTML(state.botUsername)}<br>Modus: gedeeld webdashboard<br>
      TikTok-verbinding: zie status bovenaan</p><p>Klik bovenaan op Verbinden om de chat te laden zodra het kanaal live is.
      Onder Moderatie staan de herstelacties en het gedeelde actielog met Discord-gebruikers.</p>
      <p>API-sleutels blijven serverinstellingen. Beheerders kunnen de cookies van de gedeelde bot via dit dashboard vernieuwen.</p>`;
    mountChatAccess(node);
    mountCredentials(node);
    mountDiagnostics(node);
    mountBranding(node);
  }
}
