const tables=['profiles','messages','observations','hypotheses','feedback','revisions'] as const;
export async function collectExport(fetcher:(url:string)=>Promise<Response>){
 async function get(url:string){const response=await fetcher(url);if(!response.ok){const error:any=await response.json();throw new Error(error.error||'Could not export your data.');}return await response.json() as any;}
 const manifest=await get('/api/export');
 if(manifest.version!==4||!Number.isInteger(manifest.revision))throw new Error('Unsupported export version. Reload HumanOS.');
 const parts:BlobPart[]=['{"version":4,"exportedAt":'+JSON.stringify(manifest.exportedAt)];
 for(const table of tables){
  parts.push(','+JSON.stringify(table)+':[');let cursor='',first=true,count=0;
  do{
   const page=await get('/api/export?table='+table+'&revision='+manifest.revision+'&after='+encodeURIComponent(cursor));
   if(!Array.isArray(page.rows))throw new Error('Incomplete export response. Please retry.');
   for(const row of page.rows){parts.push((first?'':',')+JSON.stringify(row));first=false;count++;}
   if(page.nextCursor&&page.nextCursor===cursor)throw new Error('Export did not advance. Please retry.');
   cursor=page.nextCursor||'';
  }while(cursor);
  if(count!==manifest.counts[table])throw new Error('Data changed during export. Please retry.');
  parts.push(']');
 }
 await get('/api/export?verify='+manifest.revision);
 parts.push(',"complete":true}');
 return new Blob(parts,{type:'application/json'});
}
