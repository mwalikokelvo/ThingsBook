from pathlib import Path
import shutil,json
root=Path(__file__).resolve().parents[1];app=root/'outputs/ThingsBook';desktop=root/'work/thingsbook-desktop';web=desktop/'web'
web.mkdir(exist_ok=True)
for name in ('index.html','style.css','reader.css','reader.js','app.js','pdf.worker.mjs','vendor','cmaps','standard_fonts','wasm'):
 src=app/name;dst=web/name
 if src.is_dir():shutil.copytree(src,dst,dirs_exist_ok=True)
 else:shutil.copyfile(src,dst)
shutil.copyfile(app/'windows/icon.ico',desktop/'icon.ico')
p=web/'app.js';s=p.read_text(encoding='utf-8')
s=s.replace("  $('unlock-form').addEventListener('submit',unlock);", "  if(window.ThingsBookDesktop){const transfer=el('p','fine','Moving from the previous app? Restore your encrypted backup below. This desktop app has its own private storage.');$('gate-description').after(transfer);window.ThingsBookDesktop.onClose(async function finishClose(){if(busy){setTimeout(finishClose,200);return;}busy=true;try{await closeReader();await metadataQueue;window.ThingsBookDesktop.closeReady();}catch{toast('Could not save your position. Check free space, then try closing again.');}finally{busy=false;}});}\n  $('unlock-form').addEventListener('submit',unlock);")
p.write_text(s,encoding='utf-8')
version=json.loads((desktop/'package.json').read_text())['version']
p=web/'index.html';s=p.read_text(encoding='utf-8').replace('ThingsBook '+version,'ThingsBook Desktop '+version);p.write_text(s,encoding='utf-8')
