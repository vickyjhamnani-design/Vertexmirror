/* Runs on every page but stays idle unless the site is switched on in the popup. */
(function () {
  'use strict';
  var enabled = false;

  function myHosts() {
    var hosts = [location.hostname];
    try {
      var ao = location.ancestorOrigins; // lets a market inside an iframe follow the top page's switch
      if (ao && ao.length) hosts.push(new URL(ao[ao.length - 1]).hostname);
    } catch (e) {}
    return hosts;
  }
  function refresh() {
    chrome.storage.local.get(['hosts'], function (v) {
      var list = v.hosts || [];
      enabled = myHosts().some(function (h) { return list.indexOf(h) >= 0; });
    });
  }
  refresh();
  chrome.storage.onChanged.addListener(refresh);

  // capture phase: read the page before the site reacts to the click
  document.addEventListener('click', function (ev) {
    if (!enabled) return;
    var d;
    try { d = window.__betMirror.capture(ev); } catch (e) { return; }
    if (!d) return;
    d.ts = Date.now();
    try { chrome.runtime.sendMessage({ mirror: d }); } catch (e) {}
  }, true);
})();
