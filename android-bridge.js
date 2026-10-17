(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;

  function toBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  async function saveAndShare(href, name) {
    try {
      var P = C.Plugins || {};
      var blob = await (await fetch(href)).blob();
      var data = await toBase64(blob);
      var fileName = name || ('export-' + Date.now());
      var w = await P.Filesystem.writeFile({ path: fileName, data: data, directory: 'CACHE' });
      await P.Share.share({ title: fileName, url: w.uri, dialogTitle: 'Enregistrer ou partager' });
    } catch (e) {
      var m = String((e && e.message) || e);
      if (!/cancel/i.test(m)) alert('Échec export : ' + m);
    }
  }

  function handle(a) {
    var h = a.href || '';
    if (a.hasAttribute('download') && (h.indexOf('blob:') === 0 || h.indexOf('data:') === 0)) {
      saveAndShare(h, a.getAttribute('download'));
      return true;
    }
    return false;
  }

  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (handle(this)) return;
    return origClick.apply(this, arguments);
  };

  HTMLAnchorElement.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && handle(this)) return true;
    return EventTarget.prototype.dispatchEvent.call(this, ev);
  };

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && handle(a)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
