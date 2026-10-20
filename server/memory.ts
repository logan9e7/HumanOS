import {PARAMETER_MAP} from './parameters';
export function selectMemory(text:string,rows:any[],limit=8){
  const words=new Set(text.toLowerCase().match(/[a-z]{3,}/g)||[]);
  return rows.map(row=>{
    const p=PARAMETER_MAP.get(row.parameter_id);
    const quote=String(row.latest_quote||row.claim||'');
    const overlap=(quote.toLowerCase().match(/[a-z]{3,}/g)||[]).filter(word=>words.has(word)).length;
    const age=Math.max(0,(Date.now()-Date.parse(row.valid_from))/86400000);
    const historical=row.status==='historical';
    const priority=overlap*3+(p?.kind==='tendency'?8:0)+(row.evidence_strength==='user_confirmed'?5:0)+(historical?-6:Math.max(0,5-age));
    return {...row,priority,claim:quote||row.claim,supportIds:JSON.parse(row.support_ids||'[]'),counterIds:JSON.parse(row.counter_ids||'[]')};
  }).sort((a,b)=>b.priority-a.priority).slice(0,limit);
}
export function responsePolicy(text:string,memory:any[]){
  const context=memory.filter(h=>h.status==='candidate'&&Date.now()-Date.parse(h.valid_from)<7*86400000);
  const gentle=/be gentle|don't be direct|do not be direct|soften (?:the|your) feedback/i.test(text);
  const direct=!gentle&&(/be direct|be honest|don't sugarcoat|do not sugarcoat/i.test(text)||
    memory.some(h=>h.parameter_id==='direct_feedback'&&h.status==='candidate'&&/be direct|be honest|don't sugarcoat|do not sugarcoat/i.test(h.claim)));
  const listening=/just listen|only want to vent|no advice|don't give me advice/i.test(text);
  const pressure=context.some(h=>['stress','anxiety','overwhelm'].includes(h.parameter_id));
  return {directness:direct?'direct':'warm',length:/keep it short|be brief|short answer/i.test(text)||pressure?'brief':'normal',
    advice:listening?'listen_only':'offer_options',nextSteps:pressure?'at_most_one':'when_useful',
    instruction:'Current explicit user requests override these defaults. Never mention internal scores, parameter IDs or hypothesis records. Never exploit emotional vulnerability.'};
}
export function correctionKind(text:string):'wrong'|'changed'|null{
  text=text.replace(/[’‘]/g,"'");
  if(/\b(no longer|anymore|things have changed|I've changed|I have changed|used to.+(?:but|now))\b/i.test(text))return 'changed';
  if(/\b(that (?:was|is)(?:n't| not) (?:right|true|correct)|you misunderstood|got (?:that|it) wrong|not what I meant|wrong interpretation|that's wrong|that was wrong)\b/i.test(text))return 'wrong';
  return null;
}
export function correctionTargets(old:any[],evidence:any[],referenceIds:string[],parameterIds:string[]){
  const candidates=old.filter(h=>h.status!=='historical'&&(
    referenceIds.length?[...JSON.parse(h.support_ids),...JSON.parse(h.counter_ids)].some(id=>referenceIds.includes(id)):
    parameterIds.includes(h.parameter_id)));
  const specific=candidates.filter(h=>parameterIds.includes(h.parameter_id));
  return specific.length?specific:candidates;
}
export function feedbackStatements(db:D1Database,user:string,h:any,kind:string,note:string,time:string){
  const statements:D1PreparedStatement[]=[
    db.prepare('INSERT INTO feedback (id,user_id,hypothesis_id,kind,note,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),user,h.id,kind,note,time),
  ];
  if(kind==='confirm')statements.push(db.prepare("UPDATE hypotheses SET evidence_strength='user_confirmed' WHERE id=? AND user_id=?").bind(h.id,user));
  else{
    statements.push(db.prepare('UPDATE hypotheses SET superseded_at=? WHERE id=? AND user_id=?').bind(time,h.id,user));
    const ids=[...JSON.parse(h.support_ids),...JSON.parse(h.counter_ids)];
    // A changed preference remains valid historical evidence. A wrong
    // interpretation is retracted. Existing supersession records delimit versions.
    statements.push(kind==='changed'
      ?db.prepare("UPDATE observations SET timeframe='past' WHERE user_id=? AND id IN (SELECT value FROM json_each(?))").bind(user,JSON.stringify(ids))
      :db.prepare('UPDATE observations SET retracted=1 WHERE user_id=? AND id IN (SELECT value FROM json_each(?))').bind(user,JSON.stringify(ids)));
  }
  statements.push(db.prepare('INSERT INTO revisions (id,user_id,kind,summary,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),user,kind==='wrong'?'correction':kind==='changed'?'change':'confirmation',
    (PARAMETER_MAP.get(h.parameter_id)?.label||'Memory')+': '+kind+(note?'. '+note:''),time));
  return statements;
}
