// Local run: one alert whose push service is unreachable, one reachable; the reachable one must still be sent.
import http from 'node:http';
import { createECDH } from 'node:crypto';

const WORKER = 'http://localhost:8787';
const keys = () => { const ua = createECDH('prime256v1'); ua.generateKeys(); return { p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url') }; };
let received = 0;
const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { received++; res.writeHead(201).end(); }); }).listen(9999);
const post = (path, body) => fetch(WORKER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

await post('/alerts', { subscription: { endpoint: 'http://127.0.0.1:9/dead', keys: keys() }, stationId: '92120002', fuel: 'SP98', name: 'dead' });
await post('/alerts', { subscription: { endpoint: 'http://127.0.0.1:9999/ok', keys: keys() }, stationId: '92120002', fuel: 'E10', name: 'ok' });
console.log('scheduled', await (await fetch(WORKER + '/cdn-cgi/local/scheduled')).text());
await new Promise(r => setTimeout(r, 3000));
console.log('pushes received by the reachable service:', received);
server.close();
