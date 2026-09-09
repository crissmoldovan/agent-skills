import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,cp,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('A10 workspace governance is portable, separately installed and root verified',async()=>{
 const source=join(root,'skills','workspace-governance');const temp=await mkdtemp(join(tmpdir(),'governance-skill-'));try{await cp(source,temp,{recursive:true});const skill=await readFile(join(temp,'SKILL.md'),'utf8');assert.match(skill,/^---\nname: workspace-governance\n/);for(const phrase of ['advisory','not authentication','unbound','executable:false','separately','UNAVAILABLE','verify-plan'])assert.ok(skill.includes(phrase),phrase);
 const walk=async(dir)=>{for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.name.endsWith('.md')){const text=await readFile(p,'utf8');for(const [,link] of text.matchAll(/\]\(([^)]+)\)/g)){if(/^(https?:|#)/.test(link))continue;const target=resolve(dir,link.split('#')[0]);const rel=relative(temp,target);assert.ok(!rel.startsWith('..')&&!isAbsolute(rel));assert.ok((await stat(target)).isFile());}}}};await walk(temp);
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));assert.match(pkg.scripts.verify,/verify:governance/);assert.match(pkg.scripts['verify:governance'],/workspace-governance/);const readme=await readFile(join(root,'README.md'),'utf8');assert.ok(readme.includes(skill.match(/^description: (.+)$/m)[1]));assert.match(readme,/twenty-one public, portable/i);
 }finally{await rm(temp,{recursive:true,force:true});}
});
