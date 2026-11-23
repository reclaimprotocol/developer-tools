// Prepares server.json for the MCP Registry from the published npm package.
// Set RELEASE_VERSION to require that exact version (a release run). The script
// fails when that version or its mcpName is missing. Without it, the script
// uses the latest version and reports ready=false when mcpName doesn't match.
import { appendFile, readFile, writeFile } from 'node:fs/promises';

const PACKAGE_URL = 'https://registry.npmjs.org/@reclaimprotocol/agent';
const requested = (process.env.RELEASE_VERSION || '').trim();
// A just-published version can take minutes to appear on the registry, so a
// release run keeps polling, backing off from 10 to 30 seconds. The wait,
// including the last lookup, stays under 6 minutes. The check job's 10-minute
// timeout (set in the workflow) must also fit about 1 minute of setup and npx
// install and the MCP check's two 60-second request waits (initialize and
// tools/list): 6 + 1 + 2 = 9 minutes worst case, leaving 1 minute of slack.
const waitMs = requested ? 6 * 60_000 : 0;
const fetchTimeoutMs = 15_000;
const firstDelayMs = 10_000;
const maxDelayMs = 30_000;

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
  const deadline = Date.now() + waitMs;
  let delayMs = firstDelayMs;
  let lastError;
  for (;;) {
    try {
      // no-store: a cached 404 from before the publish must not be reused.
      const response = await fetch(`${PACKAGE_URL}/${encodeURIComponent(version)}`, {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (response.ok) return await response.json();
      lastError = new Error(`npm returned ${response.status} for @reclaimprotocol/agent@${version}.`);
    } catch (error) {
      lastError = error;
    }
    // Stop unless the next lookup can finish before the deadline.
    if (Date.now() + delayMs + fetchTimeoutMs > deadline) break;
    console.log(`${lastError.message} Retrying in ${delayMs / 1000} s.`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }
  throw new Error(`Cannot inspect the published Builder package: ${lastError.message}`);
}
