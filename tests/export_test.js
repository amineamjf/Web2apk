// Test du bloc d'export V403 avec la VRAIE bibliothèque xlsx-js-style : feuilles, heure à la seconde, ordre de lecture.
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const XLSX=require('xlsx-js-style');
const html=fs.readFileSync('index.html','utf8');
const grab=id=>{const m=html.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>')); assert(m,id+' introuvable'); return m[1];};
const ctx=vm.createContext({XLSX,console,localStorage:{getItem(){return null},setItem(){}},document:{addEventListener(){},readyState:'complete'},Date,JSON,Math,Object,Array,String,Number,isFinite,isNaN,parseFloat});
ctx.window=ctx;
const mk=(n,cur,t,extra)=>Object.assign({meter:'M'+n,name:'CLIENT '+n,tour:'T1',type:'EAU',prev:100,current:cur,anomaly:'RAS',history:{},readAt:t},extra||{});
const data=[mk(1,110,'2026-11-18T09:15:42.000Z'),mk(2,90,'2026-11-18T09:10:07.000Z'),mk(3,'',undefined),mk(4,180,'2026-11-18T09:20:00.000Z'),mk(5,105,'2026-11-18T09:12:30.000Z',{anomaly:'BLOQUE'}),mk(6,100,'2026-11-18T09:30:00.000Z',{anomaly:'INHABITE',photo:'data:image/jpeg;base64,AA'})];
ctx.allMetersData=data; ctx.tourName='T1'; ctx.v231ExportOrdered=()=>data;
vm.runInContext(grab('srp-smart'),ctx);
// l'export d'origine est simulé : feuilles « Synthèse » + « Relevé » (colonne heure en texte, comme avant)
ctx.buildExportWorkbook=function(){
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['x']]),'Synthèse');
  const rows=[['N° Compteur','Date/Heure Relevé','Index','Anomalie','Annotation']].concat(data.map(m=>[m.meter,m.readAt?'18/11/2026 09:xx':'',m.current,m.anomaly||'RAS','Aucune']));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Relevé'); return wb; };
vm.runInContext(grab('srp-export-v403'),ctx);
const wb=ctx.buildExportWorkbook();
assert.strictEqual(JSON.stringify(wb.SheetNames),JSON.stringify(['Analyse','Relevé']),'feuilles: '+wb.SheetNames);
const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx',cellStyles:true});
const rb=XLSX.read(buf,{cellDates:false,cellStyles:true}); assert.strictEqual(JSON.stringify(rb.SheetNames),JSON.stringify(['Analyse','Relevé']));
const ws=rb.Sheets['Relevé'], g=a=>ws[a];
assert.strictEqual(g('F1').v,'Ordre de lecture');
assert.strictEqual(g('D7').v,'RAS'); assert.strictEqual(g('E7').v,'03_LOCAL INHABITIE'); assert.strictEqual(g('D6').v,'BLOQUE'); assert.strictEqual(g('E6').v,'Aucune');
const exp=Date.UTC(2026,10,18,9,15,42)/86400000+25569;   // 2026-11-18 09:15:42 (heure locale du test = UTC)
const tz=new Date('2026-11-18T09:15:42.000Z').getTimezoneOffset()*60000/86400000;
assert(Math.abs(g('B2').v-(exp-tz))<1e-6,'serial B2 '+g('B2').v);
assert(/ss/.test(g('B2').z||'')||/s/.test(g('B2').z||''),'format secondes: '+g('B2').z);
// ordre : M2=1 · M5=2 · M1=3 · M4=4 · M6=5(09:30) … recalculé ci-dessous
assert.strictEqual(JSON.stringify(['F2','F3','F4','F5','F6','F7'].map(a=>(g(a)&&g(a).v)??'')),JSON.stringify([3,1,'',4,2,5]));
const an=rb.Sheets['Analyse']; const txt=XLSX.utils.sheet_to_csv(an);
assert(/CONSOMMATION|NÉGATIF|ÉLEVÉE|ANOMALIE/.test(txt),'bloc « À vérifier » absent');
assert(/Premier relevé/.test(txt)&&/Dernier relevé/.test(txt));
console.log('OK export V403 —',wb.SheetNames.join(' + '),'—',buf.length,'octets');
fs.writeFileSync('export-test.xlsx',buf);
