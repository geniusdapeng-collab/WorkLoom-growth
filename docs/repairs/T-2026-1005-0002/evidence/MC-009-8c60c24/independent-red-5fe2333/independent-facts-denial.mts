import { reviewStage } from './growth-marketing-acceptance-16353a3/packages/video-studio/src/producer-gate.ts';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=realpathSync(mkdtempSync(join(tmpdir(),'independent-facts-denial-'))),file=join(dir,'facts.json');
writeFileSync(file,JSON.stringify({facts:{value:'无需更换门锁',quote:'酒店无需更换门锁系统'},sources:[{text:'酒店无需更换门锁系统；公开投放前确认素材授权'}]}));
let calls=0;const bodies:any[]=[];
try {
const verdict=await reviewStage({stage:'facts',projectId:'P-negative-shape',artifacts:[{path:file,kind:'json'}],deterministic:[{id:'claims-source-bound',pass:true,hard:true,detail:'完整主张'}],requiredCheckIds:['claims-source-bound'],minScore:85,env:{LLM_BASE_URL:'https://judge.example.test',LLM_API_KEY:'test-only',LLM_MODEL:'injected-judge'},fetchImpl:async(_url,init)=>{
 calls++;bodies.push(JSON.parse(String(init?.body)));
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(calls===1?{approved:false,score:10,issues:['原文不支持'],suggestions:[false],reason:'否定主张不能使用'}:{approved:true,score:96,issues:[],suggestions:[],reason:'格式修复后通过'})}}]}));
}});
console.log(JSON.stringify({sourceCommit:'5fe23333a8bb20e53c269f0568dd8589c2941b98',test:'explicit semantic denial with malformed optional suggestion',calls,verdict,repairMessage:bodies[1]?.messages?.[0]?.content,expected:{calls:1,approved:false,status:'failed-or-unverified'},externalOrPaidProvider:false},null,2));
} finally {rmSync(dir,{recursive:true,force:true});}
