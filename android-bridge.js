(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;

  var FOLDER_LABEL = 'Téléchargements › SmartRV';

  function toBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  var pluginCache = {};
  function plugin(name) {
    if (pluginCache[name]) return pluginCache[name];
    try {
      var P = C.Plugins || {};
      if (P[name]) return (pluginCache[name] = P[name]);
      if (typeof C.registerPlugin === 'function') return (pluginCache[name] = C.registerPlugin(name));
    } catch (_) {}
    return null;
  }

  function reportError(title, msg) {
    try { if (typeof window.showPersistentErrorModal === 'function') { window.showPersistentErrorModal(title, msg); return; } } catch (_) {}
    try { alert(title + ' : ' + msg); } catch (_) {}
  }

  // ---------- Types de fichiers ----------
  var MIME = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    html: 'text/html',
    txt: 'text/plain'
  };
  function extOf(name) {
    var m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function mimeFor(name, fallback) {
    return MIME[extOf(name)] || fallback || 'application/octet-stream';
  }
  // Type utilisé pour OUVRIR le fichier : un JSON s'ouvre dans un lecteur de texte.
  function openMimeFor(name, mime) {
    var e = extOf(name);
    if (e === 'json') return 'text/plain';
    return mime || mimeFor(name);
  }
  var CHIP = {
    pdf: ['PDF', '#dc2626'], xlsx: ['XLSX', '#16a34a'], xls: ['XLS', '#16a34a'], csv: ['CSV', '#16a34a'],
    json: ['JSON', '#d97706'], zip: ['ZIP', '#7c3aed'], png: ['IMG', '#2563eb'], jpg: ['IMG', '#2563eb'],
    jpeg: ['IMG', '#2563eb'], html: ['HTML', '#475569'], txt: ['TXT', '#475569']
  };
  function formatSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' o';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' Ko';
    return (n / 1048576).toFixed(1) + ' Mo';
  }

  // ---------- Carte « Fichier enregistré » ----------
  var cardState = null;

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function closeCard() {
    if (cardState && cardState.overlay && cardState.overlay.parentNode) cardState.overlay.parentNode.removeChild(cardState.overlay);
    cardState = null;
  }

  function btn(label, bg, color, onClick) {
    var b = el('button', 'flex:1;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:6px;border:0;border-radius:12px;padding:11px 8px;font-weight:800;font-size:13px;font-family:inherit;background:' + bg + ';color:' + color, label);
    b.type = 'button';
    b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); onClick(b); });
    return b;
  }

  function buildRow(info) {
    var e = extOf(info.name);
    var chip = CHIP[e] || [e ? e.toUpperCase().slice(0, 4) : 'FILE', '#475569'];
    var row = el('div', 'padding:10px 0;border-bottom:1px solid #f1f5f9');

    var top = el('div', 'display:flex;align-items:center;gap:10px');
    var badge = el('div', 'flex:0 0 46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:11px;letter-spacing:.3px;background:' + chip[1], chip[0]);
    var txt = el('div', 'flex:1;min-width:0');
    txt.appendChild(el('div', 'font-weight:800;font-size:14px;color:#0f172a;word-break:break-all;line-height:1.25', info.name));
    txt.appendChild(el('div', 'font-size:11px;color:#64748b;margin-top:2px', formatSize(info.size) + ' · ' + FOLDER_LABEL));
    top.appendChild(badge);
    top.appendChild(txt);
    row.appendChild(top);

    var msg = el('div', 'font-size:11px;color:#b45309;margin-top:6px;display:none');
    var actions = el('div', 'display:flex;gap:8px;margin-top:9px');
    actions.appendChild(btn('📂 Ouvrir', '#0f766e', '#fff', function () {
      var saver = plugin('SaveFile');
      msg.style.display = 'none';
      if (!saver) return;
      saver.openFile({ uri: info.uri, mime: openMimeFor(info.name, info.mime) }).catch(function (err) {
        var m = String((err && (err.message || err)) || '');
        msg.textContent = /no_app/.test(m)
          ? 'Aucune application ne peut ouvrir ce type de fichier. Utilisez « Partager » ou ouvrez-le depuis Mes fichiers.'
          : 'Ouverture impossible : ' + m;
        msg.style.display = 'block';
      });
    }));
    actions.appendChild(btn('📤 Partager', '#e0f2fe', '#0369a1', function () {
      var saver = plugin('SaveFile');
      msg.style.display = 'none';
      if (!saver) return;
      saver.shareFile({ uri: info.uri, mime: info.mime || mimeFor(info.name), name: info.name }).catch(function (err) {
        msg.textContent = 'Partage impossible : ' + String((err && (err.message || err)) || '');
        msg.style.display = 'block';
      });
    }));
    row.appendChild(actions);
    row.appendChild(msg);
    return row;
  }

  function showCard(info) {
    try { var t = document.getElementById('appToast'); if (t) t.classList.add('hidden'); } catch (_) {}

    if (!cardState) {
      var overlay = el('div', 'position:fixed;inset:0;z-index:2147483000;background:rgba(3,12,24,.55);display:flex;align-items:flex-end;justify-content:center');
      var sheet = el('div', 'width:100%;max-width:480px;max-height:85vh;display:flex;flex-direction:column;background:#fff;border-radius:20px 20px 0 0;overflow:hidden;box-shadow:0 -10px 40px rgba(0,0,0,.35);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif');

      var head = el('div', 'display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(135deg,#071427,#0f766e);color:#fff');
      var tick = el('div', 'flex:0 0 34px;height:34px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:900', '✓');
      var ht = el('div', 'flex:1;min-width:0');
      var title = el('div', 'font-weight:900;font-size:15px', 'Fichier enregistré');
      ht.appendChild(title);
      ht.appendChild(el('div', 'font-size:11px;opacity:.9;margin-top:1px', 'Sur le téléphone : ' + FOLDER_LABEL));
      head.appendChild(tick);
      head.appendChild(ht);

      var list = el('div', 'padding:2px 16px;overflow:auto;flex:1');

      var foot = el('div', 'display:flex;gap:8px;padding:10px 16px 16px;border-top:1px solid #f1f5f9');
      foot.appendChild(btn('📁 Dossier', '#f1f5f9', '#334155', function () {
        var saver = plugin('SaveFile');
        if (saver) saver.openFolder().catch(function () {});
      }));
      foot.appendChild(btn('Fermer', '#0f172a', '#fff', closeCard));

      sheet.appendChild(head);
      sheet.appendChild(list);
      sheet.appendChild(foot);
      overlay.appendChild(sheet);
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeCard(); });
      document.body.appendChild(overlay);
      cardState = { overlay: overlay, list: list, title: title, count: 0 };
    }

    cardState.count += 1;
    cardState.title.textContent = cardState.count > 1 ? (cardState.count + ' fichiers enregistrés') : 'Fichier enregistré';
    cardState.list.insertBefore(buildRow(info), cardState.list.firstChild);
  }

  // ---------- Enregistrement ----------
  // Repli : écriture dans le cache de l'app puis feuille de partage Android (choisir « Enregistrer »).
  async function shareFallback(data, fileName) {
    var P = C.Plugins || {};
    var w = await P.Filesystem.writeFile({ path: fileName, data: data, directory: 'CACHE' });
    await P.Share.share({ title: fileName, url: w.uri, dialogTitle: 'Enregistrer ou partager' });
  }

  // opts.silent    : pas de carte (sauvegardes automatiques) ; l'erreur est renvoyée à l'appelant
  // opts.overwrite : remplace le fichier du même nom au lieu d'en créer un nouveau
  async function saveBlob(blob, name, opts) {
    opts = opts || {};
    var data = await toBase64(blob);
    var fileName = String(name || ('export-' + Date.now())).replace(/[\\/:*?"<>|]+/g, '_');
    var mime = mimeFor(fileName, blob.type);
    var saver = plugin('SaveFile');
    if (saver && typeof saver.save === 'function') {
      try {
        var r = await saver.save({ name: fileName, data: data, mime: mime, overwrite: !!opts.overwrite });
        var info = {
          uri: r && r.uri,
          name: (r && r.name) || fileName,
          mime: (r && r.mime) || mime,
          size: (r && r.size) || blob.size,
          folder: (r && r.folder) || 'Download/SmartRV'
        };
        if (!opts.silent) showCard(info);
        return info;
      } catch (e) {
        if (opts.silent) throw e;
        // Android < 10 ou échec MediaStore : on bascule sur la feuille de partage.
        console.warn('SaveFile indisponible, repli sur le partage', e);
      }
    } else if (opts.silent) {
      throw new Error('SaveFile indisponible');
    }
    await shareFallback(data, fileName);
    return null;
  }

  async function saveFile(href, name) {
    try {
      var blob = await (await fetch(href)).blob();
      await saveBlob(blob, name);
    } catch (e) {
      var m = String((e && e.message) || e);
      if (!/cancel/i.test(m)) reportError('Échec de l’enregistrement', m);
    }
  }

  // API utilisée par l'application (sauvegardes automatiques, etc.)
  window.SmartRVFiles = {
    available: true,
    saveBlob: saveBlob,
    folderLabel: FOLDER_LABEL
  };

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
