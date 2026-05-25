require('./load-env');

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const ld = require('./ld');

const PORT = Number(process.env.PORT) || 3000;
const API_TOKEN = process.env.LAUNCHDARKLY_API_TOKEN;
if (!API_TOKEN) {
  console.error('Set LAUNCHDARKLY_API_TOKEN in .env (see .env.example)');
  process.exit(1);
}
const FLAG_URL = 'https://app.launchdarkly.com/api/v2/flags/demo/amazing-feature-1';

function showBanner() {
  console.log(
    `      ██
          ██
      ████████
         ███████
██ LAUNCHDARKLY █
         ███████
      ████████
          ██
        ██
`,
  );
}

const sseClients = new Set();

function broadcastEvaluation(evaluation) {
  const payload = `data: ${JSON.stringify(evaluation)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

ld.onEvaluationUpdate(broadcastEvaluation);

ld.initLaunchDarkly((payload) => {
  const anyOn = payload.evaluationsByContext?.some(
    (entry) => entry.flags['amazing-feature-1']?.value,
  );
  if (anyOn) showBanner();
}).catch((err) => {
  console.error('*** SDK failed to initialize:', err.message);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function proxyToLaunchDarkly(method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(FLAG_URL);
    const headers = { Authorization: API_TOKEN };
    if (body) {
      headers['Content-Type'] = 'application/json; domain-model=launchdarkly.semanticpatch';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const latest = ld.getLatestEvaluations();
      if (latest) res.write(`data: ${JSON.stringify(latest)}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.url === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        contextCount: ld.CONTEXT_COUNT,
        contextKeys: ld.getContexts().map((c) => c.key),
        metricKey: ld.METRIC_KEY,
      }));
      return;
    }

    if (req.url === '/api/evaluation' && req.method === 'GET') {
      const payload = ld.getLatestEvaluations() ?? (await ld.evaluateAllFlags());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.url === '/api/flag' && (req.method === 'GET' || req.method === 'PATCH')) {
      const body = req.method === 'PATCH' ? await readBody(req) : null;
      const { status, body: ldBody } = await proxyToLaunchDarkly(req.method, body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(ldBody);
      return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/img/')) {
      const imgRoot = path.join(__dirname, 'img');
      const filePath = path.normalize(path.join(__dirname, req.url.slice(1)));
      if (!filePath.startsWith(imgRoot + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
      if (!types[ext] || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[ext] });
      res.end(fs.readFileSync(filePath));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or run: PORT=${PORT + 1} npm start`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Demo UI: http://localhost:${PORT}`);
});
