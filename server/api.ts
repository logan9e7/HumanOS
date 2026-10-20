import {PARAMETERS,PARAMETER_MAP,CATALOG_VERSION} from './parameters';
import {extractBaseline,buildHypotheses,episodeKey,baselineReply} from './inference';
import {MODEL_CARD} from './classifier';
import {callProvider,providerReady,providerInfo,type ModelEnvironment} from './provider';
export type Environment=ModelEnvironment&{DB:D1Database};
const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
async function all(db:D1Database,sql:string,...args:any[]){return (await db.prepare(sql).bind(...args).all()).results as any[];}
async function body(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'This action must originate from HumanOS.');
 if(!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Send JSON.');
 const raw=await request.text();if(raw.length>12000)throw new HttpError(413,'Request too large.');
 try{return JSON.parse(raw);}catch{throw new HttpError(400,'Invalid JSON.');}
}
export async function loadState(db:D1Database,user:string){
 const [p,m,o,h,r]=await Promise.all([
 db.prepare('SELECT user_id,consented_at,revision,llm_consent FROM profiles WHERE user_id=?').bind(user).first(),
 all(db,'SELECT id,role,content,model,trace,created_at FROM messages WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100',user),
 all(db,'SELECT * FROM observations WHERE user_id=? ORDER BY created_at DESC LIMIT 600',user),
 all(db,'SELECT * FROM hypotheses WHERE user_id=? AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 100',user),
 all(db,'SELECT id,kind,summary,created_at FROM revisions WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user)]);
 const hypotheses=h.map(x=>({...x,supportIds:JSON.parse(x.support_ids),counterIds:JSON.parse(x.counter_ids),alternatives:JSON.parse(x.alternatives)}));
 const estimates=buildHypotheses(o);
 const parameters=PARAMETERS.map(p=>{const evidence=estimates.filter(e=>e.parameterId===p.id);return {...p,estimate:evidence.find(e=>e.status==='candidate')||evidence[0]||null};});
 return {profile:p,messages:m.reverse().map(x=>({...x,trace:JSON.parse(x.trace)})),observations:o,hypotheses,revisions:r,parameters};
}
async function withLock(db:D1Database,user:string,callback:(token:string)=>Promise<Response>){
 const token=id(),time=now(),stale=new Date(Date.now()-90000).toISOString();
 const locked=await db.prepare('UPDATE profiles SET active_request=?,locked_at=? WHERE user_id=? AND (active_request IS NULL OR locked_at<?) RETURNING user_id').bind(token,time,user,stale).first();
 if(!locked)throw new HttpError(409,'Another update is in progress. Please retry shortly.');
 try{return await callback(token);}finally{await db.prepare('UPDATE profiles SET active_request=NULL,locked_at=NULL WHERE user_id=? AND active_request=?').bind(user,token).run();}
}
function hypothesisStatements(db:D1Database,user:string,rows:any[],old:any[],time:string,revision:number){
 const fresh=buildHypotheses(rows,new Date(time)),statements:D1PreparedStatement[]=[];
 for(const h of fresh){
  const previous=old.find(x=>x.parameter_id===h.parameterId&&x.scope===h.scope&&!x.superseded_at);
  if(previous?.evidence_strength==='user_confirmed'&&h.status!=='disputed'&&JSON.stringify(JSON.parse(previous.support_ids))===JSON.stringify(h.supportIds)&&JSON.stringify(JSON.parse(previous.counter_ids))===JSON.stringify(h.counterIds))h.evidenceStrength='user_confirmed';
  const signature=JSON.stringify([h.claim,h.status,h.evidenceStrength,h.supportIds,h.counterIds]);
  if(previous&&JSON.stringify([previous.claim,previous.status,previous.evidence_strength,JSON.parse(previous.support_ids),JSON.parse(previous.counter_ids)])===signature)continue;
  if(previous)statements.push(db.prepare('UPDATE hypotheses SET superseded_at=? WHERE id=? AND user_id=?').bind(time,previous.id,user));
  statements.push(db.prepare('INSERT INTO hypotheses (id,user_id,parameter_id,scope,claim,status,evidence_strength,support_ids,counter_ids,alternatives,revision,valid_from,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id(),user,h.parameterId,h.scope,h.claim,h.status,h.evidenceStrength,JSON.stringify(h.supportIds),JSON.stringify(h.counterIds),JSON.stringify(h.alternatives),revision,time,time));
 }
 return statements;
}
export async function handleApi(request:Request,env:Environment,fetcher:typeof fetch=fetch):Promise<Response>{
 try{
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/health'){
   if(!env.DB)return json({status:'degraded',database:'unavailable',parameterCount:50},503);
   await env.DB.prepare('SELECT 1 AS ok FROM profiles LIMIT 1').all();
   return json({status:'ok',database:'D1',parameterCount:PARAMETERS.length,catalog:CATALOG_VERSION,inference:MODEL_CARD.version,neuralDialogue:providerReady(env)?'configured':'not_configured',provider:providerInfo(env)});
  }
  if(path==='/api/catalog'&&request.method==='GET')return json({version:CATALOG_VERSION,parameters:PARAMETERS,modelCard:MODEL_CARD,providerConfigured:providerReady(env),provider:providerInfo(env)});
  const user=request.headers.get('oai-authenticated-user-id');
  if(!user)return json({error:'Sign in to access your private conversation and profile.',code:'sign_in_required'},401);
  if(!env.DB)return json({error:'Database unavailable. No conversation was stored.'},503);
  if(path==='/api/me'&&request.method==='GET'){
   const state=await loadState(env.DB,user);return json({...state,signedIn:true,providerConfigured:providerReady(env),provider:providerInfo(env)});
  }
  if(path==='/api/consent'&&request.method==='POST'){
   const b=await body(request);if(b.accept!==true)throw new HttpError(400,'Confirm private conversation storage to continue.');
   const t=now();await env.DB.prepare('INSERT INTO profiles (user_id,consented_at,revision,llm_consent,created_at) VALUES (?,?,0,0,?) ON CONFLICT(user_id) DO NOTHING').bind(user,t,t).run();return json({ok:true});
  }
  const profile:any=await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(user).first();if(!profile)throw new HttpError(403,'Enable private memory before continuing.');
  if(path==='/api/provider-consent'&&request.method==='POST'){
   const b=await body(request);if(typeof b.enabled!=='boolean')throw new HttpError(400,'Choose whether to enable external model processing.');if(b.enabled&&!providerReady(env))throw new HttpError(409,'A model provider has not been configured.');
   return await withLock(env.DB,user,async()=>{await env.DB.prepare('UPDATE profiles SET llm_consent=? WHERE user_id=?').bind(b.enabled?1:0,user).run();return json({ok:true});});
  }
  if(path==='/api/messages'&&request.method==='POST'){
   const b=await body(request);if(typeof b.text!=='string'||!b.text.trim()||b.text.length>2000||typeof b.requestId!=='string'||!/^[a-zA-Z0-9-]{12,80}$/.test(b.requestId))throw new HttpError(400,'Write 1–2,000 characters and a valid request ID.');
   const prior=await env.DB.prepare('SELECT id FROM messages WHERE user_id=? AND request_id=? AND role=?').bind(user,b.requestId,'assistant').first();if(prior)return json({ok:true,replayed:true});
   return await withLock(env.DB,user,async()=>{
    const existing=await env.DB.prepare('SELECT id FROM messages WHERE user_id=? AND request_id=?').bind(user,b.requestId).first();if(existing)return json({ok:true,replayed:true});
    const day=now().slice(0,10);const quota=await env.DB.prepare('INSERT INTO quotas (user_id,day,count) VALUES (?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1 WHERE count<80 RETURNING count').bind(user,day).first();if(!quota)throw new HttpError(429,'The beta allows 80 messages per UTC day. Please return tomorrow.');
    const current:any=await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(user).first();
    const old=await all(env.DB,'SELECT * FROM hypotheses WHERE user_id=? AND superseded_at IS NULL',user);
    const evidence=await all(env.DB,'SELECT * FROM observations WHERE user_id=? ORDER BY created_at DESC LIMIT 600',user);
    const baseline=extractBaseline(b.text),warnings:string[]=[];let result={observations:baseline.observations,reply:baselineReply(b.text,baseline.observations),model:baseline.model};
    if(current.llm_consent&&providerReady(env)){
     try{const history=await all(env.DB,'SELECT role,content FROM messages WHERE user_id=? ORDER BY created_at DESC LIMIT 8',user);result=await callProvider(env,b.text,history.reverse(),buildHypotheses(evidence),fetcher);}catch{warnings.push('The external model did not return a usable response. The local ML baseline handled this turn.');}
    }
    const t=now(),userMessage=id(),assistantMessage=id(),revision=current.revision+1;
    const episode=episodeKey(b.text);const seen=new Set<string>();
    const newRows=result.observations.filter(o=>{const key=`${o.parameterId}:${o.scope}:${o.direction}`;if(seen.has(key)||evidence.some(e=>e.parameter_id===o.parameterId&&e.scope===o.scope&&e.direction===o.direction&&e.episode_key===episode&&!e.retracted))return false;seen.add(key);return true;}).map(o=>({id:id(),user_id:user,message_id:userMessage,parameter_id:o.parameterId,quote:o.quote,value:o.value,direction:o.direction,scope:o.scope,timeframe:o.timeframe,source:o.source,strength:o.strength,intensity:o.intensity,episode_key:episode,retracted:0,created_at:t}));
    const trace={model:result.model,observations:newRows.map(o=>({id:o.id,parameterId:o.parameter_id,quote:o.quote,direction:o.direction,source:o.source,timeframe:o.timeframe})),warnings,classification:baseline.modelScores,notice:'Model scores are uncalibrated text signals, not measurements of emotion or personality.'};
    const statements=[
      env.DB.prepare('INSERT INTO messages (id,user_id,request_id,role,content,model,trace,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(userMessage,user,b.requestId,'user',b.text.trim(),'user','{}',t),
      env.DB.prepare('INSERT INTO messages (id,user_id,request_id,role,content,model,trace,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(assistantMessage,user,b.requestId,'assistant',result.reply,result.model,JSON.stringify(trace),new Date(Date.parse(t)+1).toISOString()),
      ...newRows.map(o=>env.DB.prepare('INSERT INTO observations (id,user_id,message_id,parameter_id,quote,value,direction,scope,timeframe,source,strength,intensity,episode_key,retracted,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)').bind(o.id,user,userMessage,o.parameter_id,o.quote,o.value,o.direction,o.scope,o.timeframe,o.source,o.strength,o.intensity,episode,t)),
      ...hypothesisStatements(env.DB,user,[...evidence,...newRows],old,t,revision),
      env.DB.prepare('UPDATE profiles SET revision=? WHERE user_id=?').bind(revision,user),
      env.DB.prepare('INSERT INTO revisions (id,user_id,kind,summary,created_at) VALUES (?,?,?,?,?)').bind(id(),user,'conversation',`${newRows.length} evidence record${newRows.length===1?'':'s'} added. ${/^(gemini|groq):/.test(result.model)?'External dialogue model.':'Local trained classifier; authored reply.'}`,t)
    ];
    await env.DB.batch(statements);return json({ok:true,model:result.model,warnings});
   });
  }
  if(path==='/api/feedback'&&request.method==='POST'){
   const b=await body(request);if(typeof b.hypothesisId!=='string'||!['confirm','wrong','changed'].includes(b.kind)||typeof b.note!=='string'||b.note.length>500)throw new HttpError(400,'Invalid feedback.');
   return await withLock(env.DB,user,async()=>{
    const h:any=await env.DB.prepare('SELECT * FROM hypotheses WHERE id=? AND user_id=? AND superseded_at IS NULL').bind(b.hypothesisId,user).first();if(!h)throw new HttpError(404,'Hypothesis not found in your current model.');
    const t=now(),statements=[env.DB.prepare('INSERT INTO feedback (id,user_id,hypothesis_id,kind,note,created_at) VALUES (?,?,?,?,?,?)').bind(id(),user,h.id,b.kind,b.note,t)];
    if(b.kind==='confirm')statements.push(env.DB.prepare("UPDATE hypotheses SET evidence_strength='user_confirmed' WHERE id=? AND user_id=?").bind(h.id,user));
    else{
     statements.push(env.DB.prepare('UPDATE hypotheses SET superseded_at=? WHERE id=? AND user_id=?').bind(t,h.id,user));
     const ids=[...JSON.parse(h.support_ids),...JSON.parse(h.counter_ids)];for(const oid of ids)statements.push(env.DB.prepare('UPDATE observations SET retracted=1 WHERE id=? AND user_id=?').bind(oid,user));
    }
    statements.push(env.DB.prepare('UPDATE profiles SET revision=revision+1 WHERE user_id=?').bind(user));
    statements.push(env.DB.prepare('INSERT INTO revisions (id,user_id,kind,summary,created_at) VALUES (?,?,?,?,?)').bind(id(),user,b.kind==='wrong'?'correction':b.kind==='changed'?'change':'confirmation',`${PARAMETER_MAP.get(h.parameter_id)?.label||'Hypothesis'}: ${b.kind==='wrong'?'earlier interpretation rejected':b.kind==='changed'?'earlier interpretation retired because the user changed':'confirmed by user'}.${b.note?' '+b.note:''}`,t));
    await env.DB.batch(statements);return json({ok:true});
   });
  }
  if(path==='/api/export'&&request.method==='GET'){
   const names=['profiles','messages','observations','hypotheses','feedback','revisions'] as const;const out:any={version:2,exportedAt:now(),catalog:CATALOG_VERSION,limitPerTable:10000};for(const name of names)out[name]=await all(env.DB,`SELECT * FROM ${name} WHERE user_id=? LIMIT 10000`,user);return json(out);
  }
  if(path==='/api/data'&&request.method==='DELETE'){
   const b=await body(request);if(b.confirm!=='DELETE MY DATA')throw new HttpError(400,'Type DELETE MY DATA to confirm.');
   return await withLock(env.DB,user,async()=>{await env.DB.batch(['feedback','hypotheses','observations','messages','revisions','quotas','profiles'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user)));return json({ok:true});});
  }
  return json({error:'Not found.'},404);
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);console.error('HumanOS API failure',e instanceof Error?e.name:'UnknownError');return json({error:'The request could not be completed. Please retry shortly.'},500);}
}
