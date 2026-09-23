// Local end-to-end run: mock push service + wrangler dev. Registers an alert for a fuel on sale right now,
// fires the hourly check and decrypts what the "push service" received.
import http from 'node:http';
import { createECDH } from 'node:crypto';
import ece from 'http_ece';

const WORKER = 'http://localhost:8787';
const [stationId, fuel] = process.argv.slice(2);
const ua = createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.getRandomValues(new Uint8Array(16));
const received = [];
const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => { received.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201).end(); });
}).listen(9999);

const subscription = { endpoint: 'http://127.0.0.1:9999/push/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.from(auth).toString('base64url') } };
const post = (path, body) => fetch(WORKER + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8765' }, body: JSON.stringify(body) }).then(r => r.json());

console.log('create', await post('/alerts', { subscription, stationId, fuel, name: 'Test station' }));
console.log('list', await post('/alerts/list', { endpoint: subscription.endpoint }));
console.log('scheduled', await (await fetch(WORKER + '/cdn-cgi/local/scheduled')).text());
await new Promise(r => setTimeout(r, 3000));
for (const m of received) {
  console.log('push auth header', m.headers.authorization.slice(0, 20) + '…', 'encoding', m.headers['content-encoding']);
  console.log('decrypted', ece.decrypt(m.body, { version: 'aes128gcm', privateKey: ua, authSecret: Buffer.from(auth) }).toString());
}
console.log('list after', await post('/alerts/list', { endpoint: subscription.endpoint }));
server.close();
