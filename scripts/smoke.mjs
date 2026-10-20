import assert from 'node:assert/strict';
const base=process.env.HUMANOS_URL||'https://humanos-personality-lab.daringscout1.chatgpt.site';
if(!base.startsWith('https://')&&!base.startsWith('http://localhost'))throw new Error('Use the expected HTTPS origin.');
async function check(path,status,headers={}){
 const response=await fetch(base+path,{headers:{'user-agent':'Mozilla/5.0 HumanOS-release-check',...headers},signal:AbortSignal.timeout(20000),redirect:'manual'});
 assert.equal(response.status,status,`${path}: expected ${status}, got ${response.status}`);
 return response;
}
const health=await (await check('/api/health',200)).json();assert.equal(health.status,'ok');assert.equal(health.database,'D1');assert.equal(health.parameterCount,50);assert.equal(health.release,'1.0.0');
const catalog=await (await check('/api/catalog',200)).json();assert.equal(catalog.parameters.length,50);
for(const path of ['/api/me','/api/messages','/api/export','/api/ops/metrics'])await check(path,401);
// A caller must never be able to create identity by supplying dispatch headers.
await check('/api/me',401,{'oai-authenticated-user-id':'forged-smoke-identity','oai-authenticated-user-email':'forged@example.invalid'});
for(const path of ['/','/privacy','/terms']){const response=await check(path,200);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok(response.headers.get('content-security-policy')?.includes("object-src 'none'"));assert.ok(response.headers.get('cache-control')?.includes('no-store'));}
console.log('Live smoke checks passed: health, public routes, private endpoint protection, forged identity rejection and security headers.');
