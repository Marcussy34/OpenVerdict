/**
 * One lane for everything this process signs as the operator: Sui gateway
 * transactions and Walrus writes (register and certify transactions) all
 * spend from the same gas and WAL coins, and two of them in flight at once
 * make the validators reject one as locked or stale. Chaining them removes
 * every self-inflicted collision; races with other processes (the web
 * request path while a worker runs) are rare and covered by the retries.
 */
let tail: Promise<void> = Promise.resolve();

export function runOnOperatorLane<T>(operation: () => Promise<T>): Promise<T> {
  const run = tail.then(operation);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
