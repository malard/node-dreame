/**
 * Reference server adapter — SSE + POST. Zero external deps.
 *
 * Runs a tiny Node HTTP server that:
 *   - Streams `vacuum.map`, `vacuum.on('change')`, and `vacuum.on('ota')`
 *     to any browser tab connected to `GET /events` (Server-Sent Events).
 *   - Accepts `POST /actions/<name>` to invoke the corresponding
 *     `Vacuum` method (locate, dock, start, pause, stop, clearWarning).
 *
 * This is the smallest "node-dreame in front of a browser" pattern. SSE
 * is one-way (server → browser); the actions endpoint covers the other
 * direction. For full bidirectional, see `examples/server-websocket.ts`.
 *
 * Browser side (paste into a tab pointed at this server):
 *   ```html
 *   <script>
 *     const es = new EventSource('/events');
 *     es.addEventListener('map',   (e) => console.log('map',   JSON.parse(e.data)));
 *     es.addEventListener('state', (e) => console.log('state', JSON.parse(e.data)));
 *     fetch('/actions/locate', { method: 'POST' });
 *   </script>
 *   ```
 *
 * NOT production-ready: no auth, no CORS handling, no reconnection
 * back-pressure. Copy and adapt.
 *
 * Run:
 *   PORT=3000 npx tsx examples/server-sse.ts
 */
import * as http from "node:http";
import { DreameClient, type VacuumState } from "../src/index.js";
import type { MapData } from "../src/map/index.js";

const PORT = Number(process.env.PORT ?? 3000);

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

await dreame.login();
const device = (await dreame.getDevices())[0]!;
console.log(`bridging ${device.name} (${device.did}, ${device.model})`);

const vacuum = dreame.getVacuum(device);
await vacuum.refresh();
await vacuum.watch();

// ─── SSE client registry ────────────────────────────────────────────

const clients = new Set<http.ServerResponse>();

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

vacuum.map.on("map", (data: MapData) => broadcast("map", data));
vacuum.map.on("error", (err: Error) => broadcast("error", { message: err.message }));
vacuum.on("change", (state: VacuumState) => broadcast("state", state));
vacuum.on("ota", (event) => broadcast("ota", event));

// ─── HTTP server ───────────────────────────────────────────────────

const ACTIONS: Record<string, () => Promise<unknown>> = {
  locate: () => vacuum.locate(),
  dock: () => vacuum.dock(),
  start: () => vacuum.start(),
  pause: () => vacuum.pause(),
  stop: () => vacuum.stop(),
  "clear-warning": () => vacuum.clearWarning(),
  "start-auto-empty": () => vacuum.startAutoEmpty(),
};

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ did: device.did })}\n\n`);
    if (vacuum.state) {
      res.write(`event: state\ndata: ${JSON.stringify(vacuum.state)}\n\n`);
    }
    if (vacuum.map.current) {
      res.write(`event: map\ndata: ${JSON.stringify(vacuum.map.current)}\n\n`);
    }
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && url.startsWith("/actions/")) {
    const name = url.slice("/actions/".length);
    const action = ACTIONS[name];
    if (!action) {
      res.writeHead(404).end(JSON.stringify({ error: `unknown action ${name}` }));
      return;
    }
    try {
      const result = await action();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
    }
    return;
  }

  if (req.method === "GET" && url === "/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(vacuum.state));
    return;
  }

  if (req.method === "GET" && url === "/map") {
    res.writeHead(vacuum.map.current ? 200 : 204, { "Content-Type": "application/json" });
    res.end(vacuum.map.current ? JSON.stringify(vacuum.map.current) : "");
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`SSE bridge listening on http://localhost:${PORT}`));

// ─── shutdown ──────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  console.log("\nshutting down...");
  for (const res of clients) {
    res.end();
  }
  server.close();
  await vacuum.unwatch();
  process.exit(0);
});
