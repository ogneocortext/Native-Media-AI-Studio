#!/usr/bin/env node
// Quick health check for Moto Monitor dev servers before running browser tests.
import http from 'node:http';

const VITE_URL = process.env.VITE_URL || 'http://localhost:5173';
const API_URL  = process.env.API_URL  || 'http://localhost:3001/api/system';

const check = (label, url) =>
  new Promise((resolve) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label} — ${res.statusCode}`);
        resolve(ok);
      });
    });
    req.on('error', (err) => {
      console.log(`  [FAIL] ${label} — ${err.message}`);
      resolve(false);
    });
    req.on('timeout', () => {
      console.log(`  [FAIL] ${label} — timeout`);
      req.destroy();
      resolve(false);
    });
  });

console.log('Checking dev servers...');
const vite = await check('Vite dev server', VITE_URL);
const api  = await check('Express API', API_URL);
console.log(vite && api ? '\nAll servers ready.' : '\nSome servers are down. Start them before running browser tests.');
process.exit(vite && api ? 0 : 1);
