import { element, escapeHTML, toast } from './dom.js';
import { saveSettings } from './filters.js';
import { pending, state } from './model.js';

export function renderPage(onChange: () => void): void {
  const node = element('#otherpage');
  if (state.page === 'Overzicht') {
    node.innerHTML = `<h2>Overzicht</h2><p>Faynominaal LIVE Dashboard · demo of LIVE-chat</p>
      <p>${state.messages.length} berichten · ${pending().length} te beoordelen · ${state.activity.length} demoacties.</p>
      <p>Livechat en herkenning van verdachte berichten zijn lokaal uit te proberen. TikTok LIVE is beschikbaar via Verbinden.
      Gedeelde moderatoraccounts en echte dempacties zijn nog niet aangesloten.</p>`;
  } else if (state.page === 'Moderatie') {
    node.innerHTML = '<h2>Moderatiegeschiedenis · demo</h2>' + (state.activity.length
      ? state.activity.map(line => `<p>${escapeHTML(line)}</p>`).join('')
      : '<p>Nog geen acties. Beoordeel een bericht op de pagina Livechat.</p>');
  } else if (state.page === 'Filters') {
    const settings = state.settings;
    node.innerHTML = `<h2>Filters</h2><p>Deze regels markeren berichten voor beoordeling. Er wordt niemand automatisch gedempt.</p>
      <label><input id="links" type="checkbox" ${settings.links ? 'checked' : ''}>Links markeren</label>
      <label><input id="spam" type="checkbox" ${settings.spam ? 'checked' : ''}>Herhaalde teksten markeren</label>
      <label><input id="swearing" type="checkbox" ${settings.swearing ? 'checked' : ''}>Woordenlijst inschakelen</label>
      <label>Woorden gescheiden door komma’s<textarea id="words" maxlength="4000">${escapeHTML(settings.words)}</textarea></label>
      <button id="save">Filters opslaan</button>`;
    element('#save').onclick = () => {
      state.settings = {
        links: element<HTMLInputElement>('#links').checked,
        spam: element<HTMLInputElement>('#spam').checked,
        swearing: element<HTMLInputElement>('#swearing').checked,
        words: element<HTMLTextAreaElement>('#words').value
      };
      try { saveSettings(state.settings); toast('Filters opgeslagen.'); }
      catch { toast('Filters actief voor deze sessie; opslaan is niet gelukt.'); }
      onChange();
    };
  } else if (state.page === 'Instellingen') {
    node.innerHTML = `<h2>Instellingen</h2><p>Kanaal: @${escapeHTML(state.username)}<br>Modus: lokaal webdashboard<br>
      TikTok-verbinding: zie status bovenaan</p><p>Klik bovenaan op Verbinden om de chat te laden zodra het kanaal live is.
      Echte dempacties en synchronisatie tussen moderators vereisen daarna een afzonderlijk geteste koppeling.</p>
      <p>TikTok-cookies en API-sleutels worden uitsluitend op de server ingesteld.</p>`;
  }
}
