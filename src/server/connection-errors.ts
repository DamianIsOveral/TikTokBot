function errorRecords(error: unknown): Record<string, unknown>[] {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const records: Record<string, unknown>[] = [];
  while (queue.length && records.length < 20) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const record = item as Record<string, unknown>;
    records.push(record);
    queue.push(record.exception, record.cause);
    const config = record.config;
    if (config && typeof config === 'object' && 'requestErrs' in config && Array.isArray(config.requestErrs)) {
      queue.push(...config.requestErrs.slice(0, 10));
    }
  }
  return records;
}

export function connectionErrorMessage(error: unknown): string {
  const records = errorRecords(error);
  const messages = records.map(record => typeof record.message === 'string' ? record.message.slice(0, 4096) : '').join(' ');
  const names = records.map(record => `${record.name || ''} ${record.constructor?.name || ''}`).join(' ');
  if (/WHITELIST_AUTHENTICATED_SESSION_ID_HOST/.test(messages)) {
    return /does not match/i.test(messages)
      ? 'De vertrouwde authenticatiehost komt niet overeen met de Euler-signserver. Controleer WHITELIST_AUTHENTICATED_SESSION_ID_HOST.'
      : 'Botverbinding geblokkeerd: de vertrouwde Euler-host ontbreekt. Stel WHITELIST_AUTHENTICATED_SESSION_ID_HOST in na toestemming voor het delen van de botcookies.';
  }
  if (/UserOfflineError/.test(names)) return 'Het TikTok-kanaal is momenteel niet live. Probeer opnieuw zodra de stream begint.';
  if (/SignatureRateLimitError/.test(names) || /too many|rate limit|status 429/i.test(messages)) {
    return 'Euler of TikTok begrenst het aantal verbindingspogingen. Wacht even voordat je opnieuw verbindt.';
  }
  if (/PremiumFeatureError/.test(names) || /status 402|lack of permission/i.test(messages)) {
    return 'Deze verbinding vereist extra rechten bij Euler Stream. Controleer de rechten van je Euler API-sleutel.';
  }
  if (/AuthenticatedWebSocketConnectionError/.test(names) || /session cookies|cookie or OAuth bundle/i.test(messages)) {
    return 'Aanmelden met het TikTok-botaccount is mislukt. Controleer de sessiecookies en authenticatie-instellingen.';
  }
  if (/status (401|403)|unauthorized|forbidden/i.test(messages)) {
    return 'TikTok of Euler weigert toegang. Controleer de Euler-sleutel en de geldigheid van de botcookies.';
  }
  if (/ConnectTimeoutError|TimeoutError/.test(names) || records.some(record =>
    typeof record.code === 'string' && /^(ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)/.test(record.code))) {
    return 'Verbinding met TikTok of Euler niet bereikbaar of verlopen. Controleer je netwerk en probeer opnieuw.';
  }
  if (/InvalidResponseCompositeError/.test(names)) {
    return 'De TikTok-stream kon niet worden gevonden. Controleer de kanaalnaam en of het kanaal live is.';
  }
  return 'Verbinden mislukt. TikTok of Euler gaf een onverwachte fout. Probeer opnieuw of controleer de serverinstellingen.';
}
