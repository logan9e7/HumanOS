import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const path of new Set(paths)){
 if(!existsSync(path))continue;
 if(path.startsWith('.env')&&path!=='.env.example')throw new Error('Environment file included: '+path);
 const text=readFileSync(path,'utf8');
 if(/(?:gsk_[A-Za-z0-9]{25,}|xai-[A-Za-z0-9]{25,}|gh[pousr]_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text))throw new Error('Potential credential in '+path);
}
const manifest=JSON.parse(readFileSync('.openai/hosting.json','utf8'));
assert.equal(manifest.d1,'DB');assert.ok(manifest.project_id);
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
for(const migration of journal.entries){assert.ok(existsSync(`drizzle/${migration.tag}.sql`));assert.ok(existsSync(`drizzle/meta/${String(migration.idx).padStart(4,'0')}_snapshot.json`));}
assert.ok(readFileSync('vite.config.ts','utf8').includes('sites('));
assert.ok(!readFileSync('app/HumanOS.tsx','utf8').includes('localStorage'));
assert.ok(!readFileSync('app/HumanOS.tsx','utf8').includes('dangerouslySetInnerHTML'));
console.log('Release checks passed: credential scan, migration journal, Sites integration and private-data boundaries.');
