// Let shutdown/deadlines release the local waiter even if a transport adapter
// ignores its signal. An interrupted send may still have landed remotely.
export async function waitForTransport(signal, run) {
  if (!signal) return run();
  signal.throwIfAborted();
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }), cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
