/* Smart RV — synchronisation cloud automatique (Supabase)
 *
 * Chargé à la fin de index.html par le workflow de build de l'APK.
 * Envoie la sauvegarde complète (même contenu que « Exporter une sauvegarde complète »)
 * vers un stockage privé, par morceaux, dès que le réseau est là puis régulièrement.
 * Le « code de synchronisation » (clé) est la seule chose qui donne accès aux données.
 * Deux emplacements (A/B) s'alternent : la copie la plus récente n'est jamais touchée
 * pendant qu'on écrit l'autre.
 */
(function () {
  'use strict';
  if (window.SRPCloud) return;

  var ENDPOINT = 'https://oaomlhokzdsfkhqruoco.supabase.co/functions/v1/sync';
  // Clé publique « anon » : elle ne donne aucun droit sur les données (tout passe par l'Edge Function + code).
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hb21saG9remRzZmtocXJ1b2NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3NTkyMTgsImV4cCI6MjExMDMzNTIxOH0.frqWoDNNyj6qle31_h2Tvgp6dI03P4BXmk-up1wjm9s';
  var PART_CHARS = 3 * 1024 * 1024;
  var STORES = ['meters', 'gpsTrack', 'settings', 'history'];
  var K = {
    key: 'smartrv_cloud_key', min: 'smartrv_cloud_min', last: 'smartrv_cloud_last',
    check: 'smartrv_cloud_check', sig: 'smartrv_cloud_sig', seen: 'smartrv_cloud_seen',
    info: 'smartrv_cloud_info', hold: 'smartrv_cloud_hold', restoreTry: 'smartrv_cloud_restore_try'
  };
  var S = { busy: false, err: '', failAt: 0, step: '', tx: '', inited: false, render: null };

  /* ---------- utilitaires ---------- */
  function ls(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }
  function ldel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function $(id) { return document.getElementById(id); }
  function toast(m, t) { try { window.showToast(m, t || 'info'); } catch (_) {} }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function getKey() { return ls(K.key) || ''; }
  function getMin() { var v = ls(K.min); if (v === null) return 60; v = Number(v); return isFinite(v) ? v : 60; }
  function normKey(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
  function genKey() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '', buf = new Uint8Array(20);
    crypto.getRandomValues(buf); // 256 % 32 == 0 : pas de biais
    for (var i = 0; i < 20; i++) { out += a[buf[i] % a.length]; if (i % 5 === 4 && i < 19) out += '-'; }
    return 'SRV-' + out;
  }
  function fnvUpdate(h, str) {
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }
  function refresh() { try { if (S.render) S.render(); } catch (_) {} updateInfoLine(); }

  /* ---------- réseau : fetch, sinon HTTP natif Capacitor (contourne CORS) ---------- */
  function makeHeaders(hasBody) {
    var h = { apikey: ANON, Authorization: 'Bearer ' + ANON, 'x-sync-key': getKey() };
    if (hasBody) h['Content-Type'] = 'text/plain';
    return h;
  }
  async function viaFetch(method, url, h, body) {
    var r = await fetch(url, { method: method, headers: h, body: body == null ? undefined : body });
    return { status: r.status, text: await r.text() };
  }
  async function viaNative(method, url, h, body) {
    var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    if (!P || !P.request) throw new Error('Réseau indisponible');
    var o = { url: url, method: method, headers: h, responseType: 'text' };
    if (body != null) o.data = body;
    var r = await P.request(o);
    return { status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
  }
  async function rawCall(method, qs, body) {
    var url = ENDPOINT + '?' + qs, h = makeHeaders(body != null);
    var order = S.tx === 'native' ? [viaNative, viaFetch] : [viaFetch, viaNative];
    for (var i = 0; i < order.length; i++) {
      try {
        var res = await order[i](method, url, h, body);
        S.tx = order[i] === viaNative ? 'native' : 'fetch';
        return res;
      } catch (_) { /* on essaie l'autre transport */ }
    }
    var e = new Error('Pas de connexion au serveur'); e.network = true; throw e;
  }
  async function api(method, qs, body) {
    var res = await rawCall(method, qs, body), data = null;
    try { data = res.text ? JSON.parse(res.text) : null; } catch (_) {}
    if (res.status < 200 || res.status >= 300) {
      var code = (data && data.error) || ('HTTP ' + res.status);
      var e = new Error(code === 'bad_key' ? 'Code de synchronisation invalide'
        : code === 'not_found' ? 'Introuvable' : 'Serveur : ' + code);
      e.status = res.status; e.retry = res.status >= 500; throw e;
    }
    return data;
  }
  async function withRetry(fn) {
    var last;
    for (var i = 0; i < 3; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (!(e.network || e.retry)) throw e;
        await sleep(800 * (i + 1));
      }
    }
    throw last;
  }

  /* ---------- découpage de la sauvegarde en morceaux ---------- */
  function buildParts(b) {
    var parts = [];
    STORES.forEach(function (k) {
      var arr = b[k] || [], cur = [], size = 0;
      function flush() {
        if (cur.length) { parts.push('{"k":"' + k + '","items":[' + cur.join(',') + ']}'); cur = []; size = 0; }
      }
      for (var i = 0; i < arr.length; i++) {
        var s = JSON.stringify(arr[i]);
        if (size + s.length > PART_CHARS && cur.length) flush();
        cur.push(s); size += s.length + 1;
      }
      flush();
    });
    return parts;
  }

  /* ---------- envoi ---------- */
  async function syncNow(opts) {
    opts = opts || {};
    if (S.busy) return { busy: true };
    if (!getKey()) return { skipped: 'nokey' };
    if (ls(K.hold) === '1' && !opts.explicit) return { skipped: 'hold' };
    if (typeof window.buildFullBackupObject !== 'function') return { error: 'Application pas prête' };
    if (navigator.onLine === false) { refresh(); return { skipped: 'offline' }; }
    S.busy = true; S.err = ''; S.step = 'Préparation…'; refresh();
    try {
      var backup = await window.buildFullBackupObject();
      // Sécurité : on n'écrase jamais une bonne copie cloud avec des données vides.
      if (!backup || !backup.meters || !backup.meters.length) { lset(K.check, Date.now()); return { skipped: 'empty' }; }
      var parts = buildParts(backup);
      var h = 2166136261 >>> 0, total = 0;
      parts.forEach(function (p) { h = fnvUpdate(h, p); total += p.length; });
      var sig = h.toString(16) + ':' + total + ':' + parts.length;
      if (!opts.force && sig === ls(K.sig)) { lset(K.check, Date.now()); return { skipped: 'same' }; }

      S.step = 'Connexion au serveur…'; refresh();
      var info = await withRetry(function () { return api('GET', 'op=info'); });
      var a = info && info.A && info.A.savedAt, b = info && info.B && info.B.savedAt;
      // On écrit dans l'emplacement le plus ancien (ou vide) : la copie récente reste intacte.
      var slot = !a ? 'A' : !b ? 'B' : (a > b ? 'B' : 'A');
      // Marque l'emplacement « en cours d'écriture » avant de toucher à ses morceaux.
      await withRetry(function () {
        return api('POST', 'op=put&slot=' + slot + '&part=manifest', JSON.stringify({ partial: true, savedAt: '' }));
      });
      for (var i = 0; i < parts.length; i++) {
        S.step = 'Envoi ' + (i + 1) + '/' + parts.length + '…'; refresh();
        await withRetry(function () { return api('POST', 'op=put&slot=' + slot + '&part=' + i, parts[i]); });
      }
      var savedAt = new Date().toISOString();
      var manifest = {
        v: 1, app: 'SmartRV', schema: backup.schema || 1, savedAt: savedAt, exportedAt: backup.exportedAt || savedAt,
        parts: parts.length, meters: backup.meters.length, bytes: total, sig: sig, local: backup.local || {}
      };
      await withRetry(function () { return api('POST', 'op=put&slot=' + slot + '&part=manifest', JSON.stringify(manifest)); });
      // Vérification : on relit le manifest.
      var back = await withRetry(function () { return api('GET', 'op=get&slot=' + slot + '&part=manifest'); });
      if (!back || back.sig !== sig) throw new Error('Vérification de la copie cloud échouée');

      lset(K.last, Date.now()); lset(K.check, Date.now()); lset(K.sig, sig);
      lset(K.info, backup.meters.length + ' compteurs · ' + (total / 1048576).toFixed(1) + ' Mo');
      ldel(K.hold); S.failAt = 0;
      return { ok: true, slot: slot, parts: parts.length };
    } catch (e) {
      S.err = String((e && e.message) || e); S.failAt = Date.now();
      if (e && e.network) S.err = 'En attente de connexion (' + S.err + ')';
      try { console.warn('cloud-sync', e); } catch (_) {}
      return { error: S.err };
    } finally { S.busy = false; S.step = ''; refresh(); }
  }

  function minutesSince(k) { return (Date.now() - Number(ls(k) || 0)) / 60000; }
  function due() {
    var m = getMin(); if (!m) return false;
    return Math.min(minutesSince(K.last), minutesSince(K.check)) >= m;
  }
  async function trySync(reason) {
    if (!getMin() || !getKey() || S.busy) return;
    if (reason !== 'online' && S.failAt && Date.now() - S.failAt < 5 * 60000) return;
    if (reason === 'online') S.failAt = 0;
    return syncNow({});
  }
  function tick() { try { if (due()) trySync('tick'); } catch (_) {} }

  /* ---------- lecture / restauration ---------- */
  async function latestManifest() {
    var info = await withRetry(function () { return api('GET', 'op=info'); });
    var list = [];
    ['A', 'B'].forEach(function (s) {
      var m = info && info[s];
      if (m && !m.partial && m.savedAt && m.parts >= 1) { m.slot = s; list.push(m); }
    });
    list.sort(function (x, y) { return x.savedAt < y.savedAt ? 1 : -1; });
    return list;
  }
  async function assemble(man) {
    var out = { app: 'SmartRV', schema: man.schema || 1, exportedAt: man.exportedAt || man.savedAt,
      meters: [], gpsTrack: [], settings: [], history: [], local: man.local || {} };
    for (var i = 0; i < man.parts; i++) {
      S.step = 'Téléchargement ' + (i + 1) + '/' + man.parts + '…'; refresh();
      var p = await withRetry(function () { return api('GET', 'op=get&slot=' + man.slot + '&part=' + i); });
      if (!p || !Array.isArray(p.items) || !Array.isArray(out[p.k])) throw new Error('Morceau ' + (i + 1) + ' illisible');
      for (var j = 0; j < p.items.length; j++) out[p.k].push(p.items[j]);
    }
    if (out.meters.length !== man.meters) throw new Error('Copie cloud incomplète');
    return out;
  }
  async function restoreFromCloud() {
    if (S.busy) return { busy: true };
    if (typeof window.restoreFullBackup !== 'function') return { error: 'Restauration indisponible' };
    S.busy = true; S.err = ''; S.step = 'Recherche de la copie…'; refresh();
    try {
      var list = await latestManifest();
      if (!list.length) { toast('Aucune copie trouvée dans le cloud pour ce code.', 'warn'); return { none: true }; }
      var data = null, lastErr = null;
      for (var i = 0; i < list.length && !data; i++) {
        try { data = await assemble(list[i]); } catch (e) { lastErr = e; }
      }
      if (!data) throw lastErr || new Error('Copie illisible');
      var file = new File([JSON.stringify(data)], 'SmartRV_cloud.json', { type: 'application/json' });
      S.busy = false; S.step = ''; refresh();
      lset(K.restoreTry, Date.now());
      window.restoreFullBackup({ target: { files: [file], value: '' } }); // demande confirmation puis recharge l'app
      return { ok: true };
    } catch (e) {
      S.err = String((e && e.message) || e);
      return { error: S.err };
    } finally { S.busy = false; S.step = ''; refresh(); }
  }
  async function probeCloud() {
    try { var l = await latestManifest(); return l.length ? l[0] : null; } catch (_) { return undefined; }
  }

  /* ---------- interface ---------- */
  function statusText() {
    if (!getMin()) return 'Synchronisation cloud désactivée.';
    if (S.busy) return '⏳ ' + (S.step || 'Synchronisation…');
    var last = Number(ls(K.last) || 0), t;
    t = last ? '☁️ Dernière synchro : ' + new Date(last).toLocaleString('fr-FR') + (ls(K.info) ? '\n' + ls(K.info) : '')
      : '☁️ Pas encore synchronisé.';
    if (ls(K.hold) === '1') t += '\n⏸ Envoi en pause : restaurez la copie cloud, ou touchez « Synchroniser maintenant » pour la remplacer.';
    if (navigator.onLine === false) t += '\nHors ligne : envoi automatique dès le retour du réseau.';
    return t;
  }
  function updateInfoLine() {
    try {
      var el = document.querySelector('[data-cloud-info]'); if (!el) return;
      var last = Number(ls(K.last) || 0);
      el.textContent = S.busy ? (S.step || 'Synchronisation…')
        : S.err ? '⚠️ ' + S.err
        : !getMin() ? 'Cloud désactivé'
        : last ? 'Cloud : ' + new Date(last).toLocaleString('fr-FR') : 'Cloud : pas encore synchronisé';
    } catch (_) {}
  }
  function copyText(txt) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); return true; } } catch (_) {}
    try {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (_) { return false; }
  }
  function openModal() {
    var old = $('srpCloudModal'); if (old) old.remove();
    var firstTime = ls(K.seen) !== '1';
    var md = document.createElement('div'); md.id = 'srpCloudModal';
    md.style.cssText = 'position:fixed;inset:0;background:rgba(3,12,24,.7);z-index:10090;display:flex;align-items:flex-end;justify-content:center';
    md.innerHTML = '<div style="width:100%;max-width:480px;max-height:92vh;display:flex;flex-direction:column;background:#fff;border-radius:18px 18px 0 0;overflow:hidden;font-family:inherit">'
      + '<div style="padding:14px 16px;background:linear-gradient(135deg,#071427,#1d4ed8);color:#fff"><div style="font-weight:900;font-size:15px">☁️ Synchronisation cloud</div>'
      + '<div style="font-size:11px;opacity:.92;margin-top:3px;line-height:1.35">Une copie complète est envoyée toute seule vers un stockage privé dès qu’il y a du réseau, puis régulièrement.</div></div>'
      + '<div style="padding:12px 14px;overflow:auto;flex:1;color:#0f172a;font-size:12px">'
      + (firstTime ? '<div style="margin-bottom:10px;padding:10px;border-radius:12px;background:#fffbeb;color:#92400e;font-weight:700;line-height:1.4">⚠️ Notez ce code (copiez-le ou envoyez-le vous sur WhatsApp). Sans lui, impossible de récupérer vos données sur un autre téléphone.</div>' : '')
      + '<div style="font-weight:800;margin-bottom:6px">Code de synchronisation</div>'
      + '<div id="cvKey" style="padding:10px;border-radius:12px;background:#f1f5f9;font-family:monospace;font-weight:800;font-size:14px;letter-spacing:.5px;word-break:break-all"></div>'
      + '<div style="display:flex;gap:6px;margin-top:6px"><button id="cvCopy" type="button" style="flex:1;border:0;border-radius:10px;padding:9px;background:#e0e7ff;color:#1e3a8a;font-weight:800;font-size:12px">📋 Copier</button>'
      + '<button id="cvWa" type="button" style="flex:1;border:0;border-radius:10px;padding:9px;background:#dcfce7;color:#166534;font-weight:800;font-size:12px">💬 Envoyer par WhatsApp</button></div>'
      + '<div style="font-weight:800;margin:12px 0 6px">Fréquence</div><div id="cvChoices" style="display:flex;flex-wrap:wrap;gap:6px"></div>'
      + '<div id="cvStatus" style="margin-top:12px;padding:10px;border-radius:12px;background:#f1f5f9;font-weight:700;line-height:1.4;white-space:pre-line"></div>'
      + '<div style="margin-top:10px;color:#475569;line-height:1.45">• L’envoi se fait aussi <b>dès le retour du réseau</b> et quand vous quittez l’application.<br>'
      + '• Rien n’est envoyé si rien n’a changé, ni si l’application est vide.<br>'
      + '• Nouveau téléphone : touchez « J’ai déjà un code », saisissez-le, puis restaurez.</div></div>'
      + '<div style="padding:8px 14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:8px;border-top:1px solid #f1f5f9">'
      + '<button id="cvNow" type="button" style="grid-column:1/3;border:0;border-radius:12px;padding:12px 8px;background:#1d4ed8;color:#fff;font-weight:800;font-size:13px">☁️ Synchroniser maintenant</button>'
      + '<button id="cvRestore" type="button" style="border:0;border-radius:12px;padding:11px 8px;background:#fee2e2;color:#991b1b;font-weight:800;font-size:12px">⬇️ Restaurer du cloud</button>'
      + '<button id="cvCode" type="button" style="border:0;border-radius:12px;padding:11px 8px;background:#f1f5f9;color:#334155;font-weight:800;font-size:12px">🔑 J’ai déjà un code</button>'
      + '<button id="cvClose" type="button" style="grid-column:1/3;border:0;border-radius:12px;padding:11px 8px;background:#f1f5f9;color:#334155;font-weight:800;font-size:13px">Fermer</button></div></div>';
    document.body.appendChild(md);
    function close() { lset(K.seen, '1'); S.render = null; md.remove(); }
    md.addEventListener('click', function (e) { if (e.target === md) close(); });
    $('cvClose').onclick = close;
    $('cvCopy').onclick = function () {
      var ok = copyText(getKey());
      toast(ok ? 'Code copié.' : 'Copie impossible : recopiez le code à la main.', ok ? 'success' : 'warn');
    };
    $('cvWa').onclick = function () {
      var t = 'Code de synchronisation Smart RV : ' + getKey();
      try { window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank'); } catch (_) {}
    };
    S.render = function () {
      var box = $('cvChoices'), st = $('cvStatus'), now = $('cvNow'), kb = $('cvKey'), rs = $('cvRestore'); if (!box || !st) return;
      kb.textContent = getKey();
      var cur = getMin(); box.innerHTML = '';
      [[0, 'Désactivée'], [15, '15 min'], [30, '30 min'], [60, '1 h']].forEach(function (c) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = c[1];
        b.style.cssText = 'border:0;border-radius:12px;padding:10px 14px;font-weight:800;font-size:12px;' + (cur === c[0] ? 'background:#1d4ed8;color:#fff' : 'background:#f1f5f9;color:#334155');
        b.onclick = function () { lset(K.min, c[0]); if (c[0]) { ldel(K.check); tick(); } refresh(); };
        box.appendChild(b);
      });
      var txt = statusText(); if (S.err) txt += '\n⚠️ ' + S.err;
      st.textContent = txt; st.style.background = S.err ? '#fef2f2' : '#f1f5f9'; st.style.color = S.err ? '#b91c1c' : '#0f172a';
      now.disabled = S.busy; rs.disabled = S.busy; now.style.opacity = rs.style.opacity = S.busy ? '.6' : '1';
      now.textContent = S.busy ? '⏳ En cours…' : '☁️ Synchroniser maintenant';
    };
    $('cvNow').onclick = async function () {
      var r = await syncNow({ force: true, explicit: true });
      if (r && r.skipped === 'empty') toast('Aucun compteur à synchroniser.', 'warn');
      else if (r && r.skipped === 'offline') toast('Pas de réseau : envoi automatique dès son retour.', 'warn');
      else if (r && r.ok) toast('Synchronisation terminée.', 'success');
      else if (r && r.error) { try { window.showPersistentErrorModal('Synchronisation impossible', r.error); } catch (_) { alert(r.error); } }
    };
    $('cvRestore').onclick = async function () {
      var r = await restoreFromCloud();
      if (r && r.error) { try { window.showPersistentErrorModal('Restauration impossible', r.error); } catch (_) { alert(r.error); } }
    };
    $('cvCode').onclick = async function () {
      var v = prompt('Saisissez votre code de synchronisation (ex. SRV-XXXXX-XXXXX-XXXXX-XXXXX) :', '');
      if (v === null) return;
      v = normKey(v);
      if (v.length < 16) { toast('Code trop court.', 'error'); return; }
      lset(K.key, v); ldel(K.sig); ldel(K.last); ldel(K.info); S.err = ''; refresh();
      var m = await probeCloud();
      if (m) {
        lset(K.hold, '1'); refresh();
        toast('Copie cloud trouvée (' + m.meters + ' compteurs). Touchez « Restaurer du cloud ».', 'success');
      } else if (m === null) { ldel(K.hold); toast('Code enregistré. Aucune copie cloud pour le moment.', 'info'); }
      else toast('Code enregistré, mais le serveur est injoignable pour l’instant.', 'warn');
      refresh();
    };
    S.render();
  }

  function injectMenu() {
    try {
      if ($('srpCloudMenuBtn')) return true;
      var anchor = null, btns = document.querySelectorAll('.side-menu-btn');
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].getAttribute('onclick') || '').indexOf('openAutoFileSettings') > -1) anchor = btns[i];
      }
      if (!anchor) return false;
      var ref = anchor, nx = anchor.nextElementSibling;
      if (nx && nx.hasAttribute && nx.hasAttribute('data-autofile-info')) ref = nx;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'side-menu-btn'; b.id = 'srpCloudMenuBtn';
      b.innerHTML = '<span class="side-menu-icon" aria-hidden="true">☁️</span><span>Synchronisation cloud</span>';
      b.onclick = function () { try { window.closeEntrySideMenu(); } catch (_) {} setTimeout(openModal, 80); };
      var info = document.createElement('div'); info.className = 'side-menu-session-user'; info.setAttribute('data-cloud-info', '');
      ref.parentNode.insertBefore(b, ref.nextSibling);
      b.parentNode.insertBefore(info, b.nextSibling);
      updateInfoLine();
      return true;
    } catch (_) { return false; }
  }

  /* ---------- démarrage ---------- */
  function init() {
    if (S.inited) return; S.inited = true;
    try {
      if (!getKey()) lset(K.key, genKey());
      // Si une restauration vient d'avoir lieu juste avant ce rechargement, on lève la pause d'envoi.
      if (ls(K.hold) === '1' && minutesSince(K.restoreTry) < 3) { ldel(K.hold); ldel(K.sig); }
      var tries = 0;
      (function mount() { if (!injectMenu() && ++tries < 10) setTimeout(mount, 1000); })();
      updateInfoLine();
      setTimeout(function () { trySync('start'); }, 20000);
      setInterval(tick, 60000);
      window.addEventListener('online', function () { setTimeout(function () { trySync('online'); }, 2000); });
      window.addEventListener('offline', refresh);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') { if (minutesSince(K.check) >= 3) trySync('hide'); }
        else setTimeout(tick, 1500);
      });
      window.addEventListener('pagehide', function () { if (minutesSince(K.check) >= 3) trySync('hide'); });
      if (ls(K.seen) !== '1') setTimeout(function () { if (!$('srpCloudModal')) openModal(); }, 6000);
    } catch (e) { try { console.warn('cloud-sync init', e); } catch (_) {} }
  }

  window.openCloudSync = openModal;
  window.SRPCloud = {
    sync: function (o) { return syncNow(o || { force: true, explicit: true }); },
    restore: restoreFromCloud, open: openModal, getKey: getKey,
    _t: { buildParts: buildParts, assemble: assemble, latestManifest: latestManifest, syncNow: syncNow, restoreFromCloud: restoreFromCloud, S: S, K: K, due: due }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
