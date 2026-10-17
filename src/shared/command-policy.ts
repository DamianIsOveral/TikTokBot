export const commandPolicy = { messageLength: 200, maxMessages: 6, maxCharacters: 1200,
  intervalMs: 3000, batchPauseMs: 10_000, minCooldownSeconds: 30, userCooldownMs: 30_000, messagesPerMinute: 10 } as const;

export function planResponses(responses: readonly string[]) {
  const messages: string[] = [];
  let error = '';
  const characters = responses.reduce((sum, line) => sum + line.length, 0);
  if (!responses.length || responses.length > 10 || characters > commandPolicy.maxCharacters) {
    error = `Gebruik maximaal 10 invoerregels en ${commandPolicy.maxCharacters} tekens totaal.`;
  }
  for (const source of error ? [] : responses) {
    if (!source.trim() || /[\u0000-\u001f]/.test(source)) { error = 'Antwoordregels mogen niet leeg zijn of controletekens bevatten.'; break; }
    let current = '';
    for (const word of source.trim().split(/\s+/u)) {
      if (word.length > commandPolicy.messageLength && /^https?:\/\//i.test(word)) {
        error = 'Een link is langer dan 200 tekens; gebruik een kortere link.'; break;
      }
      if (word.length <= commandPolicy.messageLength) {
        if (current && current.length + 1 + word.length > commandPolicy.messageLength) { messages.push(current); current = ''; }
        current = current ? `${current} ${word}` : word;
      } else {
        if (current) { messages.push(current); current = ''; }
        for (const character of word) {
          if (current.length + character.length > commandPolicy.messageLength) { messages.push(current); current = ''; }
          current += character;
        }
      }
    }
    if (error) break;
    if (current.trim()) messages.push(current.trim());
    if (messages.length > commandPolicy.maxMessages) { error = `Dit antwoord heeft meer dan ${commandPolicy.maxMessages} chatberichten nodig. Kort het in.`; break; }
  }
  return { messages: error ? [] : messages, error, characters,
    durationSeconds: Math.max(0, messages.length - 1) * commandPolicy.intervalMs / 1000 };
}
