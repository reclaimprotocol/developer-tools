import { appendFile, readFile, writeFile } from 'node:fs/promises';

const server = JSON.parse(await readFile('server.json', 'utf8'));
const response = await fetch('https://registry.npmjs.org/@reclaimprotocol/agent/latest', { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error('Cannot inspect the published Builder package.');
const published = await response.json();
const ready = published.mcpName === server.name;
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
if (!ready) {
  const message = `Builder Registry publication is blocked: @reclaimprotocol/agent@${published.version} must publish mcpName: ${server.name}. No substitute MCP was published.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message + '\n');
} else {
  server.version = published.version;
  server.packages[0].version = published.version;
  await writeFile('server.json', JSON.stringify(server, null, 2) + '\n');
}
