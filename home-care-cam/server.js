'use strict';
/**
 * Home Care Cam - signalling + alert server.
 *
 * Video/audio go peer-to-peer over WebRTC (via TURN if needed); this server only
 * relays the small handshake messages, checks passwords and sends alerts.
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const VIEW_PASSWORD = process.env.VIEW_PASSWORD || '';
const CAMERA_KEY = process.env.CAMERA_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const NO_MOTION_HOURS = Number(process.env.NO_MOTION_HOURS || 4);
const OFFLINE_MINUTES = Number(process.env.OFFLINE_MINUTES || 5);
const LOW_BATTERY = Number(process.env.LOW_BATTERY || 20);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

if (!VIEW_PASSWORD || !CAMERA_KEY) {
  console.error('ERROR: set VIEW_PASSWORD and CAMERA_KEY environment variables (see README.md).');
  process.exit(1);
}

let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
if (process.env.ICE_SERVERS) {
  try { iceServers = JSON.parse(process.env.ICE_SERVERS); }
  catch (e) { console.error('ICE_SERVERS is not valid JSON, using default STUN only'); }
}

// ---------- helpers ----------
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
const sign = (payload) => crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
const makeToken = () => {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${body}.${sign(body)}`;
};
const verifyToken = (t) => {
  if (!t || typeof t !== 'string' || !t.includes('.')) return false;
  const [body, sig] = t.split('.');
  if (!safeEqual(sig, sign(body))) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now(); }
  catch { return false; }
};

// Simple per-IP login rate limit: 8 failures / 10 minutes
const fails = new Map();
const tooManyFails = (ip) => {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < 600000);
  fails.set(ip, list);
  return list.length >= 8;
};
const noteFail = (ip) => fails.set(ip, [...(fails.get(ip) || []), Date.now()]);

async function notify(text) {
  console.log('[ALERT]', text);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      });
    } catch (e) { console.error('telegram failed:', e.message); }
  }
  broadcastViewers({ type: 'alert', text, at: Date.now() });
}

// ---------- http ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '4kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(self), microphone=(self)',
  });
  next();
});

app.post('/api/login', (req, res) => {
  if (tooManyFails(req.ip)) return res.status(429).json({ error: 'too_many_attempts' });
  const pw = req.body && req.body.password;
  if (typeof pw === 'string' && safeEqual(pw, VIEW_PASSWORD)) return res.json({ token: makeToken() });
  noteFail(req.ip);
  res.status(401).json({ error: 'wrong_password' });
});

app.get('/api/ice', (req, res) => {
  const auth = (req.get('authorization') || '').replace(/^Bearer /, '');
  const key = req.get('x-camera-key') || '';
  if (verifyToken(auth) || (key && safeEqual(key, CAMERA_KEY))) return res.json({ iceServers });
  res.status(401).json({ error: 'unauthorized' });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/camera', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'camera.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const server = http.createServer(app);

// ---------- signalling ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
let camera = null;                // ws of the camera phone
const viewers = new Map();       // id -> ws
const state = {
  cameraSeenAt: 0,                // last time camera connection was alive
  lastMotionAt: 0,
  status: { paused: false, facing: 'user', battery: null, charging: null, mic: true },
};
const alerted = { offline: false, noMotion: false, battery: false };

const sendJson = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const broadcastViewers = (obj) => viewers.forEach((v) => sendJson(v, obj));
const publicState = () => ({
  type: 'state',
  cameraOnline: !!camera,
  lastMotionAt: state.lastMotionAt,
  now: Date.now(),
  ...state.status,
});

server.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return socket.destroy(); }
  if (url.pathname !== '/ws') return socket.destroy();
  const role = url.searchParams.get('role');
  const ok =
    (role === 'viewer' && verifyToken(url.searchParams.get('token'))) ||
    (role === 'camera' && safeEqual(url.searchParams.get('key') || '', CAMERA_KEY));
  if (!ok) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => { ws.role = role; wss.emit('connection', ws); });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  if (ws.role === 'camera') {
    if (camera && camera !== ws) { try { camera.close(4000, 'replaced'); } catch {} }
    camera = ws;
    state.cameraSeenAt = Date.now();
    if (!state.lastMotionAt) state.lastMotionAt = Date.now();
    if (alerted.offline) notify('✅ Camera phir se online ho gaya.');
    alerted.offline = false;
    broadcastViewers(publicState());

    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      state.cameraSeenAt = Date.now();
      if (m.type === 'status') {
        const s = state.status;
        if (typeof m.paused === 'boolean') s.paused = m.paused;
        if (m.facing === 'user' || m.facing === 'environment') s.facing = m.facing;
        if (typeof m.mic === 'boolean') s.mic = m.mic;
        s.battery = typeof m.battery === 'number' ? Math.round(m.battery) : s.battery;
        if (typeof m.charging === 'boolean') s.charging = m.charging;
        if (s.paused) { state.lastMotionAt = Date.now(); alerted.noMotion = false; }
        if (!(s.battery !== null && s.battery <= LOW_BATTERY && s.charging === false)) alerted.battery = false;
        else if (!alerted.battery) { alerted.battery = true; notify(`🔋 Camera phone ki battery ${s.battery}% hai aur charge nahi ho raha.`); }
        broadcastViewers(publicState());
      } else if (m.type === 'motion') {
        state.lastMotionAt = Date.now();
        alerted.noMotion = false;
        broadcastViewers({ type: 'motion', at: state.lastMotionAt });
      } else if (m.to && viewers.has(m.to)) {
        // WebRTC answer / ice for a specific viewer
        const { to, ...rest } = m;
        sendJson(viewers.get(to), rest);
      }
    });
    ws.on('close', () => {
      if (camera === ws) { camera = null; broadcastViewers(publicState()); }
    });
    return;
  }

  // viewer
  const id = crypto.randomBytes(6).toString('hex');
  viewers.set(id, ws);
  sendJson(ws, { type: 'hello', id });
  sendJson(ws, publicState());
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!camera) return sendJson(ws, { type: 'camera-offline' });
    if (['offer', 'ice', 'cmd', 'bye'].includes(m.type)) sendJson(camera, { ...m, from: id });
  });
  ws.on('close', () => {
    viewers.delete(id);
    sendJson(camera, { type: 'bye', from: id });
  });
});

// keep-alive + monitors
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

setInterval(() => {
  const now = Date.now();
  if (!camera && state.cameraSeenAt && now - state.cameraSeenAt > OFFLINE_MINUTES * 60000 && !alerted.offline) {
    alerted.offline = true;
    notify(`⚠️ Camera ${OFFLINE_MINUTES}+ minute se offline hai (phone band / internet ya charger check karein).`);
  }
  if (camera && !state.status.paused && state.lastMotionAt &&
      now - state.lastMotionAt > NO_MOTION_HOURS * 3600000 && !alerted.noMotion) {
    alerted.noMotion = true;
    notify(`⚠️ Pichhle ${NO_MOTION_HOURS} ghante se ghar mein koi hilchal nahi dikhi. Ek baar call karke dekh lein.`);
  }
  broadcastViewers(publicState());
}, 30000);

server.listen(PORT, () => console.log(`Home Care Cam listening on :${PORT}`));

module.exports = { server };
