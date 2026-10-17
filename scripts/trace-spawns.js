/**
 * Diagnostic: logs every child process the traced Node process starts.
 *
 *   SPAWN_TRACE_LOG=trace.log NODE_OPTIONS="--require ./scripts/trace-spawns.js" node dist/tests/unit/runner.js
 *
 * Used to find the cause of "the browser keeps opening": search the log for `cmd.exe /c start ...` or `xdg-open`.
 */
const cp=require('child_process'); const fs=require('fs');
const LOG=process.env.SPAWN_TRACE_LOG;
function log(kind,cmd,args){ try{ fs.appendFileSync(LOG, JSON.stringify({t:new Date().toISOString(),ppid:process.pid,kind,cmd,args})+'\n'); }catch{} }
for(const k of ['spawn','spawnSync','execFile','execFileSync']){ const o=cp[k]; cp[k]=function(cmd,args,...r){ log(k,cmd,Array.isArray(args)?args:[]); return o.call(this,cmd,args,...r);} }
for(const k of ['exec','execSync']){ const o=cp[k]; cp[k]=function(cmd,...r){ log(k,cmd,[]); return o.call(this,cmd,...r);} }
