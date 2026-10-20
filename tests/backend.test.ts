import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {PARAMETERS} from '../server/parameters';
import {classify} from '../server/classifier';
import {extractBaseline,buildHypotheses,validateObservations} from '../server/inference';
import {handleApi} from '../server/api';
import {callProvider} from '../server/provider';
import {collectExport} from '../lib/export-data';
const requestLogs:string[]=[];
console.info=(value:unknown)=>{requestLogs.push(String(value));};
const fixtures=JSON.parse(readFileSync(new URL('../ai/models/parity-fixtures.json',import.meta.url),'utf8'));
class Statement{
 constructor(private db:DatabaseSync,private sql:string,private args:any[]=[]){ }
 bind(...args:any[]){return new Statement(this.db,this.sql,args);}
 async all(){const result=this.db.prepare(this.sql).all(...this.args);return {results:result,success:true};}
 async first(){return this.db.prepare(this.sql).get(...this.args)||null;}
 async run(){const result=this.db.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:result.changes}};}
}
class TestD1{
 db=new DatabaseSync(':memory:');
 constructor(){this.db.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())this.db.exec(readFileSync('drizzle/'+file,'utf8'));}
 prepare(sql:string){return new Statement(this.db,sql);}
 async batch(statements:Statement[]){this.db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());this.db.exec('COMMIT');return results;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
function setup(){const db=new TestD1();const env:any={DB:db,USAGE_HASH_KEY:'unit-test-usage-secret-at-least-32-characters',OPS_TOKEN:'unit-test-operator-secret-at-least-32-characters'};const req=async(path:string,user='alice',method='GET',payload?:any,origin='https://humanos.test')=>{
 const headers:any={'content-type':'application/json',origin};if(user)headers['oai-authenticated-user-id']=user;
 if(path==='export'&&method==='GET'&&user){const check=await handleApi(new Request('https://humanos.test/api/export',{headers}),env);if(check.ok){const file=await collectExport(url=>handleApi(new Request('https://humanos.test'+url,{headers}),env));return {status:200,body:JSON.parse(await file.text())};}return {status:check.status,body:await check.json() as any};}
 const r=await handleApi(new Request('https://humanos.test/api/'+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)}),env);
 return {status:r.status,body:await r.json() as any};};return {db,env,req};}
async function consent(req:any,user='alice'){assert.equal((await req('consent',user,'POST',{accept:true})).status,200);}
const send=(req:any,text:string,user='alice',requestId=crypto.randomUUID())=>req('messages',user,'POST',{text,requestId});
test('catalog has 50 unique parameters across five groups; no guessed hormone values',()=>{assert.equal(PARAMETERS.length,50);assert.equal(new Set(PARAMETERS.map(p=>p.id)).size,50);assert.equal(new Set(PARAMETERS.map(p=>p.group)).size,5);assert.ok(!PARAMETERS.some(p=>/cortisol|dopamine|serotonin/i.test(p.id)));});
test('JS model inference matches independently exported scikit-learn probabilities',()=>{for(const f of fixtures){const results=classify(f.text);for(const p of results)assert.ok(Math.abs(p.score-f.scores[p.label])<.00003,`${f.text} ${p.label}`);}});
test('baseline abstains on another person, a novel, quotations, and hypothetical speech',()=>{for(const text of ['My friend is lonely and I am telling his story.','In this novel I am an anxious character.','What if I was lonely?','I read “I am lonely” in a book.'])assert.equal(extractBaseline(text).observations.length,0,text);});
test('negation is counter-evidence and past feelings stay historical',()=>{const a=extractBaseline('I am not lonely now.');assert.equal(a.observations.find(o=>o.parameterId==='loneliness')?.direction,'counter');const b=extractBaseline('I used to feel lonely in college.');assert.equal(b.observations.find(o=>o.parameterId==='loneliness')?.timeframe,'past');});
test('extracts personal memories and preserves exact source text',()=>{const t='I miss dancing with my college friends.';const o=extractBaseline(t).observations;assert.ok(o.some(o=>o.parameterId==='recent_dance'));assert.ok(o.some(o=>o.parameterId==='nostalgia'));assert.ok(o.every(o=>t.includes(o.quote)));});
test('provider observations reject invented evidence, unknown parameters, and invented intensity',()=>{const text='I am feeling anxious.';const o={parameterId:'anxiety',quote:text,value:'Anxiety expressed',direction:'support',scope:'general',timeframe:'current',intensity:9};assert.equal(validateObservations([o],text)[0].intensity,null);assert.equal(validateObservations([{...o,quote:'Not in the message'}],text).length,0);assert.equal(validateObservations([{...o,parameterId:'cortisol'}],text).length,0);assert.equal(validateObservations([{...o,quote:'My friend is anxious.'}],'My friend is anxious.').length,0);});
test('unknown parameters stay unknown; decay does not change historical events into present traits',()=>{const rows=[{id:'o1',parameter_id:'sadness',scope:'general',quote:'I used to be sad.',value:'Past sadness',direction:'support',timeframe:'past',source:'explicit',episode_key:'one',created_at:'2020-01-01T00:00:00Z',retracted:0}];const h=buildHypotheses(rows);assert.equal(h[0].status,'historical');assert.equal(h[0].kind,'state');assert.equal(h.length,1);});
test('public catalog/health work while private endpoints require sign-in',async()=>{const {req}=setup();assert.equal((await req('catalog','')).body.parameters.length,50);assert.equal((await req('health','')).status,200);for(const path of ['me','export'])assert.equal((await req(path,'')).status,401);assert.equal((await send(req,'I am happy.','')).status,401);});
test('storage requires consent and cross-origin writes are rejected',async()=>{const {req}=setup();assert.equal((await send(req,'I feel sad.')).status,403);assert.equal((await req('consent','alice','POST',{accept:true},'https://attacker.test')).status,403);await consent(req);assert.equal((await req('me')).body.parameters.filter((p:any)=>p.estimate).length,0);});
test('conversation persists messages, evidence, hypotheses and revisions; retry is idempotent',async()=>{const {req}=setup();await consent(req);const requestId=crypto.randomUUID();assert.equal((await send(req,'I feel anxious about work.', 'alice',requestId)).status,200);assert.equal((await send(req,'I feel anxious about work.', 'alice',requestId)).body.replayed,true);const s=(await req('me')).body;assert.equal(s.messages.length,2);assert.ok(s.observations.some((o:any)=>o.parameter_id==='anxiety'));assert.ok(s.hypotheses.some((h:any)=>h.parameter_id==='anxiety'));assert.equal(s.revisions.length,1);assert.equal(s.profile.active_request,undefined);});
test('duplicate source messages do not accumulate independent evidence',async()=>{const {req}=setup();await consent(req);await send(req,'I feel lonely.');await send(req,'I feel lonely.');const s=(await req('me')).body;assert.equal(s.observations.filter((o:any)=>o.parameter_id==='loneliness').length,1);});
test('users cannot read, correct, export, or delete another person’s records',async()=>{const {req}=setup();await consent(req);await consent(req,'bob');await send(req,'I feel lonely today.');const a=(await req('me')).body;const b=(await req('me','bob')).body;assert.equal(b.messages.length,0);assert.equal(b.hypotheses.length,0);assert.equal((await req('feedback','bob','POST',{hypothesisId:a.hypotheses[0].id,kind:'wrong',note:'x'})).status,404);assert.equal((await req('export','bob')).body.messages.length,0);await req('data','bob','DELETE',{confirm:'DELETE MY DATA'});assert.equal((await req('me')).body.messages.length,2);});
test('counter-evidence disputes earlier claims and contexts stay separate',async()=>{const {req}=setup();await consent(req);await send(req,'I feel lonely at work.');await new Promise(r=>setTimeout(r,3));await send(req,'I am not lonely at work.');await send(req,'I feel lonely with my family.');const s=(await req('me')).body;assert.equal(s.hypotheses.find((h:any)=>h.parameter_id==='loneliness'&&h.scope==='work').status,'disputed');assert.equal(s.hypotheses.find((h:any)=>h.parameter_id==='loneliness'&&h.scope==='family').status,'candidate');});
test('wrong interpretation and user change create different durable revision events',async()=>{const {req}=setup();await consent(req);await send(req,'I feel lonely and anxious.');let s=(await req('me')).body;const first=s.hypotheses.find((h:any)=>h.parameter_id==='loneliness');assert.equal((await req('feedback','alice','POST',{hypothesisId:first.id,kind:'wrong',note:'This was an interpretation error.'})).status,200);s=(await req('me')).body;assert.ok(!s.hypotheses.some((h:any)=>h.id===first.id));const second=s.hypotheses.find((h:any)=>h.parameter_id==='anxiety');await req('feedback','alice','POST',{hypothesisId:second.id,kind:'changed',note:'Things are different now.'});s=(await req('me')).body;assert.ok(s.revisions.some((r:any)=>r.kind==='correction'));assert.ok(s.revisions.some((r:any)=>r.kind==='change'));});
test('confirmations persist across unrelated turns',async()=>{const {req}=setup();await consent(req);await send(req,'I feel lonely.');const h=(await req('me')).body.hypotheses[0];await req('feedback','alice','POST',{hypothesisId:h.id,kind:'confirm',note:''});await send(req,'I got good news about my project.');const current=(await req('me')).body.hypotheses.find((x:any)=>x.id===h.id);assert.equal(current.evidence_strength,'user_confirmed');});
test('deleting data removes all active records, including derived hypotheses and quotas',async()=>{const {req,db}=setup();await consent(req);await send(req,'I feel sad.');assert.equal((await req('data','alice','DELETE',{confirm:'WRONG'})).status,400);assert.equal((await req('data','alice','DELETE',{confirm:'DELETE MY DATA'})).status,200);for(const table of ['profiles','messages','observations','hypotheses','feedback','revisions','quotas'])assert.equal((db.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`).get('alice') as any).n,0);});
test('active turn lock prevents conflicting updates and daily quota is enforced',async()=>{const {req,db}=setup();await consent(req);db.db.prepare('UPDATE profiles SET active_request=?,locked_at=? WHERE user_id=?').run('other',new Date().toISOString(),'alice');assert.equal((await send(req,'I feel sad.')).status,409);db.db.prepare('UPDATE profiles SET active_request=NULL WHERE user_id=?').run('alice');db.db.prepare('INSERT INTO quotas(user_id,day,count) VALUES(?,?,80)').run('alice',new Date().toISOString().slice(0,10));assert.equal((await send(req,'I feel sad.')).status,429);assert.equal((await req('me')).body.messages.length,0);});
test('external provider is opt-in and structured output is validated before persistence',async()=>{const {req,env}=setup();env.GEMINI_API_KEY='unit-test-key';env.GEMINI_MODEL='test-model';await consent(req);assert.equal((await req('me')).body.profile.llm_consent,0);const mock:any=async(url:string,options:any)=>{assert.match(url,/generativelanguage.googleapis.com/);const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({reply:'Let’s take it one step at a time.',observations:[{parameterId:'anxiety',quote:'I feel anxious.',value:'Anxiety expressed',direction:'support',scope:'general',timeframe:'current',intensity:null},{parameterId:'cortisol',quote:'I feel anxious.',value:'High cortisol',direction:'support',scope:'general',timeframe:'current',intensity:9}]})}]}}]});};const r=await callProvider(env,'I feel anxious.',[],[],mock);assert.equal(r.observations.length,1);assert.equal(r.observations[0].parameterId,'anxiety');});
test('provider failure produces a visibly labeled local ML fallback',async()=>{const {req,env}=setup();env.GEMINI_API_KEY='unit-test-key';env.GEMINI_MODEL='test-model';await consent(req);await req('provider-consent','alice','POST',{enabled:true});const r=await handleApi(new Request('https://humanos.test/api/messages',{method:'POST',headers:{origin:'https://humanos.test','content-type':'application/json','oai-authenticated-user-id':'alice'},body:JSON.stringify({text:'I feel anxious.',requestId:crypto.randomUUID()})}),env,async()=>new Response('',{status:503}));assert.equal(r.status,200);const s=(await req('me')).body;assert.match(s.messages[1].model,/goemotions/);assert.equal(s.messages[1].trace.warnings.length,1);});
test('Groq strict structured output uses the matching provider and validates evidence',async()=>{
 const {providerInfo}=await import('../server/provider');const env={AI_PROVIDER:'groq',GROQ_API_KEY:'unit-test-key',GROQ_MODEL:'openai/gpt-oss-20b'};
 assert.deepEqual(providerInfo(env),{id:'groq',name:'Groq',model:'openai/gpt-oss-20b'});
 const mock:any=async(url:string,options:any)=>{assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(options.headers.authorization,'Bearer unit-test-key');const request=JSON.parse(options.body);assert.equal(request.response_format.json_schema.strict,true);assert.equal(request.response_format.json_schema.schema.additionalProperties,false);assert.equal(request.response_format.json_schema.schema.properties.observations.items.additionalProperties,false);return Response.json({choices:[{message:{content:JSON.stringify({reply:'We can take that presentation one step at a time.',observations:[{parameterId:'anxiety',quote:'I feel anxious.',value:'Anxiety expressed',direction:'support',scope:'work',timeframe:'current',intensity:null}]})}}]});};
 const result=await callProvider(env,'I feel anxious.',[],[],mock);assert.equal(result.model,'groq:openai/gpt-oss-20b');assert.equal(result.observations.length,1);
});
test('unknown provider does not send the key to another service',async()=>{let called=false;await assert.rejects(()=>callProvider({AI_PROVIDER:'xai',GROQ_API_KEY:'unit-test-key',GROQ_MODEL:'a-model'},'Hi',[],[],async()=>{called=true;return Response.json({});}),/provider_not_configured/);assert.equal(called,false);});
test('Groq does not receive user data until the user opts in',async()=>{
 const {req,env}=setup();Object.assign(env,{AI_PROVIDER:'groq',GROQ_API_KEY:'unit-test-key',GROQ_MODEL:'openai/gpt-oss-20b'});await consent(req);let called=false;
 const response=await handleApi(new Request('https://humanos.test/api/messages',{method:'POST',headers:{origin:'https://humanos.test','content-type':'application/json','oai-authenticated-user-id':'alice'},body:JSON.stringify({text:'I feel anxious.',requestId:crypto.randomUUID()})}),env,async()=>{called=true;return Response.json({});});assert.equal(response.status,200);assert.equal(called,false);assert.equal((await req('catalog','')).body.provider.name,'Groq');
});

function seedMessages(db:TestD1,user:string,count:number){
 const statement=db.db.prepare('INSERT INTO messages(id,user_id,request_id,role,content,model,trace,created_at) VALUES(?,?,?,?,?,?,?,?)');
 db.db.exec('BEGIN');for(let i=0;i<count;i++)statement.run(`seed-${user}-${String(i).padStart(6,'0')}`,user,`request-${i}`,'user',`Private seeded message ${i}`,'user','{}','2026-10-20T00:00:00.000Z');db.db.exec('COMMIT');
}
test('history uses stable keyset pagination for tied timestamps and never crosses accounts',async()=>{
 const {req,db}=setup();await consent(req);await consent(req,'bob');seedMessages(db,'alice',105);seedMessages(db,'bob',9);
 const state=(await req('me')).body;assert.equal(state.messages.length,40);let cursor=state.messageCursor;const ids=state.messages.map((m:any)=>m.id);
 while(cursor){const page=(await req('messages?before='+encodeURIComponent(cursor))).body;ids.push(...page.messages.map((m:any)=>m.id));cursor=page.nextCursor;}
 assert.equal(ids.length,105);assert.equal(new Set(ids).size,105);assert.ok(ids.every((v:string)=>v.includes('alice')));
 assert.equal((await req('messages?before=garbage')).status,400);
 assert.equal((await req('messages','bob')).body.messages.length,9);
});
test('complete export paginates beyond 10000 records without a table cutoff',async()=>{
 const {req,db}=setup();await consent(req);seedMessages(db,'alice',10005);
 const result=await req('export');assert.equal(result.body.version,4);assert.equal(result.body.complete,true);assert.equal(result.body.messages.length,10005);
 assert.equal(result.body.profiles[0].active_request,undefined);assert.equal((db.db.prepare('SELECT active_request FROM profiles').get() as any).active_request,null);
});
test('exports detect concurrent changes instead of producing mixed revisions',async()=>{
 const {req,env}=setup();await consent(req);let changed=false;
 await assert.rejects(()=>collectExport(async url=>{if(url.includes('table=messages')&&!changed){changed=true;await send(req,'I feel happy.');}return handleApi(new Request('https://humanos.test'+url,{headers:{'oai-authenticated-user-id':'alice'}}),env);}),/changed during export/);
});
test('paused memory refuses conversation but preserves reads, export and resume',async()=>{
 const {req}=setup();await consent(req);await send(req,'I feel calm.');assert.equal((await req('memory','alice','POST',{paused:true})).status,200);
 assert.equal((await send(req,'I feel lonely.')).status,403);assert.equal((await req('me')).body.messages.length,2);assert.equal((await req('export')).body.messages.length,2);
 await req('memory','alice','POST',{paused:false});assert.equal((await send(req,'I feel happy.')).status,200);
});
test('burst limits persist atomically and retries of completed requests consume no extra allowance',async()=>{
 const {req,env}=setup();env.USER_MINUTE_MESSAGE_LIMIT='2';await consent(req);const requestId=crypto.randomUUID();
 assert.equal((await send(req,'I feel calm.','alice',requestId)).status,200);assert.equal((await send(req,'I feel calm.','alice',requestId)).body.replayed,true);
 assert.equal((await send(req,'I feel happy.')).status,200);assert.equal((await send(req,'I feel sad.')).status,429);
});
test('deleting and re-enabling memory cannot reset the daily allowance',async()=>{
 const {req,env,db}=setup();env.USER_DAILY_MESSAGE_LIMIT='2';await consent(req);await send(req,'I feel calm.');await send(req,'I feel happy.');
 await req('data','alice','DELETE',{confirm:'DELETE MY DATA'});await consent(req);
 assert.equal((await send(req,'I feel sad.')).status,429);assert.equal((await req('me')).body.usage.used,2);
 const keys=db.db.prepare('SELECT id FROM usage_buckets').all().map((r:any)=>r.id);assert.ok(keys.every((key:string)=>!key.includes('alice')));
});
test('shared AI request and token budgets prevent calls while preserving a labeled local fallback',async()=>{
 const {req,env}=setup();Object.assign(env,{AI_PROVIDER:'groq',GROQ_API_KEY:'test-key',GROQ_MODEL:'test',AI_DAILY_REQUEST_LIMIT:'1'});await consent(req);await req('provider-consent','alice','POST',{enabled:true});let calls=0;
 const mock:any=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({reply:'A useful response.',observations:[]})}}]});};
 const request=()=>new Request('https://humanos.test/api/messages',{method:'POST',headers:{origin:'https://humanos.test','content-type':'application/json','oai-authenticated-user-id':'alice'},body:JSON.stringify({text:'I feel calm.',requestId:crypto.randomUUID()})});
 await handleApi(request(),env,mock);await handleApi(request(),env,mock);assert.equal(calls,1);assert.ok((await req('me')).body.messages.at(-1).trace.warnings[0].includes('shared usage limit'));
 env.AI_DAILY_TOKEN_BUDGET='1';await handleApi(request(),env,mock);assert.equal(calls,1);
});
test('provider failures open the circuit and the kill switch prevents outbound requests',async()=>{
 const {req,env}=setup();Object.assign(env,{AI_PROVIDER:'groq',GROQ_API_KEY:'test-key',GROQ_MODEL:'test'});await consent(req);await req('provider-consent','alice','POST',{enabled:true});let calls=0;
 const request=()=>new Request('https://humanos.test/api/messages',{method:'POST',headers:{origin:'https://humanos.test','content-type':'application/json','oai-authenticated-user-id':'alice'},body:JSON.stringify({text:'I feel calm.',requestId:crypto.randomUUID()})});
 const mock:any=async()=>{calls++;return new Response('',{status:503});};
 for(let i=0;i<4;i++)await handleApi(request(),env,mock);assert.equal(calls,3);
 env.AI_ENABLED='false';await handleApi(request(),env,mock);assert.equal(calls,3);assert.equal((await req('catalog','')).body.providerConfigured,false);
});
test('malformed JSON, oversized multibyte bodies and unsupported methods fail safely',async()=>{
 const {req,env}=setup();for(const payload of [null,[],1,'string'])assert.equal((await req('consent','alice','POST',payload)).status,400);
 const request=new Request('https://humanos.test/api/consent',{method:'POST',headers:{origin:'https://humanos.test','content-type':'application/json','oai-authenticated-user-id':'alice'},body:JSON.stringify({text:'🙂'.repeat(4000)})});assert.equal((await handleApi(request,env)).status,413);
 assert.equal((await req('health','','POST',{})).status,405);assert.equal((await req('export','alice','POST',{})).status,405);
 const crossSite=await handleApi(new Request('https://humanos.test/api/me',{headers:{'oai-authenticated-user-id':'alice','sec-fetch-site':'cross-site'}}),env);assert.equal(crossSite.status,403);
});
test('operator metrics require a separate secret and contain no conversation or identity',async()=>{
 const {req,env}=setup();await consent(req);await send(req,'My private secret sentence is here.');assert.equal((await req('ops/metrics')).status,401);
 const response=await handleApi(new Request('https://humanos.test/api/ops/metrics',{headers:{authorization:'Bearer '+env.OPS_TOKEN}}),env);assert.equal(response.status,200);const output=await response.text();assert.ok(!output.includes('secret sentence'));assert.ok(!output.includes('alice'));
 const logs=requestLogs.join(' ');assert.ok(!logs.includes('secret sentence'));assert.ok(!logs.includes('alice'));assert.ok(!logs.includes(env.OPS_TOKEN));
});
test('old evidence is still inspectable through a hypothesis and cannot leak to another user',async()=>{
 const {req}=setup();await consent(req);await consent(req,'bob');await send(req,'I feel lonely.');const h=(await req('me')).body.hypotheses[0];
 assert.ok((await req('evidence?hypothesis='+h.id)).body.observations.length>0);assert.equal((await req('evidence?hypothesis='+h.id,'bob')).status,404);
});
test('failed atomic writes persist no partial conversation and release the user lock',async()=>{
 const {req,env,db}=setup();await consent(req);const realBatch=env.DB.batch.bind(env.DB);let rejectOnce=true;
 env.DB.batch=async(statements:any[])=>{if(rejectOnce&&statements.length>3){rejectOnce=false;throw new Error('synthetic_db_failure');}return realBatch(statements);};
 assert.equal((await send(req,'I feel lonely.')).status,500);assert.equal((await req('me')).body.messages.length,0);assert.equal((db.db.prepare('SELECT active_request FROM profiles').get() as any).active_request,null);
 assert.equal((await send(req,'I feel lonely.')).status,200);
});
test('an account export restores into a clean synthetic database with evidence links intact',async()=>{
 const {req,db}=setup();await consent(req);await send(req,'I feel anxious about work.');const before=(await req('me')).body;
 const snapshot=db.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();assert.ok(snapshot.length>=9);
 const exported=(await req('export')).body;const roundTrip=JSON.parse(JSON.stringify(exported));
 const restored=setup();await consent(restored.req);
 for(const table of ['messages','observations','hypotheses','feedback','revisions'])for(const row of roundTrip[table]){const keys=Object.keys(row);restored.db.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));}
 const after=(await restored.req('me')).body;assert.equal(after.messages.length,before.messages.length);assert.equal(after.observations.length,before.observations.length);assert.equal(after.hypotheses[0].claim,before.hypotheses[0].claim);
});

test('shared conversation limits apply across different authenticated users',async()=>{
 const {req,env}=setup();env.APP_DAILY_MESSAGE_LIMIT='1';await consent(req);await consent(req,'bob');assert.equal((await send(req,'I feel calm.')).status,200);assert.equal((await send(req,'I feel calm.','bob')).status,429);
});
test('legacy storage consent requires acknowledgment of the new notice before new messages',async()=>{
 const {req,db}=setup();await consent(req);db.db.prepare("UPDATE profiles SET consent_version='legacy'").run();assert.equal((await send(req,'I feel calm.')).status,403);await consent(req);assert.equal((await send(req,'I feel calm.')).status,200);
});
test('daily export manifests never expose internal operational tables or accept SQL table input',async()=>{
 const {req}=setup();await consent(req);assert.equal((await req('export?table=usage_buckets&revision=0')).status,400);assert.equal((await req('export?table=messages;DROP&revision=0')).status,400);assert.equal((await req('export?table=messages&revision=99')).status,409);
});
test('large feedback and hypothesis updates stay within a bounded statement count',async()=>{
 const {req,db,env}=setup();await consent(req);await send(req,'I feel lonely.');const state=(await req('me')).body;const h=state.hypotheses[0];const ids=[];
 for(let i=0;i<180;i++){const oid='observation-'+i;ids.push(oid);db.db.prepare('INSERT INTO observations(id,user_id,message_id,parameter_id,quote,value,direction,scope,timeframe,source,strength,intensity,episode_key,retracted,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)').run(oid,'alice',state.messages[0].id,'loneliness','I feel lonely.','Loneliness expressed','support','general','current','explicit','explicit',null,'episode'+i,new Date().toISOString());}
 db.db.prepare('UPDATE hypotheses SET support_ids=? WHERE id=?').run(JSON.stringify(ids),h.id);let max=0;const batch=env.DB.batch.bind(env.DB);env.DB.batch=async(rows:any[])=>{max=Math.max(max,rows.length);return batch(rows);};
 assert.equal((await req('feedback','alice','POST',{hypothesisId:h.id,kind:'wrong',note:''})).status,200);assert.ok(max<10);assert.equal((db.db.prepare("SELECT count(*) AS n FROM observations WHERE id LIKE 'observation-%' AND retracted=1").get() as any).n,180);
});
