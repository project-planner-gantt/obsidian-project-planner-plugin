import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export async function connect(port, match = () => true) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(target => target.type === "page" && match(target));
  if (!target) throw Error("No matching CDP page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(id, message => { clearTimeout(timeout); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const message = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (message.result.exceptionDetails) throw Error(message.result.exceptionDetails.exception?.description ?? JSON.stringify(message.result.exceptionDetails));
    return message.result.result.value;
  }
  return { send, evaluate, close: () => ws.close() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.CDP_PORT ?? 9345);
  const connection = await connect(port, target => target.url.startsWith("app://obsidian.md"));
  try { console.log(JSON.stringify(await connection.evaluate(readFileSync(process.argv[2], "utf8")), null, 2)); }
  finally { connection.close(); }
}
