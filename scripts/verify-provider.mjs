// Read the secret through stdin only. No key is written to disk, args or logs.
import {callProvider} from '../server/provider.ts';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {key}=JSON.parse(input);
try{
 const result=await callProvider({AI_PROVIDER:'groq',GROQ_API_KEY:key,GROQ_MODEL:'openai/gpt-oss-20b'},'I feel anxious about my presentation at work tomorrow.',[],[]);
 console.log(JSON.stringify({status:'ok',model:result.model,replyPresent:result.reply.length>0,observationCount:result.observations.length,parameters:result.observations.map(o=>o.parameterId)}));
}catch(error){console.log(JSON.stringify({status:'error',code:error instanceof Error?error.message:'unknown'}));process.exitCode=1;}
