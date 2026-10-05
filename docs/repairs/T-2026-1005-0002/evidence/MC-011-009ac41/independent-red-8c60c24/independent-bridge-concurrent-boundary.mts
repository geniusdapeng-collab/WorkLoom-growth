import { WorkloomLLMEngine, installVendorEngineBridge } from './growth-marketing-acceptance-16353a3/packages/video-studio/src/llm-adapter.ts';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('./growth-marketing-acceptance-16353a3/package.json', import.meta.url));
const { LLMEngine } = require('./vendor/supermickey/systems/llm-reasoning-engine.js');
const sourceCommit = execFileSync('git', ['rev-parse','HEAD'], {cwd:new URL('./growth-marketing-acceptance-16353a3/',import.meta.url),encoding:'utf8'}).trim();
const original = globalThis.fetch, observed:Array<{prompt:string;url:string;engine:string}>=[];
globalThis.fetch=async (url,init)=>{
  const body=JSON.parse(String(init?.body));
  observed.push({prompt:body.messages[1].content,url:String(url),engine:body.model});
  return Response.json({choices:[{message:{content:'{"ok":true}'}}]});
};
const first=new WorkloomLLMEngine({baseUrl:'https://tenant-a.example.test',apiKey:'fixture-a',model:'tenant-a-model'});
const second=new WorkloomLLMEngine({baseUrl:'https://tenant-b.example.test',apiKey:'fixture-b',model:'tenant-b-model'});
const disposeFirst=installVendorEngineBridge(first);
const vendorFirst=new LLMEngine();
const disposeSecond=installVendorEngineBridge(second);
const vendorSecond=new LLMEngine();
try{
  await Promise.all([vendorFirst.reason('tenant-a-original-run'),vendorSecond.reason('tenant-b-original-run')]);
  const pass=observed.find(x=>x.prompt==='tenant-a-original-run')?.engine==='tenant-a-model' && observed.find(x=>x.prompt==='tenant-b-original-run')?.engine==='tenant-b-model';
  console.log(JSON.stringify({sourceCommit,externalOrPaidProvider:false,observed,expected:'Each original native run keeps its own engine/provider/sink after another startRun bridge installation.',pass},null,2));
  process.exitCode=pass?0:1;
}finally{disposeSecond();disposeFirst();globalThis.fetch=original;}
