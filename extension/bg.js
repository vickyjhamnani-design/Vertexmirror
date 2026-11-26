/* Background worker: holds one WebSocket straight to the phone (ws://PHONE_IP:8765). */
const PORT = 8765;
const STALE_MS = 1500; // never deliver a bet click later than this

let ws = null;
let cfg = { ip: '', code: '' };
let queue = [];
let state = { connected: false, lastSent: null, lastReply: null };
let retry = null;

function badge() {
  chrome.action.setBadgeText({ text: state.connected ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: state.connected ? '#1a7f37' : '#b42318' });
}
function publish() {
  badge();
  chrome.storage.local.set({ state });
}
function flush() {
  const now = Date.now();
  queue = queue.filter(m => now - m.ts < STALE_MS);
  while (queue.length && ws && ws.readyState === 1) ws.send(JSON.stringify(queue.shift()));
}
function connect() {
  clearTimeout(retry);
  if (!cfg.ip) { state.connected = false; publish(); return; }
  if (ws && ws.readyState <= 1) return;
  let sock;
  try {
    sock = new WebSocket(`ws://${cfg.ip}:${PORT}/?code=${encodeURIComponent(cfg.code)}`);
  } catch (e) { retry = setTimeout(connect, 2000); return; }
  ws = sock;
  sock.onopen = () => { state.connected = true; publish(); flush(); };
  sock.onmessage = e => {
    try {
      const m = JSON.parse(e.data);
      if (m.t === 'res') { state.lastReply = { ok: m.ok, msg: m.msg, at: Date.now() }; publish(); }
    } catch (err) {}
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    state.connected = false; publish();
    retry = setTimeout(connect, 1500);
  };
  sock.onerror = () => { try { sock.close(); } catch (e) {} };
}
function send(msg) {
  msg.ts = msg.ts || Date.now();
  state.lastSent = msg;
  queue.push(msg);
  if (ws && ws.readyState === 1) flush(); else connect();
  publish();
}
async function load() {
  const v = await chrome.storage.local.get(['ip', 'code']);
  const changed = v.ip !== cfg.ip || v.code !== cfg.code;
  cfg = { ip: (v.ip || '').trim(), code: (v.code || '').trim() };
  if (changed && ws) { try { ws.close(); } catch (e) {} ws = null; }
  connect();
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.mirror) send(m.mirror);
  else if (m.cmd === 'test') send({ t: 'test' });
  else if (m.cmd === 'reload') load();
  reply({ ok: true });
});
chrome.storage.onChanged.addListener(ch => { if (ch.ip || ch.code) load(); });
chrome.runtime.onStartup.addListener(load);
chrome.runtime.onInstalled.addListener(load);

// keep the socket (and this worker) alive, and wake up again if Chrome suspends it
setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"t":"ping"}'); else connect(); }, 20000);
chrome.alarms.create('wake', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { if (!ws) load(); });

load();
