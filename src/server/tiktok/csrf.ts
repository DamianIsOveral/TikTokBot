export function parseWebcastCsrf(value: string | null): { token: string; mode: 'token' | 'downgrade' } {
  if (value === null) return { token: 'DOWNGRADE', mode: 'downgrade' };
  const [status, token] = value.split(',');
  if (status !== '0' || !token) return { token: 'DOWNGRADE', mode: 'downgrade' };
  if (token.length > 2048 || /[\s;,]/.test(token)) throw new Error('Ongeldig CSRF-antwoord.');
  return { token, mode: 'token' };
}
