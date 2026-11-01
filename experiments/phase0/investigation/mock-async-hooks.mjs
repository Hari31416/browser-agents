// Diagnostic only. This does NOT propagate context across async work.
// Never use this as a production AsyncLocalStorage implementation.
export class AsyncLocalStorage {
  getStore() { return undefined; }
  run(_store, callback, ...args) { return callback(...args); }
  enterWith() {}
  disable() {}
  exit(callback, ...args) { return callback(...args); }
}
