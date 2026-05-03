/**
 * Reference server adapter — WebSocket. Uses `ws` (devDep).
 *
 * Bidirectional pattern: one socket per browser tab carries both
 * outbound events (`vacuum.map`, `vacuum.on('change')`,
 * `vacuum.on('ota')`) and inbound action invocations.
 *
 * Message envelope (both directions):
 *   { type: "map" | "state" | "ota" | "error" | "hello", data: <payload> }
 *   { type: "action", name: "locate" | "dock" | ..., requestId?: string }
 *   { type: "ack",   requestId: string, ok: boolean, error?: string }
 *
 * Browser side:
 *   ```html
 *   <script>
 *     const ws = new WebSocket('ws://localhost:3000');
 *     ws.onmessage = (e) => {
 *       const m = JSON.parse(e.data);
 *       if (m.type === 'map')   render(m.data);
 *       if (m.type === 'state') updateUi(m.data);
 *     };
 *     // invoke an action:
 *     ws.send(JSON.stringify({ type: 'action', name: 'locate' }));
 *   </script>
 *   ```
 *
 * NOT production-ready: no auth, no per-client throttling, no
 * back-pressure handling. Copy and adapt.
 *
 * Run:
 *   PORT=3000 npx tsx examples/server-websocket.ts
 */
import { WebSocketServer, type WebSocket } from "ws";
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

// ─── action dispatch ───────────────────────────────────────────────

const ACTIONS: Record<string, () => Promise<unknown>> = {
  locate: () => vacuum.locate(),
  dock: () => vacuum.dock(),
  start: () => vacuum.start(),
  pause: () => vacuum.pause(),
  stop: () => vacuum.stop(),
  "clear-warning": () => vacuum.clearWarning(),
  "start-auto-empty": () => vacuum.startAutoEmpty(),
};

// ─── WebSocket server ──────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });
console.log(`WebSocket bridge listening on ws://localhost:${PORT}`);

function send(ws: WebSocket, type: string, data: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

function broadcast(type: string, data: unknown): void {
  for (const client of wss.clients) {
    send(client, type, data);
  }
}

vacuum.map.on("map", (data: MapData) => broadcast("map", data));
vacuum.map.on("error", (err: Error) => broadcast("error", { message: err.message }));
vacuum.on("change", (state: VacuumState) => broadcast("state", state));
vacuum.on("ota", (event) => broadcast("ota", event));

wss.on("connection", (ws) => {
  send(ws, "hello", { did: device.did, model: device.model });
  if (vacuum.state) {
    send(ws, "state", vacuum.state);
  }
  if (vacuum.map.current) {
    send(ws, "map", vacuum.map.current);
  }

  ws.on("message", async (raw) => {
    let msg: { type?: string; name?: string; requestId?: string };
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      send(ws, "error", { message: "invalid JSON" });
      return;
    }
    if (msg.type !== "action" || typeof msg.name !== "string") {
      send(ws, "error", { message: "expected { type: 'action', name: '...' }" });
      return;
    }
    const action = ACTIONS[msg.name];
    if (!action) {
      ws.send(
        JSON.stringify({
          type: "ack",
          requestId: msg.requestId,
          ok: false,
          error: `unknown action ${msg.name}`,
        }),
      );
      return;
    }
    try {
      await action();
      ws.send(JSON.stringify({ type: "ack", requestId: msg.requestId, ok: true }));
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: "ack",
          requestId: msg.requestId,
          ok: false,
          error: (err as Error).message,
        }),
      );
    }
  });
});

// ─── shutdown ──────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  console.log("\nshutting down...");
  for (const c of wss.clients) {
    c.close();
  }
  wss.close();
  await vacuum.unwatch();
  process.exit(0);
});
