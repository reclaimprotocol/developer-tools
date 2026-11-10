import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const metadata = JSON.parse(await readFile(new URL('../server.json', import.meta.url)));
const endpoint = metadata.remotes[0].url;
let id = 0;
async function rpc(method, params = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.ok, true, 'MCP HTTP request failed: ' + response.status);
  const text = await response.text();
  const payload = JSON.parse(text.trim().startsWith('data:') ? text.split('\n').find(line => line.startsWith('data:')).slice(5).trim() : text);
  assert.ok(!payload.error, 'MCP protocol error');
  return payload.result;
}
const initialized = await rpc('initialize', {
  protocolVersion: '2025-11-25', capabilities: {},
  clientInfo: { name: 'reclaim-distribution-check', version: '1.0.0' },
});
assert.equal(initialized.serverInfo.version, metadata.version, 'Registry version must match the server');
const listed = await rpc('tools/list');
for (const name of ['create_verification_link', 'get_letter_status', 'get_pdf_verification']) {
  assert.ok(listed.tools.some(tool => tool.name === name), 'Missing tool: ' + name);
}
console.log(JSON.stringify({ endpoint, version: initialized.serverInfo.version, tools: listed.tools.map(tool => tool.name) }, null, 2));
