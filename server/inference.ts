import {PARAMETERS,PARAMETER_MAP,type Observation} from './parameters';
import {classify,MODEL_CARD} from './classifier';
const hints:Record<string,RegExp>={
 stress:/\b(stress(?:ed|ful)?|under pressure|tense)\b/i,anxiety:/\b(anxious|worried|nervous|afraid|scared)\b/i,sadness:/\b(sad|unhappy|heartbroken|sorrow)\b/i,anger:/\b(angry|furious|angrier|angriest)\b/i,frustration:/\b(frustrat(?:ed|ing|ion)|annoyed)\b/i,loneliness:/\b(lonely|isolated|alone and unhappy)\b/i,emptiness:/\b(empty|emptiness|void|nothing matters)\b/i,joy:/\b(happy|joyful|delighted|enjoy(?:ed|ing)?)\b/i,excitement:/\b(excited|thrilled|looking forward)\b/i,calmness:/\b(calm|peaceful|at peace|relaxed)\b/i,
 perceived_control:/\b(in control|out of control|can control|cannot control|can't control)\b/i,uncertainty:/\b(uncertain|unsure|don't know what|do not know what)\b/i,belonging:/\b(belong|accepted|feel connected|feel included)\b/i,perceived_rejection:/\b(rejected|left out|excluded|turned me down)\b/i,disappointment:/\b(disappointed|let down)\b/i,hope:/\b(hopeful|have hope|hope that|hope to)\b/i,overwhelm:/\b(overwhelmed|too much to handle|can't cope)\b/i,self_confidence:/\b(confident|believe in myself|doubt myself)\b/i,nostalgia:/\b(miss those|miss the days|miss my|miss dancing|miss travelling|miss traveling|nostalgic|wish I could go back)\b/i,regret:/\b(regret|wish I had|should have|shouldn't have)\b/i,
 energy:/\b(tired|exhausted|energetic|full of energy|drained)\b/i,sleep_quality:/\b(sleep well|sleep badly|slept well|slept badly|can't sleep|cannot sleep|poor sleep|sleepless)\b/i,mental_load:/\b(too many things|so much on my mind|mental load|workload)\b/i,motivation:/\b(motivated|unmotivated|no motivation|feel driven)\b/i,interest:/\b(interested|fascinated|curious about|care about)\b/i,boredom:/\b(bored|boring)\b/i,need_connection:/\b(want company|need someone|want to talk to|miss my friends|wish someone)\b/i,need_rest:/\b(need a break|need rest|want to rest|need to rest)\b/i,need_autonomy:/\b(want independence|need space|my own choice|want control|decide for myself)\b/i,need_achievement:/\b(want to achieve|want to accomplish|need to succeed|want to succeed)\b/i,
 novelty_seeking:/\b(love trying|like trying|enjoy exploring|prefer new)\b/i,planning_preference:/\b(prefer planning|like to plan|like planning|need a plan|plan ahead)\b/i,spontaneity:/\b(prefer spontaneous|like being spontaneous|go with the flow)\b/i,social_engagement:/\b(enjoy company|like meeting people|prefer being alone|love being alone|enjoy solitude|like being alone)\b/i,reflection:/\b(need time to think|prefer to reflect|think things through)\b/i,assertiveness:/\b(speak my mind|stand up for myself|state my opinion)\b/i,conflict_avoidance:/\b(avoid conflict|avoid arguments|hate confrontation)\b/i,reassurance_seeking:/\b(need reassurance|want reassurance|tell me it will be okay)\b/i,persistence:/\b(keep trying|won't give up|never give up|keep going despite)\b/i,direct_feedback:/\b(be direct|be honest with me|give me direct feedback|don't sugarcoat|do not sugarcoat)\b/i,
 positive_news:/\b(good news|got promoted|passed my|got the job|got accepted)\b/i,negative_news:/\b(bad news|lost my job|failed my|got rejected)\b/i,recent_trip:/\b(my last trip|last vacation|travelled|traveled|went on a trip|visited|went to the mountains)\b/i,recent_dance:/\b(last danced|last dance|danced|dance every|dancing with|used to dance)\b/i,meaningful_memory:/\b(meaningful memory|will never forget|remember when|felt most alive|felt most like myself)\b/i,proud_moment:/\b(proud of|proudest|my achievement)\b/i,loss_separation:/\b(passed away|lost someone|broke up|breakup|separated|said goodbye)\b/i,relationship_change:/\b(new friends|new relationship|got married|we broke up|friendship ended)\b/i,current_goal:/\b(my goal|my aim|I want to|I plan to|I'm trying to|I am trying to)\b/i,life_transition:/\b(new job|moving to|moved to|changed careers|starting college|became a parent)\b/i
};
const normalize=(text:string)=>text.normalize('NFKC').replace(/[’‘]/g,"'");
export function scopeFor(text:string){if(/\b(work|job|office|boss|colleague|project)\b/i.test(text))return 'work';if(/\b(family|mother|father|sister|brother|parents)\b/i.test(text))return 'family';if(/\b(friend|friends|dance|dancing|trip|travel|vacation)\b/i.test(text))return 'social';return 'general';}
function timeframeFor(text:string):Observation['timeframe']{if(/\b(used to|last year|last month|years ago|in college|when I was|back then)\b/i.test(text))return 'past';if(/\b(always|usually|generally|prefer|every week|every weekend|tend to)\b/i.test(text))return 'general';return 'current';}
export function validateObservations(raw:unknown,text:string,source:Observation['source']='llm'):Observation[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(0,12).flatMap((o:any)=>{
  if(!o||!PARAMETER_MAP.has(o.parameterId)||typeof o.quote!=='string'||o.quote.length<3||!text.includes(o.quote)||typeof o.value!=='string'||!o.value.trim()||o.value.length>300||!['support','counter'].includes(o.direction)||!['current','past','general'].includes(o.timeframe))return [];
  if(!['general','work','family','social','personal'].includes(o.scope))return [];
  const subject=normalize(o.quote);if(!/\b(I|I'm|I've|my|me)\b/i.test(subject)||/[“”"]/.test(subject)||/\b(my friend|my colleague|my brother|my sister|my mother|my father|character|novel|story|hypothetical|imagine|suppose|what if)\b/i.test(subject))return [];
  const matched=hints[o.parameterId]?.exec(subject);
  // An exact quote proves attribution, not semantic support. Until a validated
  // entailment model exists, abstain unless the quote contains a reviewed cue.
  if(!matched)return [];
  const before=subject.slice(Math.max(0,matched.index-45),matched.index);
  const denied=/\b(?:not|never|don't|do not|isn't|aren't|no longer|stopped being|am not|I'm not)\s+(?:(?:really|very|so|that|feeling|feel|as|at all)\s+){0,3}$/i.test(before);
  const direction=denied?'counter':'support';
  const p=PARAMETER_MAP.get(o.parameterId)!;
  const timeframe=p.kind==='event'&&/\b(miss|last|used to|remember)\b/i.test(subject)?'past':timeframeFor(subject);
  const intensity=Number.isInteger(o.intensity)&&o.intensity>=0&&o.intensity<=10&&new RegExp(`\\b${o.intensity}\\s*(?:/\\s*10|out of 10)\\b`).test(o.quote)?o.intensity:null;
  return [{parameterId:o.parameterId,quote:o.quote,value:o.quote.slice(0,300),direction,scope:scopeFor(subject),timeframe,source,strength:source==='classifier'?'tentative':'supported',intensity} as Observation];
 });
}
export function extractBaseline(original:string){
 const text=normalize(original),sentences=original.match(/[^.!?\n]+[.!?]?/g)||[original];const observations:Observation[]=[];
 for(const raw of sentences){const sentence=raw.trim(),s=normalize(sentence);
  // Baseline abstains on quotations, third-person accounts and hypothetical/fictional passages.
  if(!/\b(I|I'm|I've|I'd|my|me)\b/i.test(s)||/[“”"]/.test(s)||/\b(my friend|my colleague|my brother|my sister|my mother|my father|he said|she said|character|novel|story|hypothetical|imagine|suppose|what if)\b/i.test(s))continue;
  for(const p of PARAMETERS){const match=hints[p.id]?.exec(s);if(!match)continue;
   const before=s.slice(Math.max(0,match.index-45),match.index);
   const negated=/\b(?:not|never|don't|do not|isn't|aren't|no longer|stopped being|am not|I'm not)\s+(?:(?:really|very|so|that|feeling|feel|as|at all)\s+){0,3}$/i.test(before);
   const numeric=/^(?:\s*(?:is|at|about|around|:|of|level|intensity|feels))*\s*(10|[0-9])\s*(?:\/\s*10|out of 10)\b/i.exec(s.slice(match.index+match[0].length,match.index+match[0].length+45));
   observations.push({parameterId:p.id,quote:sentence,value:sentence.slice(0,300),direction:negated?'counter':'support',scope:scopeFor(s),timeframe:p.kind==='event'&&/\b(miss|last|used to|remember)\b/i.test(s)?'past':timeframeFor(s),source:'explicit',strength:'supported',intensity:numeric?Number(numeric[1]):null});
  }
 }
 const scores=classify(text);const mappings:Record<string,string>={sadness:'sadness',anger:'anger',annoyance:'frustration',joy:'joy',excitement:'excitement',nervousness:'anxiety',disappointment:'disappointment',optimism:'hope',remorse:'regret'};
 const self=/\b(I|I'm|my|me)\b/i.test(text)&&!/[“”"]/.test(text)&&!/\b(my friend|my colleague|my brother|my sister|my mother|my father|character|novel|story|hypothetical|imagine|suppose|what if|not|never|don't|do not)\b/i.test(text);
 if(self)for(const s of scores.slice(0,2)){const id=mappings[s.label];if(!id||s.score<Math.max(.65,s.threshold)||observations.some(o=>o.parameterId===id))continue;observations.push({parameterId:id,quote:original,value:`Tentative ${PARAMETER_MAP.get(id)!.label.toLowerCase()} signal in this message.`,direction:'support',scope:scopeFor(text),timeframe:timeframeFor(text),source:'classifier',strength:'tentative',intensity:null});}
 return {observations:observations.slice(0,12),modelScores:scores.slice(0,3).map(s=>({label:s.label,score:Number(s.score.toFixed(4))})),model:MODEL_CARD.version};
}
export function episodeKey(text:string){return normalize(text).toLowerCase().replace(/[^\p{L}\p{N} ]/gu,'').replace(/\s+/g,' ').trim();}
export function buildHypotheses(rows:any[],now=new Date()){
 const grouped=new Map<string,any[]>();for(const r of rows){if(r.retracted)continue;const key=`${r.parameter_id}:${r.scope}:${r.timeframe==='past'?'past':'present'}`;grouped.set(key,[...(grouped.get(key)||[]),r]);}
 return [...grouped].map(([key,all])=>{
  const unique=[...new Map(all.map(r=>[r.episode_key+':'+r.direction,r])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const p=PARAMETER_MAP.get(unique[0].parameter_id)!;const support=unique.filter(r=>r.direction==='support'),counter=unique.filter(r=>r.direction==='counter');const last=unique.at(-1)!;
  const current=unique.filter(r=>r.timeframe!=='past');const historicalOnly=!current.length;
  const latestSupport=support.at(-1),latestCounter=counter.at(-1);
  const status=historicalOnly?'historical':latestCounter&&(!latestSupport||latestCounter.created_at>=latestSupport.created_at)?'disputed':support.length?'candidate':'disputed';
  const age=Math.max(0,(now.getTime()-Date.parse(last.created_at))/86400000);const relevance=historicalOnly?20:Math.round(100*Math.pow(.5,age/p.halfLifeDays));
  const independentDays=new Set(support.map(r=>r.created_at.slice(0,10))).size;
  const strength=support.some(r=>r.source!=='classifier')&&support.length>=3&&independentDays>=2?'supported':'tentative';
  const claim=p.kind==='event'?`${p.label}: ${last.value}`:p.kind==='tendency'?`${p.label}: ${last.value}`:`${p.label} was ${last.direction==='counter'?'explicitly denied or corrected':'expressed or suggested'} in a ${last.timeframe} ${last.scope} context.`;
  return {key,parameterId:p.id,scope:last.scope,claim,status,evidenceStrength:strength,supportIds:support.map(r=>r.id),counterIds:counter.map(r=>r.id),alternatives:p.kind==='tendency'?['A context-specific preference rather than a general tendency.','A temporary response to present circumstances.']:p.kind==='event'?['The meaning of this event may differ from an initial interpretation.']:['A temporary state tied to this event.','The wording may describe a different feeling or an earlier experience.'],relevance,lastObservedAt:last.created_at,kind:p.kind,intensity:last.intensity};
 }).sort((a,b)=>b.relevance-a.relevance);
}
export function baselineReply(text:string,observations:Observation[]){
 const supported=observations.filter(o=>o.direction==='support'&&o.timeframe!=='past');const ids=supported.map(o=>o.parameterId);const lowered=normalize(text).toLowerCase();
 let reply='I’m listening. What would feel most useful to talk through right now?';
 if(/just listen|only want to vent|no advice|don't give me advice/.test(lowered))reply='I’m here to listen. You can tell this in your own way; I’ll leave room for what matters to you.';
 else if(ids.includes('loneliness')||ids.includes('emptiness'))reply='That sounds difficult to sit with. I’m here with you. Would you like to say more about this moment?';
 else if(ids.some(id=>['stress','anxiety','overwhelm'].includes(id)))reply='It sounds like there is pressure or uncertainty in this situation. We can stay with what happened, or make room for one manageable next step.';
 else if(ids.some(id=>['joy','excitement','positive_news','proud_moment'].includes(id)))reply='There’s something worth making room for here. What part of this experience feels most meaningful to you?';
 else if(observations.some(o=>['nostalgia','recent_dance','recent_trip','meaningful_memory'].includes(o.parameterId)))reply='That experience seems worth remembering. We can take our time with it. What stays with you most: the experience, the people, or that period of life?';
 else if(observations.some(o=>o.direction==='counter'))reply='Thanks for correcting me. I’ll keep that distinction in mind.';
 return reply;
}
