import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('dist');
if (!existsSync(root)) {
  console.error('dist/ not found. Run npm run build first.');
  process.exit(2);
}

const mime = new Map([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'],
]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(root, decodeURIComponent(requestPath));
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime.get(extname(filePath)) ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

const port = await new Promise((resolvePort) => {
  server.listen(0, '127.0.0.1', () => resolvePort(server.address().port));
});

try {
  const chromium = process.env.CHROMIUM_BIN || 'chromium';
  const dom = await run(chromium, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--virtual-time-budget=3000',
    '--dump-dom',
    `http://127.0.0.1:${port}/`,
  ]);

  const checks = [
    ['title', 'Execution Flow Viewer'],
    ['summary', 'visible nodes'],
    ['react-flow node DOM', 'react-flow__node'],
    ['react-flow edge DOM', 'react-flow__edge'],
  ];
  const failures = checks.filter(([, needle]) => !dom.includes(needle));
  if (failures.length) {
    for (const [name, needle] of failures) console.error(`Missing ${name}: ${needle}`);
    process.exit(1);
  }
  const nodeCount = (dom.match(/react-flow__node/g) ?? []).length;
  const edgeCount = (dom.match(/react-flow__edge/g) ?? []).length;
  console.log(`Viewer smoke passed: ${nodeCount} node DOM markers, ${edgeCount} edge DOM markers.`);
} finally {
  server.close();
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveRun(stdout);
      else reject(new Error(`${command} exited ${code}\n${stderr}`));
    });
  });
}
