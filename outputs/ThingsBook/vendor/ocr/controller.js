'use strict';
const ThingsOCR = (() => {
  let task = null, scriptPromise;
  const root = new URL('.', new URL('vendor/ocr/controller.js', document.baseURI)).href;
  function engine() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!scriptPromise) scriptPromise = new Promise((resolve,reject) => {
      const script=document.createElement('script');script.src=root+'tesseract.min.js';
      script.onload=()=>resolve(window.Tesseract);script.onerror=()=>{scriptPromise=null;script.remove();reject(new Error('The bundled text recognition engine could not load.'));};document.head.append(script);
    });
    return scriptPromise;
  }
  function cancel() { if(task) task.abort(); }
  async function recognize(canvas, onProgress=()=>{}) {
    cancel();const controller=new AbortController();task=controller;
    let worker, initialization, timeout, rejectAbort;
    const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
    controller.signal.addEventListener('abort',()=>rejectAbort(new Error(controller.signal.reason==='timeout'?'Text recognition took too long. Try again with a clearer scan.':'Text recognition cancelled.')),{once:true});
    timeout=setTimeout(()=>controller.abort('timeout'),90000);
    try {
      onProgress('Preparing offline English text recognition…');
      const api=await Promise.race([engine(),aborted]);
      initialization=api.createWorker('eng',1,{workerPath:root+'worker.min.js',corePath:root,langPath:root.replace(/\/$/,''),cacheMethod:'none',gzip:true,workerBlobURL:true,errorHandler:()=>{},logger:message=>{if(!controller.signal.aborted&&message.status==='recognizing text')onProgress('Recognizing this page on your device… '+Math.round(message.progress*100)+'%');}});
      worker=await Promise.race([initialization,aborted]);
      await Promise.race([worker.setParameters({tessedit_pageseg_mode:'3',user_defined_dpi:'150'}),aborted]);
      const result=await Promise.race([worker.recognize(canvas),aborted]);
      return {text:String(result.data.text||'').trim(),confidence:Number(result.data.confidence)||0};
    } finally {
      clearTimeout(timeout);if(task===controller)task=null;
      if(worker)await worker.terminate();
      else if(initialization)initialization.then(value=>value.terminate(),()=>{});
    }
  }
  return {recognize,cancel};
})();

window.ThingsOCR = ThingsOCR;
