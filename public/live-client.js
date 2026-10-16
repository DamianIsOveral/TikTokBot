'use strict';
const stream = new EventSource('/api/events');
const listeners = new Set();
stream.onmessage = event => {
  const data = JSON.parse(event.data);
  for (const listener of listeners) listener(data);
};
stream.onerror = () => {
  for (const listener of listeners) listener({ type: 'status', text: 'Serververbinding onderbroken. Opnieuw verbinden…' });
};
async function request(action) {
  const response = await fetch(`/api/${action}`, {
    method: 'POST', headers: { 'X-Requested-With': 'faynominaal' }
  });
  if (!response.ok) throw new Error('Serveractie mislukt.');
}
window.liveChat = {
  connect: () => request('connect'), stop: () => request('stop'),
  onEvent: listener => listeners.add(listener)
};
fetch('/api/config').then(response => response.json()).then(config => {
  document.querySelector('#channel').textContent = `@${config.username}`;
}).catch(() => {});
