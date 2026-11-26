const $ = id => document.getElementById(id);
let host = '';

function describe(m) {
  if (!m) return '';
  if (m.t === 'sel') return `Sent: ${m.side} ${m.runner}${m.market ? ' (' + m.market + ')' : ''}`;
  if (m.t === 'place') return `Sent: place, stake ${m.stake}`;
  return `Sent: ${m.t}`;
}
function render(state) {
  state = state || {};
  $('conn').textContent = state.connected ? 'Connected to phone' : 'Not connected';
  $('conn').className = state.connected ? 'ok' : 'bad';
  $('sent').textContent = describe(state.lastSent);
  const r = state.lastReply;
  $('reply').textContent = r ? `Phone: ${r.ok ? '✓' : '✗'} ${r.msg}` : '';
}

chrome.storage.local.get(['ip', 'code', 'hosts', 'state'], v => {
  $('ip').value = v.ip || '';
  $('code').value = v.code || '';
  render(v.state);
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    try { host = new URL(tabs[0].url).hostname; } catch (e) {}
    $('host').textContent = host || 'this site';
    $('site').checked = (v.hosts || []).includes(host);
    $('site').disabled = !host;
  });
});
chrome.storage.onChanged.addListener(ch => { if (ch.state) render(ch.state.newValue); });

$('save').onclick = () => {
  chrome.storage.local.set({ ip: $('ip').value.trim(), code: $('code').value.trim() }, () =>
    chrome.runtime.sendMessage({ cmd: 'reload' }));
};
$('test').onclick = () => chrome.runtime.sendMessage({ cmd: 'test' });
$('site').onchange = () => {
  chrome.storage.local.get(['hosts'], v => {
    const set = new Set(v.hosts || []);
    $('site').checked ? set.add(host) : set.delete(host);
    chrome.storage.local.set({ hosts: [...set] });
  });
};
