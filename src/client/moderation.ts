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
    if (!response.ok) throw new Error();
    const access = await response.json() as Access;
    if (state.liveMode && state.serverConnected && state.phase === 'connected') state.moderation = access;
  } catch { state.moderation = { connected: false, enabled: false, mute: false, ban: false, reason: 'Moderatierechten konden niet worden gecontroleerd.' }; }
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
  root.innerHTML = `<h2>Moderatie</h2><p data-state role="status">Rechten controleren…</p>
    <p>Dempen geldt voor de gekozen tijd of de gehele LIVE. Blokkeren heeft een aparte herstelactie.
    Het botaccount kan geen andere moderator dempen of blokkeren.</p>
    <div class="moderation-lists"><section><h3>Gedempte gebruikers</h3><div data-muted></div></section>
    <section><h3>Geblokkeerde gebruikers</h3><div data-blocked></div></section></div>
    <h3>Moderatielog</h3><p>Discord-gebruiker · actie · TikTok-gebruiker · resultaat.
    De laatste 100 acties; log vernieuwt iedere 15 seconden.</p>
    <button data-refresh>Vernieuwen</button><div data-audit aria-live="polite"></div>`;
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
      find('[data-audit]').innerHTML = result.entries.map(entry => `<article class="audit-entry">
        <time>${escapeHTML(new Date(entry.at).toLocaleString('nl-NL'))}</time>
        <strong>${escapeHTML(entry.actor.name)}</strong> <small>${escapeHTML(entry.actor.id)}</small>
        <p>${escapeHTML(actionNames[entry.action])}${entry.action === 'mute' ? entry.duration === 0 ? ' · gehele LIVE' : ` · ${entry.duration}s` : ''}
        · ${escapeHTML(entry.target.name)} (${escapeHTML(entry.target.id)})</p>
        <p>${escapeHTML(statusNames[entry.status])}${entry.reason ? ` · ${escapeHTML(entry.reason)}` : ''}</p></article>`).join('') || '<p>Nog geen moderatieacties.</p>';
    } catch { if (root.isConnected) find('[data-audit]').textContent = 'Moderatielog laden mislukt.'; }
  }

  async function loadList(kind: 'muted' | 'blocked') {
    const node = find(`[data-${kind}]`);
    if (!state.liveMode || !state.serverConnected || state.phase !== 'connected' || !state.moderation?.connected) {
      node.textContent = !state.liveMode ? 'Niet beschikbaar in de lokale test.' : 'Niet verbonden met TikTok LIVE.'; return;
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
      node.replaceChildren();
      for (const user of result.list.users) {
        const row = document.createElement('p');
        const label = document.createElement('span');
        label.textContent = user.name || user.userId;
        const button = document.createElement('button');
        button.textContent = actionNames[restore];
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
        row.append(label, ' ', button); node.append(row);
      }
      if (!result.list.users.length) node.textContent = 'Geen gebruikers op deze pagina.';
      const controls = document.createElement('div');
      for (const [label, next, disabled] of [['Vorige', page - 1, page === 0], ['Volgende', page + 1, !result.list.hasMore || page >= 49]] as const) {
        const button = document.createElement('button'); button.textContent = label; button.disabled = disabled;
        button.onclick = () => { if (next > page) cursors[kind][next] = result.list!.cursor; pages[kind] = next; void loadList(kind); };
        controls.append(button);
      }
      node.append(controls);
    } catch (error) { if (root.isConnected) node.textContent = error instanceof Error ? error.message : 'Lijst laden mislukt.'; }
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    await refreshModerationAccess();
    if (!root.isConnected) { busy = false; return; }
    find('[data-state]').textContent = state.moderation?.reason || 'Niet verbonden.';
    await Promise.allSettled([loadList('muted'), loadList('blocked'), loadAudit()]);
    busy = false;
  }
  find('[data-refresh]').onclick = () => { void refresh(); };
  const timer = setInterval(() => { if (!root.isConnected) clearInterval(timer); else void loadAudit(); }, 15_000);
  void refresh();
}
