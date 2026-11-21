// Export RÉEL : charge index.html (avec ses vraies bibliothèques via internet), injecte des compteurs, appelle l'export de l'appli.
const { chromium } = require('playwright'); const fs=require('fs'), http=require('http'), path=require('path');
const srv=http.createServer((q,s)=>{const f=path.join(process.cwd(),q.url.split('?')[0].slice(1)||'index.html');fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();}else{s.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript':f.endsWith('.json')?'application/json':'text/html'});s.end(d);}});}).listen(8790);
(async()=>{
  const b=await chromium.launch(); const p=await (await b.newContext()).newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));
  await p.goto('http://localhost:8790/index.html',{waitUntil:'networkidle'}); await p.waitForTimeout(3000);
  const b64=await p.evaluate(async()=>{
    const names=['MORTADA OMAR','ISMAILI EL HASSAN','BENALI KARIM','FATIMA EL OUEHDANI','SAMIR HLAL','YOUSSEF BAKHALEK','AZIZ DRAOUI','KACEM DADSI'];
    const D=[]; for(let i=1;i<=40;i++){ const prev=100+i; let cur=prev+3+(i*7)%9; let an='RAS', ann='Aucune';
      if(i===3) cur=prev+40; if(i===11) cur=prev+90; if(i===17) cur=prev-20; if(i===23) cur=prev; if(i===29) an='BLOQUE'; if(i===31) an='INHABITE';
      const unread=(i%9===0);
      D.push({contract:'50094'+i,meter:'4S2A1813'+i,name:names[i%8]+' '+i,address:i+' RUE '+(i%5)+' QUARTIER EL KOUCH',tour:'BO-UR 4YK0AI'+(25+(i%2)),prev,current:unread?'':cur,read:!unread,anomaly:an,annotation:ann,type:'EAU',photo:(i===3||i===31)?'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=':'',gps:(i%3===0)?'34.2'+i+', -5.71'+i:'',history:{Août:90+i,Septembre:95+i,Octobre:prev},sortIndex:i-1,readAt:unread?undefined:'2026-11-18T09:'+String(10+(i%45)).padStart(2,'0')+':'+String((i*13)%60).padStart(2,'0')+'.000Z'});
    }
    allMetersData=D; dataVersion++; filterCache={version:0,eau:null,elec:null}; setActiveFluide('EAU');
    const u8=await window.SRPXlsxBytes(buildExportWorkbook()); let s=''; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return btoa(s);
  });
  fs.writeFileSync('real-export.xlsx',Buffer.from(b64,'base64')); console.log('erreurs page:',errs.length?errs:'aucune','octets',Buffer.from(b64,'base64').length);
  await b.close(); srv.close();
})().catch(e=>{console.error(e);process.exit(1);});
