const {app,BrowserWindow,session}=require('electron');
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'../..');
app.setPath('userData',path.join(root,'work','pdf-import-profile-'+Date.now()));
const report={version:'1.12.5',network:[],errors:[]};let w;
const timer=setTimeout(()=>app.exit(1),90000);
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,done)=>{report.network.push(d.url);done({cancel:true})});
 w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await w.loadFile(path.join(root,'outputs/ThingsBook/index.html'));
 report.result=await w.webContents.executeJavaScript(`(async()=>{
 const check=(v,m)=>{if(!v)throw new Error(m)};
 await new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(typeof db!=='undefined'&&db){clearInterval(t);resolve()}else if(++n>500){clearInterval(t);reject(Error('db timeout'))}},30)});
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',null,'<< /Title (Private PDF) /Author (Ada Local) /CreationDate (D:20240201) >>'];
 const content='0.2 0.5 0.3 rg 0 0 300 400 re f BT /F1 20 Tf 1 1 1 rg 20 300 Td (Local PDF cover) Tj ET';objects[4]='<< /Length '+content.length+' >>\\nstream\\n'+content+'\\nendstream';
 let pdf='%PDF-1.4\\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\\n'+o+'\\nendobj\\n'});const xref=pdf.length;pdf+='xref\\n0 7\\n0000000000 65535 f \\n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \\n').join('')+'trailer\\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\\nstartxref\\n'+xref+'\\n%%EOF';
 const bytes=new TextEncoder().encode(pdf),copy=bytes.slice();const details=await ThingsImport.pdf(bytes);
 check(details.title==='Private PDF'&&details.author==='Ada Local'&&details.year===2024&&details.pages===1,'metadata '+JSON.stringify(details));check(details.cover?.startsWith('data:image/jpeg;base64,'),'JPEG cover');check(bytes.every((v,i)=>v===copy[i]),'source bytes changed');
 document.getElementById('password').value='Synthetic-private-test';document.getElementById('confirm-password').value='Synthetic-private-test';await unlock({preventDefault(){}});
 const files=()=>{const t=new DataTransfer();t.items.add(new File([bytes],'filename.pdf',{type:'application/pdf'}));document.getElementById('book-files').files=t.files};
 files();await upload({preventDefault(){}});check(books[0].title===details.title&&books[0].cover===details.cover&&books[0].pages===1,'encrypted import');
 const record=await getRecord(books[0].id);check(!new TextDecoder().decode(record.meta.data).includes('Private PDF'),'plaintext metadata');check((await readJSON(record.meta)).cover===details.cover,'stored cover');
 files();document.getElementById('book-title').value='My title';document.getElementById('book-author').value='My author';await upload({preventDefault(){}});check(books[1].title==='My title'&&books[1].author==='My author','manual override');
 showDetail(books[1].id);let detail=document.getElementById('book-detail');await [...detail.querySelectorAll('button')].find(b=>b.textContent==='Read embedded book details').onclick();check(detail.querySelector('input').value==='Private PDF'&&books[1].title==='My title','autofill preview');await detail.querySelector('form').onsubmit({preventDefault(){}});check(books[1].title==='Private PDF','explicit save');
 await readBook(books[0].id);check(document.getElementById('reader-content').querySelector('canvas'),'PDF reader rendering');await closeReader();
 return {metadata:true,cover:true,encryptedStorage:true,originalBytes:true,manualOverride:true,existingAutofill:true,reader:true};
 })()`);
 if(report.network.length)throw new Error('Unexpected network');
 fs.writeFileSync(path.join(__dirname,'pdf-import-1125.json'),JSON.stringify(report,null,2));clearTimeout(timer);app.quit();
}).catch(e=>{report.errors.push(String(e.stack||e));fs.writeFileSync(path.join(__dirname,'pdf-import-1125.json'),JSON.stringify(report,null,2));clearTimeout(timer);app.exit(1)});
