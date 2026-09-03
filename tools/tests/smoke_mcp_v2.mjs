import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const SERVERS = [
  {
    name: 'ollama-tools',
    script: join(PROJECT_ROOT, 'tools', 'mcp', 'ollama-tools-mcp.mjs'),
    init: { name: 'ollama-tools', version: '1.0.0' },
    toolCall: { name: 'list_audio_library', arguments: {} },
    expectError: true, // backend may not be running
  },
  {
    name: 'vision',
    script: join(PROJECT_ROOT, 'tools', 'mcp', 'vision-mcp.mjs'),
    init: { name: 'native-media-vision', version: '1.0.0' },
    toolCall: { name: 'vision_describe', arguments: { image_path: resolve(PROJECT_ROOT, 'viewport-check.png'), prompt: 'Brief description.', mode: 'ui' } },
    expectError: false,
  },
  {
    name: 'unity',
    script: join(PROJECT_ROOT, 'tools', 'mcp', 'unity-mcp-bridge.mjs'),
    init: { name: 'unity-mcp-bridge', version: '1.1.0' },
    toolCall: { name: 'editor_status', arguments: {} },
    expectError: true, // Unity may not be running
  },
];

function sendJson(child, obj) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('stdin write timeout')), 5000);
    child.stdin.write(JSON.stringify(obj) + '\n', (err) => {
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve();
    });
  });
}

function waitForResponse(child, id, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      child.stdout.removeAllListeners('data');
      reject(new Error(`timeout waiting for response id=${id}`));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            child.stdout.removeListener('data', onData);
            resolve(msg);
            return;
          }
        } catch {
          // skip non-JSON
        }
      }
    };

    child.stdout.on('data', onData);
  });
}

async function testServer(server) {
  console.log(`\n=== Testing ${server.name} ===`);
  const child = spawn('node', [server.script], { cwd: PROJECT_ROOT });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', d => { /* handled by waitForResponse */ });
  child.stderr.on('data', d => stderr += d.toString());

  try {
    // 1. Initialize
    await sendJson(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-test', version: '1.0.0' },
      },
    });

    const initRes = await waitForResponse(child, 1, 15000);
    if (initRes.error) {
      throw new Error(`initialize failed: ${JSON.stringify(initRes.error)}`);
    }
    console.log(`  init: ok (server=${initRes.result?.serverInfo?.name || 'unknown'})`);

    // 2. tools/list
    await sendJson(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const listRes = await waitForResponse(child, 2, 15000);
    if (listRes.error) {
      throw new Error(`tools/list failed: ${JSON.stringify(listRes.error)}`);
    }
    const toolCount = listRes.result?.tools?.length || 0;
    console.log(`  tools/list: ok (${toolCount} tools)`);

    // 3. tools/call
    await sendJson(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: server.toolCall,
    });

    const callRes = await waitForResponse(child, 3, server.expectError ? 15000 : 60000);
    if (callRes.error) {
      console.log(`  tools/call: server-error (${callRes.error.message || JSON.stringify(callRes.error)})`);
    } else if (callRes.result?.isError) {
      console.log(`  tools/call: tool-error (expected for ${server.name})`);
      console.log(`    preview: ${(callRes.result.content?.[0]?.text || '').slice(0, 120)}`);
    } else {
      console.log(`  tools/call: ok`);
      console.log(`    preview: ${(callRes.result?.content?.[0]?.text || '').slice(0, 120)}`);
    }

    console.log(`  PASS`);
    return true;
  } catch (err) {
    console.log(`  FAIL: ${err.message}`);
    if (stderr) console.log(`  stderr: ${stderr.slice(0, 300)}`);
    return false;
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  console.log('MCP v2 Smoke Test');
  const results = [];
  for (const server of SERVERS) {
    results.push({ server: server.name, ok: await testServer(server) });
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`  ${r.server}: ${r.ok ? 'PASS' : 'FAIL'}`);
  }
  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} server(s) failed smoke test`);
    process.exit(1);
  }
  console.log('\nAll servers passed smoke test');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
