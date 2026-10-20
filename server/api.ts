import {PARAMETERS,PARAMETER_MAP,CATALOG_VERSION} from './parameters';
import {extractBaseline,buildHypotheses,episodeKey,baselineReply} from './inference';
import {MODEL_CARD} from './classifier';
import {callProvider,providerReady,providerInfo,type ModelEnvironment} from './provider';
import {messagePage,exportPage} from './history';
import {positiveLimit,userUsageKey,reserve,reserveProvider,recordProviderFailure,housekeeping,recordMetric,validOpsToken,type OperationalEnvironment} from './operations';
export type Environment=ModelEnvironment&OperationalEnvironment&{DB:D1Database};
const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
async function all(db:D1Database,sql:string,...args:any[]){return (await db.prepare(sql).bind(...args).all()).results as any[];}
async function body(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'This action must originate from HumanOS.');
 if(!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Send JSON.');
 if(Number(request.headers.get('content-length'))>12000)throw new HttpError(413,'Request too large.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Send a JSON object.');
 let length=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>12000){await reader.cancel();throw new HttpError(413,'Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new HttpError(400,'Send a valid JSON object.');}
}
export async function loadState(db:D1Database,user:string){
 const [p,page,o,h,r]=await Promise.all([
 db.prepare('SELECT user_id,consented_at,revision,llm_consent,memory_paused,consent_version FROM profiles WHERE user_id=?').bind(user).first(),
 messagePage(db,user),
 all(db,'SELECT * FROM observations WHERE user_id=? ORDER BY created_at DESC LIMIT 600',user),
 all(db,'SELECT * FROM hypotheses WHERE user_id=? AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 100',user),
 all(db,'SELECT id,kind,summary,created_at FROM revisions WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user)]);
 const hypotheses=h.map(x=>({...x,supportIds:JSON.parse(x.support_ids),counterIds:JSON.parse(x.counter_ids),alternatives:JSON.parse(x.alternatives)}));
 const estimates=buildHypotheses(o);
 const parameters=PARAMETERS.map(p=>{const evidence=estimates.filter(e=>e.parameterId===p.id);return {...p,estimate:evidence.find(e=>e.status==='candidate')||evidence[0]||null};});
 return {profile:p,messages:page.messages,messageCursor:page.nextCursor,observations:o,hypotheses,revisions:r,parameters};
}
async function withLock(db:D1Database,user:string,callback:(token:string)=>Promise<Response>){
 const token=id(),time=now(),stale=new Date(Date.now()-90000).toISOString();
 const locked=await db.prepare('UPDATE profiles SET active_request=?,locked_at=? WHERE user_id=? AND (active_request IS NULL OR locked_at<?) RETURNING user_id').bind(token,time,user,stale).first();
 if(!locked)throw new HttpError(409,'Another update is in progress. Please retry shortly.');
 try{return await callback(token);}finally{await db.prepare('UPDATE profiles SET active_request=NULL,locked_at=NULL WHERE user_id=? AND active_request=?').bind(user,token).run();}
}
function hypothesisStatements(db:D1Database,user:string,rows:any[],old:any[],time:string,revision:number){
 const fresh=buildHypotheses(rows,new Date(time)),retired:string[]=[],inserts:any[]=[];
 for(const h of fresh){
  const previous=old.find(x=>x.parameter_id===h.parameterId&&x.scope===h.scope&&!x.superseded_at);
  if(previous?.evidence_strength==='user_confirmed'&&h.status!=='disputed'&&JSON.stringify(JSON.parse(previous.support_ids))===JSON.stringify(h.supportIds)&&JSON.stringify(JSON.parse(previous.counter_ids))===JSON.stringify(h.counterIds))h.evidenceStrength='user_confirmed';
  const signature=JSON.stringify([h.claim,h.status,h.evidenceStrength,h.supportIds,h.counterIds]);
  if(previous&&JSON.stringify([previous.claim,previous.status,previous.evidence_strength,JSON.parse(previous.support_ids),JSON.parse(previous.counter_ids)])===signature)continue;
  if(previous)retired.push(previous.id);
  inserts.push({id:id(),user_id:user,parameter_id:h.parameterId,scope:h.scope,claim:h.claim,status:h.status,evidence_strength:h.evidenceStrength,support_ids:JSON.stringify(h.supportIds),counter_ids:JSON.stringify(h.counterIds),alternatives:JSON.stringify(h.alternatives),revision,valid_from:time,created_at:time});
 }
 const statements:D1PreparedStatement[]=[];
 if(retired.length)statements.push(db.prepare('UPDATE hypotheses SET superseded_at=? WHERE user_id=? AND id IN (SELECT value FROM json_each(?))').bind(time,user,JSON.stringify(retired)));
 if(inserts.length){const columns=Object.keys(inserts[0]);statements.push(db.prepare(`INSERT INTO hypotheses (${columns.join(',')}) SELECT ${columns.map(column=>`json_extract(value,'$.${column}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(inserts)));}
 return statements;
}
async function routeApi(request:Request,env:Environment,fetcher:typeof fetch=fetch):Promise<Response>{
 try{
  const url=new URL(request.url),path=url.pathname;
  const methods:Record<string,string[]>={'/api/health':['GET'],'/api/catalog':['GET'],'/api/me':['GET'],'/api/consent':['POST'],'/api/provider-consent':['POST'],'/api/memory':['POST'],'/api/messages':['GET','POST'],'/api/evidence':['GET'],'/api/feedback':['POST'],'/api/export':['GET'],'/api/data':['DELETE'],'/api/ops/metrics':['GET']};
  if(!methods[path])return json({error:'Not found.'},404);
  if(!methods[path].includes(request.method))return new Response(JSON.stringify({error:'Method not allowed.'}),{status:405,headers:{...headers,allow:methods[path].join(', ')}});
  if(path==='/api/ops/metrics'){
   if(!await validOpsToken(request,env.OPS_TOKEN))return json({error:'Operator authorization required.'},401);
   const metrics=await all(env.DB,'SELECT id,count,duration_ms FROM app_metrics WHERE expires_at>? ORDER BY id DESC LIMIT 500',now());
   const usage=await all(env.DB,"SELECT id,count,units FROM usage_buckets WHERE id LIKE 'provider:%' AND expires_at>? ORDER BY id DESC LIMIT 3",now());
   return json({metrics,providerUsage:usage,aiEnabled:env.AI_ENABLED!=='false'});
  }
  if(path==='/api/health'){
   if(!env.DB)return json({status:'degraded',database:'unavailable',parameterCount:50},503);
   if(!env.USAGE_HASH_KEY||env.USAGE_HASH_KEY.length<32||!env.OPS_TOKEN||env.OPS_TOKEN.length<32)return json({status:'degraded',database:'D1',operations:'not_configured'},503);
   await env.DB.prepare('SELECT memory_paused,consent_version FROM profiles LIMIT 1').all();
   await env.DB.prepare('SELECT id FROM usage_buckets LIMIT 1').all();
   return json({status:'ok',database:'D1',parameterCount:PARAMETERS.length,catalog:CATALOG_VERSION,inference:MODEL_CARD.version,release:'1.0.0',neuralDialogue:providerReady(env)&&env.AI_ENABLED!=='false'?'configured':'not_configured',provider:providerInfo(env)});
  }
  if(path==='/api/catalog'&&request.method==='GET')return json({version:CATALOG_VERSION,parameters:PARAMETERS,modelCard:MODEL_CARD,providerConfigured:providerReady(env)&&env.AI_ENABLED!=='false',provider:providerInfo(env)});
  const user=request.headers.get('oai-authenticated-user-id');
  if(!user)return json({error:'Sign in to access your private conversation and profile.',code:'sign_in_required'},401);
  if(!env.DB)return json({error:'Database unavailable. No conversation was stored.'},503);
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Open private data from HumanOS.');
  if(path==='/api/me'&&request.method==='GET'){
   const state=await loadState(env.DB,user);const usage:any=await env.DB.prepare('SELECT count FROM quotas WHERE user_id=? AND day=?').bind(user,now().slice(0,10)).first();const usageHash=env.USAGE_HASH_KEY?await userUsageKey(env,user):null;const protectedUsage:any=usageHash?await env.DB.prepare('SELECT count FROM usage_buckets WHERE id=?').bind(`day:${usageHash}:${now().slice(0,10)}`).first():null;return json({...state,signedIn:true,usage:{used:Math.max(usage?.count||0,protectedUsage?.count||0),limit:positiveLimit(env.USER_DAILY_MESSAGE_LIMIT,80,1000)},providerConfigured:providerReady(env)&&env.AI_ENABLED!=='false',provider:providerInfo(env)});
  }
  if(path==='/api/consent'&&request.method==='POST'){
   const b=await body(request);if(b.accept!==true)throw new HttpError(400,'Confirm private conversation storage to continue.');
   const t=now();await env.DB.prepare("INSERT INTO profiles (user_id,consented_at,revision,llm_consent,created_at,consent_version) VALUES (?,?,0,0,?,'2026-10-20') ON CONFLICT(user_id) DO UPDATE SET consent_version='2026-10-20',revision=profiles.revision+1").bind(user,t,t).run();return json({ok:true});
  }
  const profile:any=await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(user).first();if(!profile)throw new HttpError(403,'Enable private memory before continuing.');
  if(path==='/api/messages'&&request.method==='GET'){
   try{return json(await messagePage(env.DB,user,url.searchParams.get('before')));}catch(e){if(e instanceof Error&&e.message==='invalid_cursor')throw new HttpError(400,'Invalid history cursor.');throw e;}
  }
  if(path==='/api/evidence'){
   const hypothesis=url.searchParams.get('hypothesis');
   if(!hypothesis||hypothesis.length>80)throw new HttpError(400,'Choose a hypothesis.');
   const h:any=await env.DB.prepare('SELECT support_ids,counter_ids FROM hypotheses WHERE user_id=? AND id=?').bind(user,hypothesis).first();
   if(!h)throw new HttpError(404,'Hypothesis not found.');
   const ids:string[]=[...JSON.parse(h.support_ids),...JSON.parse(h.counter_ids)];const rows:any[]=[];
   for(let start=0;start<ids.length;start+=80){const part=ids.slice(start,start+80);rows.push(...await all(env.DB,`SELECT * FROM observations WHERE user_id=? AND id IN (${part.map(()=>'?').join(',')})`,user,...part));}
   return json({observations:rows});
  }
  if(path==='/api/memory'){
   const b=await body(request);if(typeof b.paused!=='boolean')throw new HttpError(400,'Choose whether to pause memory.');
   return withLock(env.DB,user,async()=>{await env.DB.prepare('UPDATE profiles SET memory_paused=?,revision=revision+1 WHERE user_id=?').bind(b.paused?1:0,user).run();return json({ok:true});});
  }
  if(path==='/api/provider-consent'&&request.method==='POST'){
   const b=await body(request);if(typeof b.enabled!=='boolean')throw new HttpError(400,'Choose whether to enable external model processing.');if(b.enabled&&!providerReady(env))throw new HttpError(409,'A model provider has not been configured.');
   return await withLock(env.DB,user,async()=>{await env.DB.prepare('UPDATE profiles SET llm_consent=?,revision=revision+1 WHERE user_id=?').bind(b.enabled?1:0,user).run();return json({ok:true});});
  }
  if(path==='/api/messages'&&request.method==='POST'){
   if(profile.consent_version!=='2026-10-20')throw new HttpError(403,'Review the updated privacy notice before continuing.');
   if(profile.memory_paused)throw new HttpError(403,'Memory is paused. Resume it in Data & privacy to continue.');
   const b=await body(request);if(typeof b.text!=='string'||!b.text.trim()||b.text.length>2000||typeof b.requestId!=='string'||!/^[a-zA-Z0-9-]{12,80}$/.test(b.requestId))throw new HttpError(400,'Write 1–2,000 characters and a valid request ID.');
   const prior=await env.DB.prepare('SELECT id FROM messages WHERE user_id=? AND request_id=? AND role=?').bind(user,b.requestId,'assistant').first();if(prior)return json({ok:true,replayed:true});
   return await withLock(env.DB,user,async()=>{
    const existing=await env.DB.prepare('SELECT id FROM messages WHERE user_id=? AND request_id=?').bind(user,b.requestId).first();if(existing)return json({ok:true,replayed:true});
    const usageKey=await userUsageKey(env,user),date=new Date(),day=date.toISOString().slice(0,10),minute=date.toISOString().slice(0,16);
    await housekeeping(env.DB);
    if(!await reserve(env.DB,`minute:${usageKey}:${minute}`,positiveLimit(env.USER_MINUTE_MESSAGE_LIMIT,6,30),new Date(date.getTime()+120000).toISOString()))throw new HttpError(429,'Please slow down. Try again in a minute.');
    if(!await reserve(env.DB,`app-minute:${minute}`,positiveLimit(env.APP_MINUTE_MESSAGE_LIMIT,60,1000),new Date(date.getTime()+120000).toISOString())||!await reserve(env.DB,`app-day:${day}`,positiveLimit(env.APP_DAILY_MESSAGE_LIMIT,1000,10000),new Date(date.getTime()+172800000).toISOString()))throw new HttpError(429,'The service has reached its shared conversation allowance. Please try again later.');
    const dailyLimit=positiveLimit(env.USER_DAILY_MESSAGE_LIMIT,80,1000);
    const legacy:any=await env.DB.prepare('SELECT count FROM quotas WHERE user_id=? AND day=?').bind(user,day).first();
    if((legacy?.count||0)>=dailyLimit||!await reserve(env.DB,`day:${usageKey}:${day}`,dailyLimit,new Date(date.getTime()+172800000).toISOString()))throw new HttpError(429,'Your daily message allowance has been reached. Please return tomorrow.');
    await env.DB.prepare('INSERT INTO quotas (user_id,day,count) VALUES (?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1').bind(user,day).run();
    const current:any=await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(user).first();
    const old=await all(env.DB,'SELECT * FROM hypotheses WHERE user_id=? AND superseded_at IS NULL',user);
    const evidence=await all(env.DB,'SELECT * FROM observations WHERE user_id=? ORDER BY created_at DESC LIMIT 600',user);
    const baseline=extractBaseline(b.text),warnings:string[]=[];let result={observations:baseline.observations,reply:baselineReply(b.text,baseline.observations),model:baseline.model};
    if(current.llm_consent&&providerReady(env)&&env.AI_ENABLED!=='false'){
     try{const history=await all(env.DB,'SELECT role,content FROM messages WHERE user_id=? ORDER BY created_at DESC LIMIT 8',user);result=await callProvider(env,b.text,history.reverse(),buildHypotheses(evidence),fetcher,units=>reserveProvider(env.DB,env,units));}catch(e){
      const limited=e instanceof Error&&e.message==='provider_budget_or_circuit_limit';
      console.warn(JSON.stringify({event:'provider_fallback',reason:limited?'usage_or_circuit_limit':'provider_failure'}));
      await recordMetric(env.DB,'provider_fallback',limited?429:503,0);
      if(!limited)await recordProviderFailure(env.DB);
      warnings.push(limited?'AI is temporarily at its shared usage limit or recovering from failures. The local ML baseline handled this turn.':'The external model did not return a usable response. The local ML baseline handled this turn.');
     }
    }
    const t=now(),userMessage=id(),assistantMessage=id(),revision=current.revision+1;
    const episode=episodeKey(b.text);const priorEpisode=await all(env.DB,'SELECT parameter_id,scope,direction FROM observations WHERE user_id=? AND episode_key=? AND retracted=0',user,episode);const seen=new Set<string>();
    const newRows=result.observations.filter(o=>{const key=`${o.parameterId}:${o.scope}:${o.direction}`;if(seen.has(key)||priorEpisode.some(e=>e.parameter_id===o.parameterId&&e.scope===o.scope&&e.direction===o.direction))return false;seen.add(key);return true;}).map(o=>({id:id(),user_id:user,message_id:userMessage,parameter_id:o.parameterId,quote:o.quote,value:o.value,direction:o.direction,scope:o.scope,timeframe:o.timeframe,source:o.source,strength:o.strength,intensity:o.intensity,episode_key:episode,retracted:0,created_at:t}));
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
     const ids=[...JSON.parse(h.support_ids),...JSON.parse(h.counter_ids)];statements.push(env.DB.prepare('UPDATE observations SET retracted=1 WHERE user_id=? AND id IN (SELECT value FROM json_each(?))').bind(user,JSON.stringify(ids)));
    }
    statements.push(env.DB.prepare('UPDATE profiles SET revision=revision+1 WHERE user_id=?').bind(user));
    statements.push(env.DB.prepare('INSERT INTO revisions (id,user_id,kind,summary,created_at) VALUES (?,?,?,?,?)').bind(id(),user,b.kind==='wrong'?'correction':b.kind==='changed'?'change':'confirmation',`${PARAMETER_MAP.get(h.parameter_id)?.label||'Hypothesis'}: ${b.kind==='wrong'?'earlier interpretation rejected':b.kind==='changed'?'earlier interpretation retired because the user changed':'confirmed by user'}.${b.note?' '+b.note:''}`,t));
    await env.DB.batch(statements);return json({ok:true});
   });
  }
  if(path==='/api/export'&&request.method==='GET'){
   if(!url.searchParams.has('table')&&!url.searchParams.has('verify')){const usageKey=await userUsageKey(env,user),date=new Date();
   if(!await reserve(env.DB,`export:${usageKey}:${date.toISOString().slice(0,16)}`,3,new Date(date.getTime()+120000).toISOString()))throw new HttpError(429,'Please wait a minute before exporting again.');}
   const result=await exportPage(env.DB,user,url,profile.revision);return json(result.data,result.status);
  }
  if(path==='/api/data'&&request.method==='DELETE'){
   const b=await body(request);if(b.confirm!=='DELETE MY DATA')throw new HttpError(400,'Type DELETE MY DATA to confirm.');
   return await withLock(env.DB,user,async()=>{await env.DB.batch(['feedback','hypotheses','observations','messages','revisions','quotas','profiles'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user)));return json({ok:true});});
  }
  return json({error:'Not found.'},404);
 }catch(e){if(e instanceof HttpError)return new Response(JSON.stringify({error:e.message}),{status:e.status,headers:{...headers,...(e.status===429?{'retry-after':'60'}:{})}});console.error('HumanOS API failure',e instanceof Error?e.name:'UnknownError');return json({error:'The request could not be completed. Please retry shortly.'},500);}
}

const knownRoutes=new Set(['/api/health','/api/catalog','/api/me','/api/consent','/api/provider-consent','/api/memory','/api/messages','/api/evidence','/api/feedback','/api/export','/api/data','/api/ops/metrics']);
export async function handleApi(request:Request,env:Environment,fetcher:typeof fetch=fetch):Promise<Response>{
 const requestId=crypto.randomUUID(),started=Date.now(),path=new URL(request.url).pathname;
 const route=knownRoutes.has(path)?path:'/api/unknown';
 const response=await routeApi(request,env,fetcher);
 response.headers.set('x-request-id',requestId);
 const duration=Date.now()-started;
 // Intentionally excludes identity, IP, query strings, prompts, responses and keys.
 console.info(JSON.stringify({event:'humanos_request',requestId,route,method:request.method,status:response.status,durationMs:duration}));
 if(env.DB&&request.headers.get('oai-authenticated-user-id')&&route!=='/api/health'&&route!=='/api/ops/metrics')try{await recordMetric(env.DB,route,response.status,duration);}catch{console.error('HumanOS metrics unavailable');}
 return response;
}
