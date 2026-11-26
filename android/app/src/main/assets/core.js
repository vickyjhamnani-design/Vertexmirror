/* BetMirror core — shared by the Chrome extension (capture) and the Android app (replay).
 * capture(clickEvent) -> descriptor of what was clicked, or null
 * handle(jsonString)  -> performs the same action on this page
 * Matching is by runner name + market title + back/lay, never by screen position,
 * so desktop and mobile layouts can differ.
 */
(function () {
  'use strict';
  if (window.__betMirror) return;

  var SIDE_RE = /(^|[\s_-])(back|lay)(\d*)(?=$|[\s_-])/i;
  var NOISE_RE = /^(back|lay|yes|no|min|max|suspended|ball running|cash ?out|bet lock|closed|open|active|inactive)\b/i;
  var SUBMIT_RE = /^(place ?bet|placebet|submit|place|confirm|confirm bet|done)$/;
  var CANCEL_RE = /^(cancel|reset|clear|clear all|close)$/;

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
  }
  var layoutOn = null;
  function visible(el) {
    if (layoutOn === null) {
      layoutOn = !!(document.body && document.body.getClientRects && document.body.getClientRects().length);
    }
    if (!layoutOn) return true; // no layout engine (tests)
    return el.getClientRects().length > 0;
  }
  function sideOf(el) {
    if (!el || typeof el.className !== 'string') return null;
    var m = el.className.match(SIDE_RE);
    return m ? { side: m[2].toLowerCase(), token: (m[2] + m[3]).toLowerCase() } : null;
  }
  function isCell(el) {
    var s = sideOf(el);
    if (!s) return false;
    var other = s.side === 'back' ? 'lay' : 'back';
    var kids = el.querySelectorAll('[class*="' + other + '"]');
    for (var i = 0; i < kids.length; i++) {
      var k = sideOf(kids[i]);
      if (k && k.side === other) return false; // a container, not a price cell
    }
    return true;
  }
  /* outermost price cell that contains el */
  function cellOf(el) {
    var found = null, depth = 0;
    while (el && el.nodeType === 1 && depth < 8) {
      if (isCell(el)) found = el;
      else if (found) break;
      el = el.parentElement; depth++;
    }
    return found;
  }
  function allCells() {
    var list = document.querySelectorAll('[class*="back"],[class*="lay"],[class*="Back"],[class*="Lay"]');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!isCell(el)) continue;
      var p = el.parentElement;
      if (p && isCell(p) && sideOf(p).side === sideOf(el).side) continue; // keep outermost only
      out.push(el);
    }
    return out;
  }
  /* first meaningful text inside root, skipping anything inside the `skip` elements */
  function firstText(root, skip, before) {
    var w = document.createTreeWalker(root, 4 /* SHOW_TEXT */, null);
    var n, fallback = null;
    while ((n = w.nextNode())) {
      if (before && !(n.compareDocumentPosition(before) & 4 /* FOLLOWING */)) break;
      var t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t.length < 2 || !/[a-z]/i.test(t) || NOISE_RE.test(t)) continue;
      var inside = false;
      for (var i = 0; i < skip.length; i++) if (skip[i].contains(n)) { inside = true; break; }
      if (inside) continue;
      if (n.parentElement && visible(n.parentElement)) return t;
      if (!fallback) fallback = t;
    }
    return fallback;
  }
  function buildIndex() {
    var cells = allCells();
    var rows = [], byEl = new Map();
    cells.forEach(function (cell) {
      var a = cell.parentElement, depth = 0;
      while (a && a !== document.body && depth < 8) {
        var mine = cells.filter(function (c) { return a.contains(c); });
        if (mine.length > 12) break; // climbed past a single runner row
        var name = firstText(a, mine);
        if (name) {
          var r = byEl.get(a);
          if (!r) { r = { el: a, name: name, key: norm(name), cells: mine }; byEl.set(a, r); rows.push(r); }
          return;
        }
        a = a.parentElement; depth++;
      }
    });
    // drop "rows" that are really containers of other rows
    rows = rows.filter(function (r) {
      return !rows.some(function (o) { return o !== r && r.el.contains(o.el); });
    });
    var rowEls = rows.map(function (r) { return r.el; });
    rows.forEach(function (r) {
      var a = r.el.parentElement, depth = 0, title = null;
      while (a && depth < 8 && !title) {
        title = firstText(a, rowEls, r.el);
        if (a === document.body) break;
        a = a.parentElement; depth++;
      }
      r.market = norm(title);
    });
    return rows;
  }
  function sideCells(row, side) {
    var list = row.cells.filter(function (c) { return sideOf(c).side === side; });
    var vis = list.filter(visible);
    return vis.length ? vis : list;
  }
  function leaf(el) {
    while (el.firstElementChild) el = el.firstElementChild;
    return el;
  }
  function buttonOf(el) {
    var depth = 0;
    while (el && el.nodeType === 1 && depth < 5) {
      var tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A' || (tag === 'INPUT' && /submit|button/i.test(el.type)) ||
          el.getAttribute('role') === 'button') return el;
      el = el.parentElement; depth++;
    }
    return null;
  }
  function buttonText(b) { return norm(b.tagName === 'INPUT' ? b.value : b.textContent); }
  function stakeInput(from) {
    var a = from, depth = 0;
    while (a && depth < 12) {
      var inputs = Array.prototype.filter.call(a.querySelectorAll('input'), function (i) {
        return /^(text|number|tel|)$/i.test(i.getAttribute('type') || '') && !i.readOnly && !i.disabled && visible(i);
      });
      if (inputs.length) {
        var named = inputs.filter(function (i) {
          var s = [i.name, i.id, i.className, i.placeholder, i.getAttribute('formcontrolname'), i.getAttribute('ng-model'), i.getAttribute('v-model')].join(' ');
          return /stake|amount|amt/i.test(s);
        });
        return named[0] || inputs[inputs.length - 1];
      }
      a = a.parentElement; depth++;
    }
    return null;
  }
  function setValue(input, value) {
    var proto = Object.getPrototypeOf(input);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    ['input', 'change', 'keyup', 'blur'].forEach(function (t) {
      input.dispatchEvent(new Event(t, { bubbles: true }));
    });
  }

  /* ---------- PC side ---------- */
  function capture(ev) {
    var target = ev.target;
    if (!target || target.nodeType !== 1) return null;
    var cell = cellOf(target);
    if (cell) {
      var rows = buildIndex();
      var row = rows.filter(function (r) { return r.el.contains(cell); })[0];
      if (!row) return null;
      var s = sideOf(cell);
      var same = sideCells(row, s.side);
      var i = same.indexOf(cell);
      if (i < 0) i = s.side === 'back' ? same.length - 1 : 0;
      var twins = rows.filter(function (r) { return r.key === row.key; });
      return {
        t: 'sel', runner: row.name, market: row.market, side: s.side, token: s.token,
        pos: s.side === 'back' ? same.length - 1 - i : i, // 0 = best price
        occ: twins.indexOf(row)
      };
    }
    var btn = buttonOf(target);
    if (btn) {
      var txt = buttonText(btn);
      if (SUBMIT_RE.test(txt)) {
        var inp = stakeInput(btn.parentElement);
        if (!inp) return null; // a submit button with no stake box is not a bet slip
        return { t: 'place', stake: String(inp.value || '').trim() };
      }
      if (CANCEL_RE.test(txt) && stakeInput(btn.parentElement)) return { t: 'cancel' };
    }
    return null;
  }

  /* ---------- phone side ---------- */
  function report(ok, msg) {
    var s = JSON.stringify({ t: 'res', ok: ok, msg: msg });
    try { window.BetMirrorApp && window.BetMirrorApp.report(s); } catch (e) {}
    return s;
  }
  function findSlipButton(re) {
    var list = document.querySelectorAll('button, input[type=submit], input[type=button], a, [role=button]');
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!visible(b) || !re.test(buttonText(b))) continue;
      var inp = stakeInput(b.parentElement);
      if (inp) return { btn: b, input: inp };
    }
    return null;
  }
  function select(d) {
    var rows = buildIndex();
    var key = norm(d.runner);
    var cand = rows.filter(function (r) { return r.key === key; });
    if (!cand.length) cand = rows.filter(function (r) { return r.key.indexOf(key) >= 0 || key.indexOf(r.key) >= 0; });
    if (!cand.length) return report(false, 'runner not found: ' + d.runner);
    var inMarket = cand.filter(function (r) { return r.market && r.market === d.market; });
    // same market title wins; if titles don't settle it, use the row's order on the page
    var byOrder = cand[Math.min(d.occ || 0, cand.length - 1)];
    var row = inMarket.length === 1 ? inMarket[0]
      : inMarket.length > 1 ? (inMarket.indexOf(byOrder) >= 0 ? byOrder : inMarket[0])
      : byOrder;
    var same = sideCells(row, d.side);
    if (!same.length) return report(false, 'no ' + d.side + ' price for ' + d.runner);
    var exact = same.filter(function (c) { return sideOf(c).token === d.token; });
    var cell;
    if (exact.length === 1) cell = exact[0];
    else {
      var p = Math.min(d.pos || 0, same.length - 1);
      cell = d.side === 'back' ? same[same.length - 1 - p] : same[p];
    }
    leaf(cell).click();
    return report(true, d.side + ' ' + row.name + (row.market ? ' (' + row.market + ')' : ''));
  }
  function place(d) {
    var tries = 0;
    (function wait() {
      var slip = findSlipButton(SUBMIT_RE);
      if (!slip) {
        if (++tries > 40) return report(false, 'bet slip not open');
        return setTimeout(wait, 100);
      }
      if (d.stake) setValue(slip.input, d.stake);
      if (!api.auto) return report(true, 'stake ' + d.stake + ' filled (auto place is off)');
      var n = 0;
      (function press() {
        if (slip.btn.disabled && ++n < 15) return setTimeout(press, 80);
        slip.btn.click();
        report(true, 'placed, stake ' + d.stake);
      })();
    })();
  }
  function cancel() {
    var slip = findSlipButton(CANCEL_RE);
    if (slip) { slip.btn.click(); report(true, 'slip cleared'); }
  }
  function handle(json) {
    var d = typeof json === 'string' ? JSON.parse(json) : json;
    if (d.t === 'sel') return select(d);
    if (d.t === 'place') return place(d);
    if (d.t === 'cancel') return cancel();
  }

  var api = { auto: true, capture: capture, handle: handle, _index: buildIndex };
  window.__betMirror = api;
})();
