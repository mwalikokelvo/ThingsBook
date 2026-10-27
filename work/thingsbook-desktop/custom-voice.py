"""Offline narration worker. Only the desktop's private stdin/stdout bridge is used."""
import base64, contextlib, io, json, os, queue, sys, threading, wave
from pathlib import Path
# The embedded Python runtime uses an isolated ._pth file, not the script folder.
sys.path.insert(0,str(Path(__file__).resolve().parent))
from narration_text import prepare_text,load_voices

# Electron writes UTF-8 JSON; Windows pipes otherwise default to cp1252.
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

ROOT=Path(sys.argv[1]).resolve()
voices=load_voices(ROOT/'ready.json')
os.chdir(ROOT/'models')
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
output=sys.stdout
model=None
states={}
# A reader thread takes requests off stdin so a 'cancel' message can stop the current passage
# between audio frames and drop queued ones, without restarting the worker and reloading the model.
cancelled={'upto':0,'ids':set()}
pending=queue.Queue()
def read_requests():
    for raw in sys.stdin:
        try:
            message=json.loads(raw) if len(raw)<=20000 else None
        except Exception:
            message=None
        if isinstance(message,dict) and message.get('mode')=='cancel':
            upto=message.get('upto');ids=message.get('ids')
            if isinstance(upto,int) and upto>cancelled['upto']:cancelled['upto']=upto
            if isinstance(ids,list):cancelled['ids'].update(i for i in ids[:64] if isinstance(i,int))
            continue
        pending.put(raw)
    pending.put(None)
def is_cancelled(request):
    ident=request.get('id')
    return request.get('mode')!='warm' and isinstance(ident,int) and (ident<=cancelled['upto'] or ident in cancelled['ids'])
threading.Thread(target=read_requests,daemon=True).start()
while True:
    line=pending.get()
    if line is None:break
    request=None
    try:
        if len(line)>20000:raise ValueError('Request too large')
        request=json.loads(line)
        if is_cancelled(request):
            cancelled['ids'].discard(request.get('id'))
            output.write(json.dumps({'id':request.get('id'),'error':'cancelled'})+'\n');output.flush()
            continue
        text=request.get('text');voice=request.get('voice');mode=request.get('mode','full')
        if mode not in ('full','stream','warm') or not isinstance(voice,str) or voice not in voices or not isinstance(text,str) or (mode!='warm' and not 0<len(text)<=4000):raise ValueError('Invalid narration request')
        if mode!='warm':text=prepare_text(text,request.get('kind','prose'))
        with contextlib.redirect_stdout(sys.stderr):
            import torch
            from pocket_tts import TTSModel
            # Two threads left most laptops slower than real time; use up to four, keeping half the CPU free.
            torch.set_num_threads(max(1,min(4,(os.cpu_count() or 2)//2)))
            if model is None:
                import yaml
                config=yaml.safe_load((ROOT/'models/config.yaml').read_text())
                def local_only(value):
                    if isinstance(value,dict):return all(local_only(v) for v in value.values())
                    if isinstance(value,list):return all(local_only(v) for v in value)
                    return not isinstance(value,str) or not value.lower().startswith(('https:','http:','hf:'))
                if not local_only(config) or config.get('weights_path')!='model.safetensors' or config['flow_lm']['lookup_table']['tokenizer_path']!='tokenizer.json':raise ValueError('Only local model files are allowed')
                model=TTSModel.load_model(config=ROOT/'models/config.yaml')
            if voice not in states:states[voice]=model.get_state_for_audio_prompt(ROOT/'voices'/f'{voice}.safetensors')
            if mode=='warm':
                output.write(json.dumps({'id':request['id'],'ready':True})+'\n');output.flush()
                continue
            if mode=='stream':
                import numpy as np
                total=0
                for chunk in model.generate_audio_stream(states[voice],text):
                    if is_cancelled(request):break
                    samples=chunk.detach().cpu().numpy()
                    if not np.isfinite(samples).all():raise ValueError('Invalid samples')
                    pcm=(np.clip(samples,-1,1)*32767).astype('<i2').tobytes();total+=len(pcm)
                    if total>16*1024*1024:raise ValueError('Voice output too large')
                    output.write(json.dumps({'id':request['id'],'pcm':base64.b64encode(pcm).decode('ascii'),'rate':model.sample_rate})+'\n');output.flush()
                if is_cancelled(request):
                    cancelled['ids'].discard(request.get('id'))
                    output.write(json.dumps({'id':request['id'],'error':'cancelled'})+'\n');output.flush()
                    continue
                if not total:raise ValueError('Empty voice output')
                output.write(json.dumps({'id':request['id'],'done':True})+'\n');output.flush()
                text=None;request=None;samples=None;pcm=None;chunk=None;line=None
                continue
            samples=model.generate_audio(states[voice],text).detach().cpu().numpy()
        import numpy as np
        if samples.size==0 or not np.isfinite(samples).all():raise ValueError('Invalid voice samples')
        pcm=(np.clip(samples,-1,1)*32767).astype('<i2').tobytes()
        if len(pcm)>16*1024*1024:raise ValueError('Voice output too large')
        stream=io.BytesIO()
        with wave.open(stream,'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(model.sample_rate);wav.writeframes(pcm)
        result={'id':request['id'],'audio':base64.b64encode(stream.getvalue()).decode('ascii')}
    except Exception:
        result={'id':request.get('id') if isinstance(request,dict) else None,'error':'Your local voice pack could not generate this passage. Check the pack setup or choose an installed voice.'}
    output.write(json.dumps(result)+'\n');output.flush()
    text=None;request=None;samples=None;pcm=None;result=None;stream=None;line=None
