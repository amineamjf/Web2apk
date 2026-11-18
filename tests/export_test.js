// Test du bloc d'export V403 avec la VRAIE bibliothèque xlsx-js-style : feuilles, heure à la seconde, ordre de lecture.
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const XLSX=require('xlsx-js-style');
const html=fs.readFileSync('index.html','utf8');
const grab=id=>{const m=html.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>')); assert(m,id+' introuvable'); return m[1];};
const ctx=vm.createContext({XLSX,console,localStorage:{getItem(){return null},setItem(){}},document:{addEventListener(){},readyState:'complete'},Date,JSON,Math,Object,Array,String,Number,isFinite,isNaN,parseFloat});
ctx.window=ctx;
const mk=(n,cur,t,extra)=>Object.assign({meter:'M'+n,name:'CLIENT '+n,tour:'T1',type:'EAU',prev:100,current:cur,anomaly:'RAS',history:{},readAt:t},extra||{});
const data=[mk(1,110,'2026-11-18T09:15:42.000Z'),mk(2,90,'2026-11-18T09:10:07.000Z'),mk(3,'',undefined),mk(4,180,'2026-11-18T09:20:00.000Z'),mk(5,105,'2026-11-18T09:12:30.000Z',{anomaly:'BLOQUE'})];
ctx.allMetersData=data; ctx.tourName='T1'; ctx.v231ExportOrdered=()=>data;
vm.runInContext(grab('srp-smart'),ctx);
// l'export d'origine est simulé : feuilles « Synthèse » + « Relevé » (colonne heure en texte, comme avant)
ctx.buildExportWorkbook=function(){
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['x']]),'Synthèse');
  const rows=[['N° Compteur','Date/Heure Relevé','Index']].concat(data.map(m=>[m.meter,m.readAt?'18/11/2026 09:xx':'',m.current]));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Relevé'); return wb; };
vm.runInContext(grab('srp-export-v403'),ctx);
const wb=ctx.buildExportWorkbook();
assert.deepStrictEqual(wb.SheetNames,['Analyse','Relevé'],'feuilles: '+wb.SheetNames);
const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx',cellStyles:true});
const rb=XLSX.read(buf,{cellDates:false,cellStyles:true}); assert.deepStrictEqual(rb.SheetNames,['Analyse','Relevé']);
const ws=rb.Sheets['Relevé'], g=a=>ws[a];
assert.strictEqual(g('D1').v,'Ordre de lecture');
const exp=Date.UTC(2026,10,18,9,15,42)/86400000+25569;   // 2026-11-18 09:15:42 (heure locale du test = UTC)
const tz=new Date('2026-11-18T09:15:42.000Z').getTimezoneOffset()*60000/86400000;
assert(Math.abs(g('B2').v-(exp-tz))<1e-6,'serial B2 '+g('B2').v);
assert(/ss/.test(g('B2').z||'')||/s/.test(g('B2').z||''),'format secondes: '+g('B2').z);
// ordre : 09:10:07(M2)=1 · 09:12:30(M5)=2 · 09:15:42(M1)=3 · 09:20:00(M4)=4 · M3 non lu = vide
assert.deepStrictEqual(['D2','D3','D4','D5','D6'].map(a=>g(a)&&g(a).v),[3,1,'',4,2]);
const an=rb.Sheets['Analyse']; const txt=XLSX.utils.sheet_to_csv(an);
assert(/CONSOMMATION|NÉGATIF|ÉLEVÉE|ANOMALIE/.test(txt),'bloc « À vérifier » absent');
assert(/Premier relevé/.test(txt)&&/Dernier relevé/.test(txt));
console.log('OK export V403 —',wb.SheetNames.join(' + '),'—',buf.length,'octets');
fs.writeFileSync('export-test.xlsx',buf);
