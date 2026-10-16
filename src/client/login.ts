import type { LoginStatus } from '../shared/auth.js';
import { element } from './dom.js';

const errors: Record<string, string> = {
  denied: 'Je Discord-ID heeft nog geen toegang. Vraag een beheerder om je ID toe te voegen.',
  state: 'Deze inlogpoging is verlopen of ongeldig. Probeer opnieuw.',
  discord: 'Inloggen bij Discord is mislukt. Probeer opnieuw; controleer zo nodig Client Secret en redirect-URL.'
};
void fetch('/auth/session').then(async response => {
  if (!response.ok) throw new Error();
  const status = await response.json() as LoginStatus;
  if (status.authenticated) { location.replace('/'); return; }
  const error = new URLSearchParams(location.search).get('error') || '';
  element('#login-message').textContent = !status.configured
    ? 'Discord-login is nog niet ingesteld. Vul lokaal DISCORD_CLIENT_SECRET in .env in en herstart de server.'
    : errors[error] || 'Je wordt doorgestuurd naar Discord om je identiteit te bevestigen.';
  element('#discord-login').classList.toggle('hidden', !status.configured);
}).catch(() => { element('#login-message').textContent = 'De server is niet bereikbaar. Probeer later opnieuw.'; });
