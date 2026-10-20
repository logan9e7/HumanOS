'use client';
import {useEffect,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUp,ArrowUpRight,CheckCircle2,Info,LockKeyhole,MessageCircle,RefreshCcw,Sparkles,X} from 'lucide-react';
import WorkspaceLayout,{type WorkspaceTab} from './WorkspaceLayout';
import PrivacyControls from './PrivacyControls';
import {collectExport} from '../lib/export-data';

async function api(path:string,options?:RequestInit){
 const response=await fetch(path,{credentials:'same-origin',...options,signal:options?.signal||AbortSignal.timeout(35000),headers:{'content-type':'application/json',...options?.headers}});
 const value:any=await response.json();
 if(!response.ok)throw Object.assign(new Error(value.error||'Please try again.'),{status:response.status});
 return value;
}
export default function HumanOS({displayName}:{displayName:string|null}){
 const [tab,setTab]=useState<WorkspaceTab>('conversation'),[data,setData]=useState<any>(null),[config,setConfig]=useState<any>(null);
 const [connected,setConnected]=useState(false),[signedIn,setSignedIn]=useState(false),[loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false),[text,setText]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [offline,setOffline]=useState(false),[exporting,setExporting]=useState(false),[historyLoading,setHistoryLoading]=useState(false);
 const [replyTo,setReplyTo]=useState<string|null>(null),[deleteOpen,setDeleteOpen]=useState(false),[deleteText,setDeleteText]=useState('');
 const scroll=useRef<HTMLDivElement>(null),bottom=useRef<HTMLDivElement>(null),modal=useRef<HTMLDialogElement>(null);
 const anchor=useRef<{height:number;top:number}|null>(null),pending=useRef<{text:string;replyTo:string|null;id:string}|null>(null);
 const ready=signedIn&&!!data?.profile;
 const canSend=ready&&!data.profile.memory_paused&&data.profile.consent_version==='2026-10-20'&&!busy&&!exporting&&!historyLoading&&!offline;
 async function reload(){const value=await api('/api/me');setData(value);setSignedIn(true);return value;}
 useEffect(()=>{
  let active=true;
  (async()=>{
   const results=await Promise.allSettled([api('/api/config'),api('/api/health'),api('/api/me')]);
   if(!active)return;
   const [c,h,m]=results;
   if(c.status==='fulfilled')setConfig(c.value);else setError('Could not connect. Reload to try again.');
   if(h.status==='fulfilled')setConnected(h.value.status==='ok');
   if(m.status==='fulfilled'){setData(m.value);setSignedIn(true);}else if(m.reason.status!==401)setError(m.reason.message);
   setLoading(false);
  })();
  return()=>{active=false;};
 },[]);
 useEffect(()=>{
  const update=()=>setOffline(!navigator.onLine);update();
  window.addEventListener('online',update);window.addEventListener('offline',update);
  return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
 },[]);
 const latest=data?.messages?.at(-1)?.id;
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[latest,busy]);
 useLayoutEffect(()=>{if(anchor.current&&scroll.current){scroll.current.scrollTop=anchor.current.top+scroll.current.scrollHeight-anchor.current.height;anchor.current=null;}},[data?.messages?.[0]?.id]);
 useEffect(()=>{if(deleteOpen)modal.current?.showModal();else modal.current?.close();},[deleteOpen]);
 async function mutate(path:string,body:any,method='POST'){
  setBusy(true);setError('');setNotice('');
  try{await api(path,{method,body:JSON.stringify(body)});await reload();return true;}
  catch(e:any){setError(e.message);return false;}finally{setBusy(false);}
 }
 async function send(event:FormEvent){
  event.preventDefault();if(!canSend||!text.trim())return;
  const request=pending.current?.text===text&&pending.current?.replyTo===replyTo?pending.current:{text,replyTo,id:crypto.randomUUID()};
  pending.current=request;setBusy(true);setError('');setNotice('');
  try{
   const result=await api('/api/messages',{method:'POST',body:JSON.stringify({text,requestId:request.id,...(replyTo?{replyToMessageId:replyTo}:{})})});
   await reload();setText('');setReplyTo(null);pending.current=null;
   if(result.warnings?.length)setNotice(result.warnings.join(' '));
  }catch(e:any){setError(e.message);}finally{setBusy(false);}
 }
 async function loadOlder(){
  if(!data?.messageCursor||historyLoading||busy)return;
  const revision=data.profile;setHistoryLoading(true);setError('');
  try{
   const page=await api('/api/messages?before='+encodeURIComponent(data.messageCursor));
   if(scroll.current)anchor.current={height:scroll.current.scrollHeight,top:scroll.current.scrollTop};
   setData((current:any)=>current?.profile===revision?{...current,messages:[...page.messages,...current.messages],messageCursor:page.nextCursor}:current);
  }catch(e:any){setError(e.message);}finally{setHistoryLoading(false);}
 }
 async function exportData(){
  if(exporting)return;setExporting(true);setError('');
  try{
   const file=await collectExport(url=>fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(35000)}));
   const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download='humanos-data-'+new Date().toISOString().slice(0,10)+'.json';link.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Your data export is ready. Keep it somewhere safe.');
  }catch(e:any){setError(e.message);}finally{setExporting(false);}
 }
 return <WorkspaceLayout tab={tab} onNavigate={setTab} displayName={displayName} signedIn={signedIn} connected={connected}>
  <div className="content">
   <div className="page-heading"><div><p className="eyebrow">{tab==='conversation'?'A LITTLE SPACE FOR YOU':'YOUR CHOICES'}</p><h1 id="page-title" tabIndex={-1}>{tab==='conversation'?'A space to be yourself.':'Your data. Your boundaries.'}</h1><p className="subtitle">{tab==='conversation'?'Share what’s on your mind. We can take it from there.':'Choose what stays and where your words can go.'}</p></div></div>
   {offline&&<div className="alert error" role="status">You’re offline. Your draft stays on this page while you reconnect.</div>}
   {error&&<div className="alert error" role="alert"><Info size={16}/>{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={15}/></button></div>}
   {notice&&<div className="alert" role="status"><CheckCircle2 size={16}/>{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><X size={15}/></button></div>}
   {loading&&<div className="loading"><RefreshCcw size={17}/>Opening your workspace…</div>}
   {!loading&&!signedIn&&<div className="sign-in-banner"><div className="sign-in-icon"><LockKeyhole size={22}/></div><div><b>Your own space to talk.</b><p>Sign in with ChatGPT to save your conversations privately.</p></div><a className="btn primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT<ArrowUpRight size={14}/></a></div>}
   {!loading&&signedIn&&!data?.profile&&<div className="sign-in-banner"><div><b>Let the conversation continue over time.</b><p>Enable private memory to save what you share. You can pause, export or delete it. External AI stays off until you choose it. Enabling memory accepts the <a href="/terms" target="_blank" rel="noreferrer">terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">privacy notice</a>.</p></div><button className="btn primary" disabled={busy} onClick={()=>mutate('/api/consent',{accept:true})}>Enable private memory</button></div>}
   {ready&&data.profile.consent_version!=='2026-10-20'&&<div className="sign-in-banner"><div><b>Review your data choices.</b><p>Please review the updated <a href="/privacy" target="_blank" rel="noreferrer">privacy notice</a> and <a href="/terms" target="_blank" rel="noreferrer">terms</a> before continuing.</p></div><button className="btn primary" disabled={busy} onClick={()=>mutate('/api/consent',{accept:true})}>Accept and continue</button></div>}
   {tab==='conversation'&&ready&&config?.providerConfigured&&!data.profile.llm_consent&&<div className="sign-in-banner"><div><b>Choose AI conversation.</b><p>With your permission, {config.provider?.name||'the provider'} receives your current message and limited remembered context. You can turn this off anytime.</p></div><button className="btn primary" disabled={busy} onClick={()=>mutate('/api/provider-consent',{enabled:true})}>Enable AI conversation</button></div>}
   {tab==='conversation'&&ready&&!!data.profile.memory_paused&&<div className="alert" role="status">Memory is paused.<button className="btn" onClick={()=>setTab('privacy')}>Manage memory</button></div>}
   {tab==='conversation'&&<section className="panel conversation conversation-focus">
    <div className="panel-head"><div className="chat-identity"><div className="ai-mark"><Sparkles size={18}/></div><div><h2>HumanOS</h2><p>A little room to think out loud</p></div></div><MessageCircle size={18}/></div>
    <div ref={scroll} className="chat-scroll" role="log" aria-label="Conversation history" aria-live="polite">
     {data?.messageCursor&&<div className="history-actions"><button className="btn" disabled={historyLoading||busy} onClick={loadOlder}>{historyLoading?'Loading…':'Load earlier messages'}</button></div>}
     {!data?.messageCursor&&<article className="message"><div className="message-avatar"><Sparkles size={15}/></div><div className="message-body"><div className="speaker">HumanOS</div><div className="bubble">What’s on your mind today? It can be something small, something difficult, or something you simply want to talk through.</div></div></article>}
     {(data?.messages||[]).map((message:any)=><article key={message.id} className={'message '+(message.role==='user'?'user':'')}><div className="message-avatar">{message.role==='user'?'Y':<Sparkles size={14}/>}</div><div className="message-body"><div className="speaker">{message.role==='user'?'You':'HumanOS'}</div><div className="bubble">{message.content}</div>{message.role==='assistant'&&<div className="reply-tools">{message.responseMode==='basic'&&<small>Basic response · AI conversation wasn’t used</small>}<button className="text-btn" disabled={!ready||busy||exporting} onClick={()=>{setReplyTo(message.id);setText('That wasn’t right. ');document.getElementById('message')?.focus();}}>Correct this reply</button></div>}</div></article>)}
     {busy&&<div className="thinking" role="status">One moment…</div>}<div ref={bottom}/>
    </div>
    <form className="composer" onSubmit={send}>
     {replyTo&&<div className="reply-context">Clarifying an earlier reply<button type="button" className="text-btn" onClick={()=>setReplyTo(null)}>Clear</button></div>}
     <div className="input-box"><label className="sr-only" htmlFor="message">Message HumanOS</label><textarea id="message" rows={2} maxLength={2000} required disabled={!canSend} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} placeholder={data?.profile?.memory_paused?'Memory is paused.':ready?'What’s on your mind?':'Sign in and enable private memory to begin…'}/><button type="submit" aria-label="Send message" disabled={!canSend||!text.trim()}><ArrowUp size={18}/></button></div>
     <div className="composer-meta"><span>Enter to send · Shift + Enter for a new line</span><span>{text.length}/2000</span></div>
    </form>
   </section>}
   {tab==='privacy'&&<PrivacyControls ready={ready} busy={busy} exporting={exporting} profile={data?.profile} usage={data?.usage} provider={config?.provider} providerConfigured={!!config?.providerConfigured} onMemory={()=>mutate('/api/memory',{paused:!data.profile.memory_paused})} onProvider={()=>mutate('/api/provider-consent',{enabled:!data.profile.llm_consent})} onExport={exportData} onDelete={()=>{setDeleteText('');setDeleteOpen(true);}}/>}
   <footer><LockKeyhole size={11}/>Your conversation stays in your account.<a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
  </div>
  <dialog ref={modal} onCancel={()=>setDeleteOpen(false)} aria-labelledby="delete-title"><div className="modal-head"><h2 id="delete-title">Delete your HumanOS data?</h2><button className="icon-btn" disabled={busy} aria-label="Close dialog" onClick={()=>setDeleteOpen(false)}><X size={18}/></button></div><form onSubmit={async event=>{event.preventDefault();if(await mutate('/api/data',{confirm:deleteText},'DELETE')){setDeleteOpen(false);setReplyTo(null);setNotice('Your records were deleted from the active database.');}}}><div className="modal-body"><p>This removes saved conversations, remembered context and corrections from the active database. Download your data first if you want a copy.</p><label htmlFor="delete-confirm">Type DELETE MY DATA</label><input id="delete-confirm" className="field" value={deleteText} onChange={e=>setDeleteText(e.target.value)} autoComplete="off" required/>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={()=>setDeleteOpen(false)}>Cancel</button><button className="btn primary" disabled={busy||deleteText!=='DELETE MY DATA'}>{busy?'Deleting…':'Delete my data'}</button></div></div></form></dialog>
 </WorkspaceLayout>;
}
