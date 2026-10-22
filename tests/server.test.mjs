import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { collect, report, isOwner, ensureOpenJar } from '../server.mjs';
const config = { revision: 'test-v1', sections: ['hero','how'], targets: ['waitlist'] };
const view = '1383a5b2-78b9-4f4e-a03e-8423c783410e';
const event = (sequence, kind = 'view', section = 'page', x = 0, y = 0, target = '') => ({ sequence, kind, section, x, y, target });
function fixture(t) {
 const db = new DatabaseSync(':memory:'); t.after(()=>db.close());
 const statement = (sql, values=[]) => ({bind:(...v)=>statement(sql,v),run:async()=>db.prepare(sql).run(...values),first:async()=>db.prepare(sql).get(...values)||null,all:async()=>({results:db.prepare(sql).all(...values)})});
 const DB = {prepare:sql=>statement(sql),batch:async entries=>{ db.exec('BEGIN');try{const out=[];for(const e of entries)out.push(await e.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
 return {db,DB};
}
function request(body, extra={}) { return new Request('https://example.test/api/openjar/collect',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json',...extra},body:JSON.stringify(body)}); }
const batch = events => ({view,revision:'test-v1',device:'desktop',events});

test('real SQLite: delivery, deduplication, aggregation, device separation, and retention',async t=>{
 const {db,DB}=fixture(t);
 const body=batch([event(0),event(1,'click','hero',12,42,'waitlist'),event(2,'action','hero',0,0,'waitlist'),event(3,'scroll','page',0,50),event(4,'reach','hero')]);
 assert.equal((await collect(request(body),DB,config)).status,204);
 assert.equal((await collect(request(body),DB,config)).status,204);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM openjar_events').get().n,5);
 const url = 'https://example.test/api/openjar/report?device=desktop&days=7';
 const result=await (await report(new Request(url),DB,config)).json();
 assert.equal(result.views,1);assert.deepEqual(result.clicks,[{section:'hero',x:12,y:42,count:1}]);
 assert.equal(result.actions[0].count,2); assert.equal(result.depth[0].depth,50);assert.equal(result.reach[0].count,1);
 assert.equal((await (await report(new Request(url.replace('desktop','mobile')),DB,config)).json()).views,0);
 db.exec("UPDATE openjar_events SET day='2020-01-01'");
 await collect(request(batch([event(5,'click','how',2,3)])),DB,config);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM openjar_events').get().n,1);
 assert.deepEqual(db.prepare('PRAGMA table_info(openjar_events)').all().map(r=>r.name),['view_id','sequence','revision','device','kind','section','x','y','target','day']);
});

test('rejects personal content, unknown values, arbitrary paths, invalid coordinates, and excessive batches before storage',async t=>{
 const {DB,db}=fixture(t);
 const valid=batch([event(0)]);
 const invalid=[{...valid,email:'secret@example.test'}, {...valid,view:'email@example.test'}, {...valid,revision:'/private?email=x'}, {...valid,events:[{...event(0),text:'secret'}]}, batch([event(1,'click','hero',-1,0)]),batch([event(1,'click','hero',0,100)]),batch([event(1,'click','hero',1,1,'secret@example.test')]),batch([event(1,'click','private',1,1)]),batch([event(200)]),batch(Array(21).fill(event(0))),{...valid,events:null},null];
 for(const body of invalid) assert.equal((await collect(request(body),DB,config)).status,400);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n,0);
 assert.equal((await collect(request(valid,{origin:'https://evil.test'}),DB,config)).status,403);
 assert.equal((await collect(request(valid,{'content-type':'text/plain'}),DB,config)).status,415);
 assert.equal((await collect(request({...valid,junk:'x'.repeat(9000)}),DB,config)).status,413);
 assert.equal((await collect(new Request('https://example.test/api/openjar/collect'),DB,config)).status,405);
});

test('empty report is honest and unavailable storage cannot report a successful collection',async t=>{
 const {DB}=fixture(t);const result=await (await report(new Request('https://example.test/report'),DB,config)).json();
 assert.equal(result.views,0);assert.deepEqual(result.clicks,[]);
 assert.equal((await collect(request(batch([event(0)])),null,config)).status,503);
 const broken={prepare:()=>{throw Error('secret database failure');}};
 const response=await collect(request(batch([event(0)])),broken,config);
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret/);
});

test('owner authorization fails closed without configured owner, authenticated identity, or matching email',()=>{
 const req = (id,email)=>new Request('https://example.test/report',{headers:{'oai-authenticated-user-id':id,'oai-authenticated-user-email':email}});
 assert.equal(isOwner(req('owner','OWNER@example.test'),{OPENJAR_OWNER_EMAIL:'owner@example.test'}),true);
 assert.equal(isOwner(req('','owner@example.test'),{OPENJAR_OWNER_EMAIL:'owner@example.test'}),false);
 assert.equal(isOwner(req('other','other@example.test'),{OPENJAR_OWNER_EMAIL:'owner@example.test'}),false);
 assert.equal(isOwner(req('owner','owner@example.test'),{}),false);
});
