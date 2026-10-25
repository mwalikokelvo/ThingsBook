// Real bundled PDF rendering and offline OCR, using only an authored scan.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');process.env.THINGSBOOK_TEST_PROFILE=path.join(root,'work','scan-'+crypto.randomUUID());process.env.THINGSBOOK_TEST_HIDDEN='1';
const timer=setTimeout(()=>app.exit(1),150000);
app.on('browser-window-created',(_e,w)=>{w.webContents.setAudioMuted(true);w.webContents.once('did-finish-load',async()=>{try{
 const result=await w.webContents.executeJavaScript(`(async()=>{
 const q=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m)};
 const canvas=document.createElement('canvas');canvas.width=900;canvas.height=1200;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,900,1200);c.fillStyle='black';c.font='32px Arial';c.fillText('A quiet library welcomes every reader.',60,120);c.fillText('The next page begins a new chapter.',60,180);
 const jpeg=atob(canvas.toDataURL('image/jpeg',.95).split(',')[1]),content='q 600 0 0 800 0 0 cm /Scan Do Q';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>','<< /Type /XObject /Subtype /Image /Width 900 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\\nstream\\n'+jpeg+'\\nendstream','<< /Length '+content.length+' >>\\nstream\\n'+content+'\\nendstream'];
 let pdf='%PDF-1.4\\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\\n'+o+'\\nendobj\\n'});const xref=pdf.length;pdf+='xref\\n0 6\\n0000000000 65535 f \\n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \\n').join('')+'trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n'+xref+'\\n%%EOF';
 const bytes=Uint8Array.from(pdf,c=>c.charCodeAt(0));await ThingsReader.open({id:'synthetic-scan',title:'Authored scan',format:'PDF',progress:{layout:'fitpage',ocr:false,scope:'book'}},new Blob([bytes]),async()=>{});q('reader-dialog').showModal();const s=ThingsReader.context();
 check(q('reader-content').querySelector('canvas'),'Scan did not render');check(!q('reader-content').querySelector('.reader-passage'),'Scan unexpectedly contains text');
 await q('narrator-play').onclick();check(!ThingsReader.isSpeaking()&&s.location===0,'Unrecognized scan advanced or kept playing');check(/Recognize page/.test(q('reader-message').textContent),'Recognition guidance missing');
 const start=performance.now();await q('reader-ocr').onclick();const text=[...q('reader-content').querySelectorAll('.reader-passage')].map(p=>p.textContent).join(' ');check(/quiet library/i.test(text)&&/new chapter/i.test(text),'Offline OCR did not recover authored text');check(!s.ocrError,'OCR returned an error');
 const result={rendered:true,noEmbeddedText:true,scanStopsWithoutRecognition:true,offlineRecognition:true,recognizedCharacters:text.length,recognitionMilliseconds:Math.round(performance.now()-start)};await ThingsReader.close();q('reader-dialog').close();return result;
 })()`);
 fs.writeFileSync(path.join(__dirname,'scanned-runtime-1125.json'),JSON.stringify({version:'1.12.5',...result,reader_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'outputs/ThingsBook/reader.js'))).digest('hex')},null,2));console.log('PASS: authored image-only PDF renders, stops without OCR and recognizes offline.',result.recognitionMilliseconds);clearTimeout(timer);w.destroy();app.exit(0);
 }catch(e){fs.writeFileSync(path.join(__dirname,'scanned-failure-1125.json'),JSON.stringify({error:e.message},null,2));console.error(e);clearTimeout(timer);w.destroy();app.exit(1);}});});
require('../thingsbook-desktop/main.cjs');
