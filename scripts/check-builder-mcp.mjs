import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const server = JSON.parse(await readFile('server.json', 'utf8'));
const version = server.packages[0].version;
const child = spawn('npx', ['-y', '--package=@reclaimprotocol/agent@' + version, 'reclaim-mcp-server'], {
  stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
});
// Server stderr can include private diagnostic data: do not print it in CI.
child.stderr.resume();
const pending = new Map();
let nextId = 1;
const reader = createInterface({ input: child.stdout });
reader.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error('Builder MCP returned a protocol error.'));
  else request.resolve(message.result);
});
const rejectPending = message => {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
  pending.clear();
};
child.on('error', () => rejectPending('Builder MCP could not start.'));
child.on('exit', () => rejectPending('Builder MCP exited before completing discovery.'));
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Builder MCP discovery timed out.')); }, 120000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
try {
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'reclaim-distribution-check', version: '1.0.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await request('tools/list', {});
  const names = tools.tools?.map(tool => tool.name) ?? [];
  if (!names.includes('start_integration') || !names.includes('how_it_works')) throw new Error('Expected Builder MCP integration tools are missing.');
  const receipt = { package: '@reclaimprotocol/agent', version, transport: 'stdio', initialized: true, toolCount: names.length, integrationToolsPresent: true, checkedAt: new Date().toISOString(), scope: 'Protocol initialization and tool discovery only; no account verification performed.' };
  await mkdir('distribution/receipts', { recursive: true });
  await writeFile('distribution/receipts/builder-mcp-health.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  reader.close();
  child.stdin.end();
  try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGTERM'); } catch {}
}
