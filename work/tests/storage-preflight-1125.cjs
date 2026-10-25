const assert=require('assert/strict'),storage=require('../../outputs/ThingsBook/vendor/storage.js');
(async()=>{
assert.equal(storage.plan(100,{quota:1000,usage:200}).available,800);assert.ok(storage.plan(100,{quota:1000,usage:200}).low);assert.equal(storage.plan(100,{quota:1e9,usage:0}).low,false);
for(const estimate of [undefined,{quota:Infinity,usage:0},{quota:0,usage:0},{quota:4,usage:-1},{quota:NaN,usage:2}]){const report=storage.plan(1,estimate);assert.equal(report.available,null);assert.equal(report.low,false)}
assert.equal(storage.plan(1,{quota:10,usage:20}).available,0);assert.ok(Number.isSafeInteger(storage.plan(Number.MAX_VALUE,null).needed));
const sealed={iv:new Uint8Array(12),data:new ArrayBuffer(116)};assert.equal(storage.payload([{meta:sealed,file:sealed}],{salt:new Uint8Array(16),check:sealed,library:sealed}),528);
for(const api of [undefined,{}, {estimate:async()=>{throw Error('denied')}},{estimate:()=>new Promise(()=>{})}]){const result=await storage.inspect(100,{storage:api,timeoutMs:10});assert.equal(result.available,null)}
const result=await storage.inspect(100,{storage:{estimate:async()=>({quota:1e9,usage:4000})}});assert.equal(result.available,1e9-4000);
console.log('PASS: conservative payload budget, valid/invalid quota estimates, unavailable API, rejected probes and bounded timeout.');
})().catch(e=>{console.error(e);process.exitCode=1});
