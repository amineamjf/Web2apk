// Génère un export Excel RÉEL (code de l'app + vraies bibliothèques) à partir de données SYNTHÉTIQUES
// et le sauvegarde dans out/export.xlsx pour validation XML (aucune donnée client).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
  await p.goto('file://' + path.resolve('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(6000);
  const info = await p.evaluate(() => ({ xlsx: typeof XLSX, jszip: typeof JSZip, build: typeof buildExportWorkbook, bytes: typeof window.SRPXlsxBytes }));
  console.log('libs', JSON.stringify(info));
  const b64 = await p.evaluate(async () => {
    const ans = ['RAS','INHABITE','INACCESSIBLE','BLOQUE','ILLISIBLE','COMPTEUR_POSE_ENVERS','FUITE_ABONNE','COMPTEUR_CHANGE'];
    const D = [];
    for (let i = 1; i <= 60; i++) {
      D.push({ contract: 'C' + i, meter: '4S2A18' + String(1000 + i), name: i % 7 === 0 ? 'ÉLOÏSE & O\'BRIEN <test> "q"' : (i % 5 === 0 ? 'محمد العلوي' : 'CLIENT ' + i),
        address: 'RUE ' + i + ' N°' + i, tour: i % 2 ? 'BO-UR 4YK0EP26' : 'BO-UR 4YK0EP25', prev: 100 + i, current: i % 3 === 0 ? '' : 110 + i,
        read: i % 3 !== 0, anomaly: ans[i % ans.length], annotation: i % 4 === 0 ? 'Porte fermée' : 'Aucune', type: i % 10 === 0 ? 'ELEC' : 'EAU',
        photo: '', gps: i % 2 ? '34.2,-6.58' : '', history: { 'Octobre': 100 + i, 'Septembre': 95 + i, 'Novembre 2024': 50 + i },
        sortIndex: i - 1, readAt: '2026-11-18T09:00:00.000Z', phone: '0600000' + i, replacedFrom: i % 6 === 0 ? 'OLD' + i : '', added: i % 9 === 0, reordered: i % 8 === 0, v290Prev: null });
    }
    allMetersData = D; dataVersion++; filterCache = { version: 0, eau: null, elec: null };
    const wb = buildExportWorkbook();
    const u8 = await window.SRPXlsxBytes(wb);
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/export.xlsx', Buffer.from(b64, 'base64'));
  console.log('xlsx bytes', Buffer.from(b64, 'base64').length, 'page errors', JSON.stringify(errs));
  await b.close();
})();
