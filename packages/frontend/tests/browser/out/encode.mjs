import fs from 'fs';
import path from 'path';

const projectRoot = 'D:\\Backup of Important Data for Windows 11 Upgrade\\Native Media AI Studio';
const imgPath = path.join(projectRoot, '.playwright-mcp', 'page-2026-09-05T22-05-09-777Z.png');
const outPath = path.join(projectRoot, 'packages/frontend/tests/browser', 'out', 'shot-b64.txt');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const b64 = fs.readFileSync(imgPath, 'base64');
fs.writeFileSync(outPath, b64);
console.log('Written', outPath, 'length', b64.length);
