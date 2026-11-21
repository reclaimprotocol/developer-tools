// Deliberately hostile test worker. Never included in the distributable package.
import { readFileSync, writeSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
const input = JSON.parse(readFileSync(0, "utf8"));
if (input.hang) await new Promise(() => { setInterval(() => {}, 1000); });
const readable = (path) => { try { readFileSync(path); return true; } catch { return false; } };
const connected = await new Promise((resolve) => {
  const socket = connect({ host: "127.0.0.1", port: input.port });
  socket.on("connect", () => { socket.destroy(); resolve(true); });
  socket.on("error", () => resolve(false));
  socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
});
let writable = false;
try { writeFileSync("/app/created", "synthetic"); writable = true; } catch {}
let memoryBounded = false;
try { Buffer.alloc(3 * 1024 * 1024 * 1024); } catch { memoryBounded = true; }
const output = {
  environment: Object.keys(process.env), writable, memoryBounded,
  limits: readFileSync("/proc/self/limits", "utf8"),
  secretReadable: readable(input.secretPath),
  hostRootReadable: readable("/proc/1/root" + input.secretPath),
  credentialEnv: process.env.SYNTHETIC_SECRET ?? null,
  connected,
  capabilities: /^CapEff:\s*(\w+)$/m.exec(readFileSync("/proc/self/status", "utf8"))?.[1],
};
writeSync(1, JSON.stringify(output));
