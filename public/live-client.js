'use strict';
let stream;
const listeners = new Set();
let latestSnapshot;
function subscribe() {
  stream?.close();
  stream = new EventSource('/api/events');
  stream.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.type === 'snapshot') latestSnapshot = data;
    for (const listener of listeners) listener(data);
  };
  stream.onerror = () => {
    for (const listener of listeners) listener({ type: 'transport', text: 'Serververbinding onderbroken. Opnieuw verbinden…' });
  };
}
subscribe();
async function request(action) {
  const response = await fetch(`/api/${action}`, {
    method: 'POST', headers: { 'X-Requested-With': 'faynominaal' }
  });
  if (!response.ok) throw new Error('Serveractie mislukt.');
}
window.liveChat = {
  connect: async () => {
    await request('connect');
    subscribe();
  },
  stop: () => request('stop'),
  onEvent: listener => {
    listeners.add(listener);
    if (latestSnapshot) listener(latestSnapshot);
  }
};
fetch('/api/config').then(response => response.json()).then(config => {
  document.querySelector('#channel').textContent = `@${config.username}`;
}).catch(() => {});
