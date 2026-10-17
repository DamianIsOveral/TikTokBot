import { errorRecords } from './connection-errors.ts';
import { DirectTikTokError, directErrorText } from './tiktok/direct-client.ts';
import { OperationBusyError } from './operation-queue.ts';

export function messageErrorText(error: unknown): string {
  if (error instanceof DirectTikTokError) return directErrorText(error);
  if (error instanceof OperationBusyError) return 'De bot is bezig; dit commando is overgeslagen.';
  const records = errorRecords(error);
  const text = records.map(record => `${record.name || ''} ${record.constructor?.name || ''} ${typeof record.message === 'string' ? record.message.slice(0, 4096) : ''}`).join(' ');
  const statuses = records.map(record => {
    const response = record.response;
    return response && typeof response === 'object' && 'status' in response ? response.status : record.status;
  });
  if (/targetRoomId|targetUniqueId/.test(text)) return 'Botbericht geweigerd: de Euler-aanvraag mist het doelkanaal.';
  if (/PremiumFeatureError|paid plan|lack of permission/i.test(text) || statuses.includes(403)) {
    return 'Euler weigert botberichten: controleer de verzendrechten en het abonnement van de API-sleutel. Livechat lezen blijft werken.';
  }
  if (/session|cookie|log.?in|authenticated/i.test(text)) {
    return 'TikTok weigert het botaccount. Controleer of de botcookies nog geldig zijn en het account in deze LIVE mag reageren.';
  }
  if (statuses.includes(401) || /unauthorized/i.test(text)) return 'Euler weigert de API-sleutel voor chatverzending. Controleer de sleutel en de bijbehorende rechten.';
  if (statuses.includes(429) || /too many|rate.?limit/i.test(text)) return 'Botberichten worden tijdelijk begrensd. Wacht even voor je het opnieuw probeert.';
  if (records.some(record => typeof record.code === 'string' && /^(ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)/.test(record.code))) {
    return 'Botbericht niet verstuurd door een netwerkfout. Probeer het na de cooldown opnieuw.';
  }
  return 'Botbericht versturen mislukt door een onverwachte TikTok- of Euler-fout. De chatverbinding blijft actief.';
}
