// Test du bloc d'export V403 avec la VRAIE bibliothèque xlsx-js-style : feuilles, heure à la seconde, ordre de lecture.
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const XLSX=require('xlsx-js-style'); const JSZip=require('jszip');
const html=fs.readFileSync('index.html','utf8');
const grab=id=>{const m=html.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>')); assert(m,id+' introuvable'); return m[1];};
const ctx=vm.createContext({XLSX,console,localStorage:{getItem(){return null},setItem(){}},document:{addEventListener(){},readyState:'complete'},Date,JSON,Math,Object,Array,String,Number,isFinite,isNaN,parseFloat,Uint8Array,Blob,URL,JSZip,Promise,setTimeout});
ctx.window=ctx;
const mk=(n,cur,t,extra)=>Object.assign({meter:'M'+n,name:'CLIENT '+n,tour:'T1',type:'EAU',prev:100,current:cur,anomaly:'RAS',history:{},readAt:t},extra||{});
const names=['MORTADA OMAR','ISMAILI EL HASSAN','BENALI KARIM','FATIMA EL OUEHDANI','SAMIR HLAL','YOUSSEF BAKHALEK','AZIZ DRAOUI','KACEM DADSI'];
const data=[]; for(let i=1;i<=60;i++){ const t=i%4; const base=3+(i*7)%9; let cur=100+base, prev=100, an='RAS', rd='2026-11-18T09:'+String(10+(i%45)).padStart(2,'0')+':'+String((i*13)%60).padStart(2,'0')+'.000Z', photo;
  const m=mk(i,cur,rd,{tour:'TOURNEE-'+(t+1),name:names[i%8]+' '+i,prev:prev,history:{'Août':10,'Septembre':16,'Octobre':20}});
  if(i%9===0){ m.current=''; m.readAt=undefined; }
  if(i===3) m.current=140; if(i===11) m.current=190; if(i===17) m.current=80; if(i===23) m.current=100; if(i===29){m.anomaly='BLOQUE';}
  if(i===31){m.anomaly='INHABITE'; photo='data:image/jpeg;base64,AA';} if(i===37) m.current=112; if(i===41) m.current=400;
  if(photo) m.photo=photo; data.push(m); }
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
(async()=>{
  const buf=await ctx.SRPXlsxBytes(wb);                         // chemin réel : xlsx + graphiques injectés
  const rb=XLSX.read(buf,{cellDates:false,cellStyles:true});
  assert.strictEqual(JSON.stringify(rb.SheetNames),JSON.stringify(['Analyse','Relevé']));
  const ws=rb.Sheets['Relevé'], g=a=>ws[a];
  assert.strictEqual(g('F1').v,'Ordre de lecture');
  assert.strictEqual(g('D32').v,'RAS'); assert.strictEqual(g('E32').v,'03_LOCAL INHABITIE');   // compteur 31 : inhabité -> Annotation
  assert.strictEqual(g('D30').v,'BLOQUE'); assert.strictEqual(g('E30').v,'Aucune');            // compteur 29 : bloqué -> Anomalie
  const t1=Date.UTC(2026,10,18,9,11,13)/86400000+25569, tz=new Date('2026-11-18T09:11:13.000Z').getTimezoneOffset()*60000/86400000;
  assert(Math.abs(g('B2').v-(t1-tz))<1e-6,'serial B2 '+g('B2').v);
  assert(/s/.test(g('B2').z||''),'format secondes: '+g('B2').z);
  const read=data.map((m,i)=>({i,t:m.readAt?Date.parse(m.readAt):null})).filter(x=>x.t!==null).sort((a,b)=>a.t-b.t||a.i-b.i);
  read.forEach((x,k)=>assert.strictEqual(g('F'+(x.i+2)).v,k+1,'ordre ligne '+(x.i+2)));
  assert.strictEqual((g('F10')&&g('F10').v)??'','');            // compteur 9 non lu : pas d'ordre
  // tableau de bord
  const an=rb.Sheets['Analyse'], txt=XLSX.utils.sheet_to_csv(an);
  ['TABLEAU DE BORD','Compteurs suivis','Très élevées','Répartition par niveau','À surveiller','Avancement par tournée','Photos : 1'].forEach(k=>assert(txt.includes(k),'« '+k+' » absent'));
  assert(/TOURNEE-1/.test(txt));
  // paquet : graphiques réellement présents et reliés
  const z=await JSZip.loadAsync(buf), names=Object.keys(z.files);
  ['xl/charts/chartSrp1.xml','xl/charts/chartSrp2.xml','xl/drawings/drawingSrp1.xml'].forEach(f=>assert(names.includes(f),f+' manquant'));
  const wbx=await z.file('xl/workbook.xml').async('string');
  const sheet1=await z.file('xl/worksheets/sheet1.xml').async('string');
  assert(/<drawing r:id="rIdSrpDr"\/>/.test(sheet1)&&/showGridLines="0"/.test(sheet1),'dessin/quadrillage');
  assert(/doughnutChart/.test(await z.file('xl/charts/chartSrp1.xml').async('string')));
  assert(/<c:barDir val="bar"\/>/.test(await z.file('xl/charts/chartSrp2.xml').async('string')));
  const ct=await z.file('[Content_Types].xml').async('string'); assert(/chartSrp1/.test(ct)&&/drawingSrp1/.test(ct));
  // jamais d'échec : sans JSZip -> fichier valide sans graphiques
  const ctx2=Object.assign({},ctx); 
  console.log('OK export V406 —',rb.SheetNames.join(' + '),'—',buf.length,'octets');
  fs.writeFileSync('export-test.xlsx',Buffer.from(buf));
})().catch(e=>{ console.error(e); process.exit(1); });
