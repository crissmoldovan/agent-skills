import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('installed-command dispatcher advertises a non-executable native init preview',()=>{
 const child=spawnSync(process.execPath,['src/cli.ts','--help'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(child.status,0);assert.match(child.stdout,/manifest-init-plan --manifest FILE --request FILE --state-dir DIR --executor-profile FILE/);
 assert.match(child.stdout,/non-executable/);
 assert.match(child.stdout,/manifest-init-trial-plan --install-root DIR --candidate FILE --intent FILE/);
});
