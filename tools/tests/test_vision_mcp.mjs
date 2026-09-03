import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const MCP_SERVER = join(PROJECT_ROOT, 'tools', 'mcp', 'vision-mcp.mjs');

const imagePath = resolve(PROJECT_ROOT, 'threejs-studio-initial.png');

const child = spawn('node', [MCP_SERVER], { cwd: PROJECT_ROOT });

let buffer = '';
let stderr = '';

child.stdout.on('data', d => buffer += d);
child.stderr.on('data', d => stderr += d);

// Send initialize request
const initReq = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' }
  }
};

child.stdin.write(JSON.stringify(initReq) + '\n');

// After init, call vision_describe
setTimeout(() => {
  const callReq = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'vision_describe',
      arguments: {
        image_path: imagePath,
        prompt: 'Test from MCP harness',
        mode: 'ui'
      }
    }
  };
  child.stdin.write(JSON.stringify(callReq) + '\n');
}, 1000);

// Read response
setTimeout(() => {
  child.kill();
  console.log('STDOUT:', buffer);
  console.log('STDERR:', stderr);
}, 30000);
