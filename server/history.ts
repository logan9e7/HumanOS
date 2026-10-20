export const PAGE_SIZE = 40;
const messageColumns = 'id,role,content,model,trace,created_at';
export function decodeCursor(value: string | null) {
  if (!value) return null;
  if (value.length > 300) throw new Error('invalid_cursor');
  try {
    const [date, id] = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof date !== 'string' || new Date(date).toISOString() !== date || typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error();
    return {date, id};
  } catch {throw new Error('invalid_cursor');}
}
export async function messagePage(db: D1Database, user: string, cursorValue: string | null = null) {
  const cursor = decodeCursor(cursorValue);
  const where = cursor ? ' AND (created_at<? OR (created_at=? AND id<?))' : '';
  const args = cursor ? [user, cursor.date, cursor.date, cursor.id] : [user];
  const rows = (await db.prepare(`SELECT ${messageColumns} FROM messages WHERE user_id=?${where} ORDER BY created_at DESC,id DESC LIMIT ${PAGE_SIZE + 1}`).bind(...args).all()).results as any[];
  const hasMore = rows.length > PAGE_SIZE;
  const selected = rows.slice(0, PAGE_SIZE), last = selected[selected.length - 1];
  const nextCursor = hasMore ? btoa(JSON.stringify([last.created_at, last.id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
  return {messages: selected.reverse().map(row => ({...row, trace: JSON.parse(row.trace)})), nextCursor};
}

export const EXPORT_TABLES=['profiles','messages','observations','hypotheses','feedback','revisions'] as const;
export async function exportPage(db:D1Database,user:string,url:URL,revision:number){
 const expected=url.searchParams.get('revision')??url.searchParams.get('verify');
 if(expected!==null&&(!/^\d+$/.test(expected)||Number(expected)!==revision))return {status:409,data:{error:'Your data changed during export. Please retry when other tabs are idle.'}};
 if(url.searchParams.has('verify'))return {status:200,data:{complete:true,revision}};
 const table=url.searchParams.get('table');
 if(!table){
  const counts=await db.prepare('SELECT '+EXPORT_TABLES.map(name=>`(SELECT count(*) FROM ${name} WHERE user_id=?) AS ${name}`).join(',')).bind(...EXPORT_TABLES.map(()=>user)).first();
  return {status:200,data:{version:4,revision,exportedAt:new Date().toISOString(),tables:EXPORT_TABLES,counts}};
 }
 if(!(EXPORT_TABLES as readonly string[]).includes(table)||expected===null)return {status:400,data:{error:'Choose a valid export table and revision.'}};
 const after=url.searchParams.get('after')||'';
 if(after.length>100||!/^[-a-zA-Z0-9_]*$/.test(after))return {status:400,data:{error:'Invalid export cursor.'}};
 const key=table==='profiles'?'user_id':'id';
 const columns=table==='profiles'?'user_id,consented_at,revision,llm_consent,memory_paused,consent_version,created_at':'*';
 const rows=(await db.prepare(`SELECT ${columns} FROM ${table} WHERE user_id=? AND ${key}>? ORDER BY ${key} LIMIT 201`).bind(user,after).all()).results as any[];
 const check:any=await db.prepare('SELECT revision FROM profiles WHERE user_id=?').bind(user).first();
 if(!check||check.revision!==revision)return {status:409,data:{error:'Your data changed during export. Please retry.'}};
 const page=rows.slice(0,200);
 return {status:200,data:{rows:page,nextCursor:rows.length>200?page[page.length-1][key]:null,revision}};
}
