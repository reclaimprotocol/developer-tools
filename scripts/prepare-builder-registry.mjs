// Prepares server.json for the MCP Registry from the published npm package.
// Set RELEASE_VERSION to require that exact version (a release run). The script
// fails when that version or its mcpName is missing. Without it, the script
// uses the latest version and reports ready=false when mcpName doesn't match.
import { appendFile, readFile, writeFile } from 'node:fs/promises';

const PACKAGE_URL = 'https://registry.npmjs.org/@reclaimprotocol/agent';
const requested = (process.env.RELEASE_VERSION || '').trim();
const attempts = requested ? 6 : 1;
const delayMs = 10_000;

const server = JSON.parse(await readFile('server.json', 'utf8'));
const published = await fetchPackage(requested || 'latest');

const ready = published.mcpName === server.name;
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
if (!ready) {
  const message = `Builder Registry publication is blocked: @reclaimprotocol/agent@${published.version} must publish mcpName: ${server.name}. No substitute MCP was published.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message + '\n');
  // A release run must not skip the registry silently.
  if (requested) throw new Error(message);
} else {
  server.version = published.version;
  server.packages[0].version = published.version;
  await writeFile('server.json', JSON.stringify(server, null, 2) + '\n');
}

async function fetchPackage(version) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${PACKAGE_URL}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(15000) });
      if (response.ok) return await response.json();
      lastError = new Error(`npm returned ${response.status} for @reclaimprotocol/agent@${version}.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Cannot inspect the published Builder package: ${lastError.message}`);
}
