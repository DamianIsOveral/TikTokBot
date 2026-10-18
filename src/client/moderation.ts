import { element, escapeHTML, toast } from './dom.js';
import { state } from './model.js';
import type { AuditEntry } from '../shared/moderation.js';

interface Access { connected: boolean; enabled: boolean; mute: boolean; ban: boolean; reason: string }
interface List { users: { userId: string; name: string }[]; hasMore: boolean; cursor: string }
const actionNames = { mute: 'Dempen', unmute: 'Dempen opheffen', ban: 'Blokkeren', unban: 'Deblokkeren' };
let pendingAccess: Promise<void> | undefined;

export async function refreshModerationAccess(): Promise<void> {
  if (!state.liveMode || !state.serverConnected || state.phase !== 'connected') {
    state.moderation = { connected:false, enabled:false, mute:false, ban:false,
      reason: !state.liveMode ? 'Lokale test: er worden geen TikTok-acties uitgevoerd.' : 'Verbind eerst met TikTok LIVE.' };
    return;
  }
  if (pendingAccess) return pendingAccess;
  pendingAccess = (async () => { try {
    const response = await fetch('/api/moderation');
    const access = await response.json() as Access & { error?: string };
    if (!response.ok) throw new Error(access.error || 'Moderatierechten konden niet worden gecontroleerd.');
    if (state.liveMode && state.serverConnected && state.phase === 'connected') state.moderation = access;
  } catch (error) { state.moderation = { connected: false, enabled: false, mute: false, ban: false,
    reason: error instanceof Error && error.message.length < 300 && !/fetch|network|json/i.test(error.message)
      ? error.message : 'Moderatierechten konden niet worden gecontroleerd.' }; }
  })().finally(() => { pendingAccess = undefined; });
  return pendingAccess;
}

async function action(input: Record<string, unknown>): Promise<void> {
  if (!state.liveMode || !state.serverConnected || state.phase !== 'connected') throw new Error('Sluit de lokale test af en verbind met TikTok LIVE.');
  const response = await fetch('/api/moderation', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'faynominaal' }, body: JSON.stringify(input) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || 'Moderatie mislukt.');
}

export async function moderateMessage(actionName: 'mute' | 'ban', messageId: number, duration: number): Promise<boolean> {
  try {
    await action({ action: actionName, messageId, ...(actionName === 'mute' ? { duration } : {}) });
    toast(`${actionNames[actionName]} door TikTok geaccepteerd.`);
    return true;
  } catch (error) { toast(error instanceof Error ? error.message : 'Moderatie mislukt.'); return false; }
}

export function mountModeration(): void {
  const root = document.createElement('div');
  root.className = 'moderation-page';
  root.innerHTML = `<div class="moderation-heading"><div><h2>Moderatie</h2>
    <p>Beheer dempingen en blokkeringen van deze LIVE.</p></div><button data-refresh>Vernieuwen</button></div>
    <p class="moderation-status" data-state role="status">Rechten controleren…</p>
    <div class="moderation-lists">
      <section class="moderation-panel" aria-labelledby="muted-title"><div class="moderation-panel-heading">
        <h3 id="muted-title">Gedempte gebruikers</h3><span class="moderation-count" data-count-muted>—</span></div>
        <div class="moderation-list-body" data-muted></div></section>
      <section class="moderation-panel" aria-labelledby="blocked-title"><div class="moderation-panel-heading">
        <h3 id="blocked-title">Geblokkeerde gebruikers</h3><span class="moderation-count" data-count-blocked>—</span></div>
        <div class="moderation-list-body" data-blocked></div></section>
    </div>
    <p class="moderation-note">Dempen geldt voor de gekozen tijd of de gehele LIVE. Een blokkering hef je apart op.
      Andere moderators kunnen niet worden gedempt of geblokkeerd.</p>
    <section class="moderation-panel moderation-audit" aria-labelledby="audit-title">
      <div class="moderation-panel-heading"><div><h3 id="audit-title">Moderatielog</h3>
        <p>Laatste 100 acties · vernieuwt elke 15 seconden</p></div></div>
      <div class="moderation-audit-scroll" data-audit></div></section>`;
  element('#otherpage').replaceChildren(root);
  let busy = false;
  const pages = { muted: 0, blocked: 0 };
  const cursors: Record<'muted' | 'blocked', string[]> = { muted: [''], blocked: [''] };
  const find = (selector: string) => root.querySelector<HTMLElement>(selector)!;

  async function loadAudit() {
    try {
      const response = await fetch('/api/moderation/audit');
      if (!response.ok) throw new Error();
      const result = await response.json() as { entries: AuditEntry[] };
      if (!root.isConnected) return;
      const statusNames = { pending: 'Uitkomst nog niet bevestigd', accepted: 'Geaccepteerd', rejected: 'Geweigerd', uncertain: 'Uitkomst onbekend' };
      find('[data-audit]').innerHTML = result.entries.length ? `<table class="moderation-audit-table">
        <thead><tr><th>Tijd</th><th>Beheerder</th><th>Actie en gebruiker</th><th>Resultaat</th></tr></thead><tbody>`
        + result.entries.map(entry => `<tr>
          <td><time datetime="${escapeHTML(entry.at)}">${escapeHTML(new Date(entry.at).toLocaleTimeString('nl-NL'))}
            <small>${escapeHTML(new Date(entry.at).toLocaleDateString('nl-NL'))}</small></time></td>
          <td><strong>${escapeHTML(entry.actor.name)}</strong><small>${escapeHTML(entry.actor.id)}</small></td>
          <td><strong>${escapeHTML(actionNames[entry.action])}${entry.action === 'mute'
            ? entry.duration === 0 ? ' · gehele LIVE' : ` · ${entry.duration}s` : ''}</strong>
            <span>${escapeHTML(entry.target.name)}</span><small>${escapeHTML(entry.target.id)}</small></td>
          <td><span class="moderation-result" data-result="${escapeHTML(entry.status)}">${escapeHTML(statusNames[entry.status])}</span>
            ${entry.reason ? `<small>${escapeHTML(entry.reason)}</small>` : ''}</td></tr>`).join('')
        + '</tbody></table>' : '<p class="moderation-empty">Nog geen moderatieacties.</p>';
    } catch { if (root.isConnected) find('[data-audit]').textContent = 'Moderatielog laden mislukt.'; }
  }

  async function loadList(kind: 'muted' | 'blocked') {
    const node = find(`[data-${kind}]`);
    const empty = (text: string) => {
      const message = document.createElement('p');
      message.className = 'moderation-empty';
      message.textContent = text;
      node.replaceChildren(message);
      find(`[data-count-${kind}]`).textContent = '—';
      find(`[data-count-${kind}]`).removeAttribute('aria-label');
    };
    if (!state.liveMode || !state.serverConnected || state.phase !== 'connected' || !state.moderation?.connected) {
      empty(!state.liveMode ? 'Niet beschikbaar in de lokale test.' : 'Niet verbonden met TikTok LIVE.'); return;
    }
    const page = pages[kind];
    const cursor = cursors[kind][page] || '';
    try {
      const query = new URLSearchParams({ list: kind, page: String(page), cursor });
      const response = await fetch(`/api/moderation?${query}`);
      const result = await response.json() as Access & { list?: List; error?: string };
      if (!response.ok || !result.list) throw new Error(result.error || 'Lijst laden mislukt.');
      if (!root.isConnected) return;
      const restore = kind === 'muted' ? 'unmute' : 'unban';
      const users = document.createElement('ul');
      users.className = 'moderation-users';
      users.setAttribute('aria-label', kind === 'muted' ? 'Gedempte gebruikers' : 'Geblokkeerde gebruikers');
      users.tabIndex = 0;
      find(`[data-count-${kind}]`).textContent = String(result.list.users.length);
      find(`[data-count-${kind}]`).setAttribute('aria-label', `${result.list.users.length} gebruikers op deze pagina`);
      for (const user of result.list.users) {
        const row = document.createElement('li');
        row.className = 'moderation-user';
        const label = document.createElement('span');
        label.textContent = user.name || user.userId;
        label.title = user.name || user.userId;
        const button = document.createElement('button');
        button.textContent = actionNames[restore];
        button.setAttribute('aria-label', `${actionNames[restore]}: ${user.name || user.userId}`);
        button.disabled = !state.liveMode || !result.enabled || !(kind === 'muted' ? result.mute : result.ban);
        button.onclick = async () => {
          button.disabled = true;
          try {
            await action({ action: restore, targetId: user.userId, page, cursor });
            toast('Herstelactie door TikTok geaccepteerd.');
            await loadList(kind);
          } catch (error) { toast(error instanceof Error ? error.message : 'Herstellen mislukt.'); button.disabled = false; }
          await loadAudit();
        };
        row.append(label, button); users.append(row);
      }
      if (!result.list.users.length) {
        const message = document.createElement('li');
        message.className = 'moderation-empty';
        message.textContent = page === 0 ? kind === 'muted' ? 'Geen gedempte gebruikers.' : 'Geen geblokkeerde gebruikers.' : 'Geen gebruikers op deze pagina.';
        users.append(message);
      }
      const controls = document.createElement('div');
      controls.className = 'moderation-pagination';
      const pageLabel = document.createElement('span');
      pageLabel.textContent = `Pagina ${page + 1}`;
      controls.append(pageLabel);
      for (const [label, next, disabled] of [['Vorige', page - 1, page === 0], ['Volgende', page + 1, !result.list.hasMore || page >= 49]] as const) {
        const button = document.createElement('button'); button.textContent = label; button.disabled = disabled;
        button.onclick = () => { if (next > page) cursors[kind][next] = result.list!.cursor; pages[kind] = next; void loadList(kind); };
        controls.append(button);
      }
      node.replaceChildren(users, controls);
    } catch (error) { if (root.isConnected) empty(error instanceof Error ? error.message : 'Lijst laden mislukt.'); }
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    const button = find('[data-refresh]') as HTMLButtonElement;
    button.disabled = true;
    await refreshModerationAccess();
    if (!root.isConnected) { busy = false; return; }
    find('[data-state]').textContent = state.moderation?.reason || 'Niet verbonden.';
    await Promise.allSettled([loadList('muted'), loadList('blocked'), loadAudit()]);
    button.disabled = false;
    busy = false;
  }
  find('[data-refresh]').onclick = () => { void refresh(); };
  const timer = setInterval(() => { if (!root.isConnected) clearInterval(timer); else void loadAudit(); }, 15_000);
  void refresh();
}
