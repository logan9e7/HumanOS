import model from '../ai/models/emotion-model.json';
import card from '../ai/models/model-card.json';
const vocabulary=new Map(model.terms.map((term,i)=>[term,i]));
export const MODEL_CARD=card;
export function classify(text:string){
 const tokens=text.toLowerCase().match(/[a-z0-9_]{2,}/g)||[];
 const terms=[...tokens,...tokens.slice(0,-1).map((t,i)=>`${t} ${tokens[i+1]}`)];
 const counts=new Map<number,number>();for(const t of terms){const i=vocabulary.get(t);if(i!==undefined)counts.set(i,(counts.get(i)||0)+1);}
 const entries=[...counts].map(([i,c])=>[i,(1+Math.log(c))*model.idf[i]] as [number,number]);const norm=Math.sqrt(entries.reduce((s,[,v])=>s+v*v,0))||1;
 return model.labels.map((label,k)=>{const z=entries.reduce((s,[i,v])=>s+model.weights[k][i]*v/norm,model.bias[k]);const score=1/(1+Math.exp(-z));return {label,score,threshold:model.thresholds[k]};}).sort((a,b)=>b.score-a.score);
}
