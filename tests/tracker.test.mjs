import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { startOpenJar } from '../tracker.mjs';
function fixture(overrides={}) {
 const document = new EventTarget();const win = new EventTarget();const sent=[];
 Object.assign(document,{readyState:'complete',visibilityState:'visible',documentElement:{scrollHeight:2000},querySelector:()=>({getBoundingClientRect:()=>({top:0,bottom:500,width:1000,height:500,left:0})})});
 Object.assign(win,{document,crypto:webcrypto,navigator:{},location:{search:''},innerWidth:1280,innerHeight:900,scrollY:0,
 fetch:async(url,options)=>{sent.push(JSON.parse(options.body));return new Response(null,{status:204});},setInterval:()=>1,clearInterval:()=>{},requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame:()=>{},...overrides});
 win.self=win;win.top=overrides.top||win;
 const start=()=>startOpenJar({revision:'test-v1',sections:['hero'],targets:['waitlist'],window:win});
 const click=(element,detail=1)=>{const ev=new Event('click');Object.defineProperties(ev,{target:{value:element},detail:{value:detail},clientX:{value:100},clientY:{value:200}});document.dispatchEvent(ev);};
 return {win,document,sent,start,click};
}
test('privacy signals, embedded previews, and explicit optout prevent every network request',()=>{
 for(const opts of [{navigator:{doNotTrack:'1'}},{navigator:{globalPrivacyControl:true}},{location:{search:'?openjar_optout'}},{top:{}}]) {
  const f=fixture(opts);f.start()();assert.equal(f.sent.length,0);
 }
});
test('captures bounded section coordinates and named actions without reading inputs or text',()=>{
 const f=fixture(); const stop=f.start();
 const region={dataset:{openjarSection:'hero'},getBoundingClientRect:()=>({top:0,left:0,width:1000,height:500})};
 const element={get value(){throw Error('never read input');},get textContent(){throw Error('never read text');},closest:selector=>selector==='*'?element:selector==='[data-openjar-section]'?region:selector==='[data-openjar-target]'?{dataset:{openjarTarget:'waitlist'}}:null};
 f.click(element);f.click(element,0);
 const input={get value(){throw Error('must not read email');},closest:selector=>selector==='*'?input:selector.startsWith('input')?input:null};f.click(input);
 f.win.dispatchEvent(new Event('pagehide'));stop();
 const events=f.sent.flatMap(batch=>batch.events);
 assert.equal(events.filter(e=>e.kind==='view').length,1);
 assert.deepEqual(events.filter(e=>e.kind==='click').map(({x,y,target})=>({x,y,target})),[{x:5,y:40,target:'waitlist'}]);
 assert.equal(events.filter(e=>e.kind==='action').length,1);
 assert.equal(events.some(e=>'email' in e||'text' in e),false);
 const before=f.sent.length;f.click(element);f.win.dispatchEvent(new Event('pagehide'));assert.equal(f.sent.length,before);
});
test('queue batches and page budget remain bounded during repeated clicks',()=>{
 const f=fixture();const stop=f.start();const region={dataset:{openjarSection:'hero'},getBoundingClientRect:()=>({top:0,left:0,width:1000,height:500})};
 const el={closest:s=>s==='*'?el:s==='[data-openjar-section]'?region:null};
 for(let i=0;i<400;i++)f.click(el);stop();
 assert.ok(f.sent.every(b=>b.events.length<=20));assert.equal(f.sent.flatMap(b=>b.events).length,200);
});
