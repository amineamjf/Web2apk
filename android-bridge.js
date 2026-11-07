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

  function plugin(name) {
    try {
      var P = C.Plugins || {};
      if (P[name]) return P[name];
      if (typeof C.registerPlugin === 'function') return C.registerPlugin(name);
    } catch (_) {}
    return null;
  }

  function notify(msg, type) {
    try { if (typeof window.showToast === 'function') { window.showToast(msg, type || 'success'); return; } } catch (_) {}
    try { alert(msg); } catch (_) {}
  }

  // Repli : écriture dans le cache de l'app puis feuille de partage Android (choisir « Enregistrer »).
  async function shareFallback(data, fileName) {
    var P = C.Plugins || {};
    var w = await P.Filesystem.writeFile({ path: fileName, data: data, directory: 'CACHE' });
    await P.Share.share({ title: fileName, url: w.uri, dialogTitle: 'Enregistrer ou partager' });
  }

  async function saveFile(href, name) {
    try {
      var blob = await (await fetch(href)).blob();
      var data = await toBase64(blob);
      var fileName = String(name || ('export-' + Date.now())).replace(/[\\/:*?"<>|]+/g, '_');
      var saver = plugin('SaveFile');
      if (saver && typeof saver.save === 'function') {
        try {
          var r = await saver.save({ name: fileName, data: data, mime: blob.type || 'application/octet-stream' });
          notify('Enregistré dans Téléchargements/SmartRV : ' + ((r && r.name) || fileName), 'success');
          return;
        } catch (e) {
          // Android < 10 ou échec MediaStore : on bascule sur la feuille de partage.
          console.warn('SaveFile indisponible, repli sur le partage', e);
        }
      }
      await shareFallback(data, fileName);
    } catch (e) {
      var m = String((e && e.message) || e);
      if (!/cancel/i.test(m)) alert('Échec export : ' + m);
    }
  }

  function handle(a) {
    var h = a.href || '';
    if (a.hasAttribute('download') && (h.indexOf('blob:') === 0 || h.indexOf('data:') === 0)) {
      saveFile(h, a.getAttribute('download'));
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
