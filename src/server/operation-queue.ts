export class OperationBusyError extends Error {
  constructor() { super('De bot is bezig. Deze actie is niet in de wachtrij gezet.'); }
}
export function createOperationQueue(limit = 8) {
  let count = 0;
  let tail = Promise.resolve();
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (count >= limit) throw new OperationBusyError();
    count++;
    const next = tail.then(operation);
    tail = next.then(() => {}, () => {});
    try { return await next; } finally { count--; }
  };
}
