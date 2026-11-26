// Talks to the Java listener the same way the extension's background worker does.
const port = 18765;
function open(code) {
  return new Promise(res => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?code=${code}`);
    ws.onopen = () => res({ ws, ok: true });
    ws.onerror = () => res({ ok: false });
  });
}
(async () => {
  let fail = 0;
  const check = (n, c) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

  const http = await fetch(`http://127.0.0.1:${port}/`).then(r => r.text());
  check('plain browser visit answers', /reachable/.test(http));

  check('wrong code refused', !(await open('0000')).ok);

  const { ws, ok } = await open('4321');
  check('right code connects', ok);
  const got = [];
  ws.onmessage = e => got.push(e.data);
  ws.send(JSON.stringify({ t: 'sel', runner: 'Team A', side: 'back' }));
  ws.send(JSON.stringify({ t: 'big', pad: 'x'.repeat(70000) })); // 64-bit length path
  ws.send('{"t":"ünï"}');
  await new Promise(r => setTimeout(r, 500));
  check('small frame echoed', got.includes('echo:' + JSON.stringify({ t: 'sel', runner: 'Team A', side: 'back' })));
  check('large frame echoed', got.some(g => g.length > 70000));
  check('utf-8 intact', got.includes('echo:{"t":"ünï"}'));
  ws.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
