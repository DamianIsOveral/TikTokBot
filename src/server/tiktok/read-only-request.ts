export function createReadOnlyRequest(request: typeof fetch = fetch) {
  const methods = new Set<string>();
  let count = 0;
  let blocked = 0;
  const readOnly: typeof fetch = async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      blocked++;
      throw new Error('Schrijfacties zijn geblokkeerd in deze diagnose.');
    }
    methods.add(method);
    count++;
    return request(input, { ...init, method, redirect: 'error' });
  };
  return { request: readOnly, summary: () => ({ methods: [...methods].sort(), requestCount: count, blockedWrites: blocked }) };
}
