'use strict';
// Advisory quota estimates only; IndexedDB transactions remain authoritative.
const ThingsStorage=(()=>{
 const reserve=2*1024*1024;
 const bytes=value=>Number.isFinite(value)&&value>=0?value:0;
 function payload(records,config){let total=bytes(config?.salt?.byteLength);for(const record of [config?.check,config?.library,config?.recovery,...records.flatMap(item=>[item.meta,item.file,...(item.parts||[])])])if(record)total+=bytes(record.iv?.byteLength)+bytes(record.data?.byteLength??record.size);return total;}
 function plan(value,estimate){const needed=Math.min(Number.MAX_SAFE_INTEGER,Math.ceil(bytes(value)*1.1)+reserve);const known=Number.isFinite(estimate?.quota)&&estimate.quota>0&&Number.isFinite(estimate?.usage)&&estimate.usage>=0;const available=known?Math.max(0,estimate.quota-estimate.usage):null;return {needed,available,usage:known?estimate.usage:null,quota:known?estimate.quota:null,low:known&&available<needed};}
 async function inspect(value,{storage=globalThis.navigator?.storage,timeoutMs=1500}={}){
  let timer;try{const estimate=await Promise.race([Promise.resolve().then(()=>storage?.estimate?.()),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),Math.max(1,Math.min(1500,timeoutMs)));})]);return plan(value,estimate);}catch{return plan(value,null);}finally{clearTimeout(timer);}
 }
 return Object.freeze({payload,plan,inspect});
})();
if(typeof module!=='undefined')module.exports=ThingsStorage;
