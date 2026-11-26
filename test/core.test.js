// Capture on a desktop-style page, replay on a mobile-style page with different markup.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const core = fs.readFileSync(process.argv[2], 'utf8');

function market(title, runners, wide) {
  const cells = r => (wide
    ? ['back2', 'back1', 'back', 'lay', 'lay1', 'lay2']
    : ['back', 'lay']
  ).map(c => `<div class="market-odd-box ${c}" data-id="${title}|${r}|${c}"><span class="market-odd">1.9</span><span class="market-volume">100</span></div>`).join('');
  return `<div class="market-4">
    <div class="market-title"><span>${title}</span><button>Cashout</button></div>
    <div class="market-header"><div class="market-nation-detail"><span>Max: 1L</span></div>
      <div class="market-odd-box back"><b>Back</b></div><div class="market-odd-box lay"><b>Lay</b></div></div>
    <div class="market-body">${runners.map(r => `
      <div class="market-row"><div class="market-nation-detail"><span class="market-nation-name">${r}</span><span class="book">0</span></div>${cells(r)}</div>`).join('')}
    </div></div>`;
}
// mobile variant: table layout, upper-case names, extra wrappers
function mobileMarket(title, runners) {
  return `<section><h4>${title}</h4><table>${runners.map(r => `
    <tr><td><b class="team">${r.toUpperCase()}</b><div>0.00</div></td>
    <td class="bl-box back" data-id="${title}|${r}|back"><span><i>1.9</i></span></td>
    <td class="bl-box lay" data-id="${title}|${r}|lay"><span><i>2.0</i></span></td></tr>`).join('')}</table></section>`;
}
const slip = `<div class="place-bet-modal"><input type="text" class="odds" readonly value="1.9">
  <input type="number" class="stakeinput" value=""><button class="btn-reset">Reset</button><button class="btn-submit">Submit</button></div>`;

const pc = new JSDOM(`<body>${market('MATCH_ODDS', ['Team A', 'Team B'], true)}${market('Bookmaker', ['Team A', 'Team B'], true)}${market('Normal', ['6 over run TA', '10 over run TA'], false)}${slip}</body>`, { runScripts: 'outside-only' });
const phone = new JSDOM(`<body>${mobileMarket('MATCH_ODDS', ['Team A', 'Team B'])}${mobileMarket('Bookmaker', ['Team A', 'Team B'])}${mobileMarket('Normal', ['6 over run TA', '10 over run TA'])}${slip}</body>`, { runScripts: 'outside-only' });
pc.window.eval(core); phone.window.eval(core);

const clicks = [];
phone.window.document.addEventListener('click', e => {
  const cell = e.target.closest('[data-id]');
  clicks.push(cell ? cell.dataset.id : e.target.className);
}, true);
const reports = [];
phone.window.BetMirrorApp = { report: s => reports.push(JSON.parse(s)) };

let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`));
}
function pcClick(selector) {
  const el = pc.window.document.querySelector(selector);
  return pc.window.__betMirror.capture({ target: el });
}

const cases = [
  ['Bookmaker|Team B|back', 'Bookmaker|Team B|back'],
  ['Bookmaker|Team A|lay', 'Bookmaker|Team A|lay'],
  ['MATCH_ODDS|Team A|back', 'MATCH_ODDS|Team A|back'],
  ['MATCH_ODDS|Team B|lay2', 'MATCH_ODDS|Team B|lay'],   // phone has one lay column
  ['MATCH_ODDS|Team A|back2', 'MATCH_ODDS|Team A|back'],
  ['Normal|10 over run TA|lay', 'Normal|10 over run TA|lay'],
];
for (const [from, to] of cases) {
  clicks.length = 0;
  const d = pcClick(`[data-id="${from}"] .market-odd`); // click lands on the inner price span
  phone.window.__betMirror.handle(JSON.stringify(d));
  check(`${from} -> phone`, clicks, [to]);
}

check('header cell is not a bet', (pcClick('.market-header .back b') || {}).runner === 'Team A', false);
check('cashout button ignored', pcClick('.market-title button'), null);
check('unknown runner reported', JSON.parse(phone.window.__betMirror.handle({ t: 'sel', runner: 'Nobody', side: 'back' })).ok, false);

// stake + submit
pc.window.document.querySelector('.stakeinput').value = '500';
const p = pcClick('.btn-submit');
check('place captured with stake', { t: p.t, stake: p.stake }, { t: 'place', stake: '500' });
clicks.length = 0; reports.length = 0;
phone.window.__betMirror.auto = true;
phone.window.__betMirror.handle(JSON.stringify(p));
setTimeout(() => {
  check('phone stake filled', phone.window.document.querySelector('.stakeinput').value, '500');
  check('phone submit clicked', clicks, ['btn-submit']);
  // auto place off: fills, does not submit
  clicks.length = 0;
  phone.window.__betMirror.auto = false;
  phone.window.__betMirror.handle(JSON.stringify({ t: 'place', stake: '250' }));
  setTimeout(() => {
    check('auto off: stake filled', phone.window.document.querySelector('.stakeinput').value, '250');
    check('auto off: no submit', clicks, []);
    console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
    process.exit(fail ? 1 : 0);
  }, 300);
}, 300);
