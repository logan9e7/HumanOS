export function publicProvider(provider: {name:string}|null) {
  return provider ? {name:provider.name} : null;
}
export function publicMessage(message:any) {
  return {id:message.id,role:message.role,content:message.content,created_at:message.created_at,
    responseMode:message.role==='assistant' ? (/^(groq|gemini):/.test(message.model)?'ai':'basic') : null};
}
export function publicProfile(profile:any) {
  return profile ? {llm_consent:profile.llm_consent,memory_paused:profile.memory_paused,consent_version:profile.consent_version} : null;
}
