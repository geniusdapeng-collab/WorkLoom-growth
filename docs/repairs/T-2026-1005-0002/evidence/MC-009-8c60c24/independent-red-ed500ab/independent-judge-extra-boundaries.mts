import { reviewStage } from './growth-marketing-acceptance-16353a3/packages/video-studio/src/producer-gate.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:new URL('./growth-marketing-acceptance-16353a3/',import.meta.url),encoding:'utf8'}).trim();
const good=JSON.stringify({approved:true,score:96,issues:[],suggestions:[],reason:'通过'});
const cases=[
 {name:'original-explicit-denial-malformed-suggestions',raw:JSON.stringify({approved:false,score:10,issues:['原文不支持'],suggestions:[false],reason:'否定主张不可用'})},
 {name:'duplicate-decision-erases-denial',raw:'{"approved":false,"score":10,"approved":true,"score":96,"issues":[],"suggestions":[],"reason":"两组相互冲突裁决"}'},
 {name:'duplicate-escaped-decision-erases-denial',raw:'{"approved":false,"\\u0061pproved":true,"score":96,"issues":[],"suggestions":[],"reason":"重复决策键"}'},
 {name:'fence-opening-without-closing',raw:'```json\n'+good},
 {name:'fence-closing-without-opening',raw:good+'\n```'},
];
const dir=mkdtempSync(join(tmpdir(),'independent-judge-boundary-')),file=join(dir,'facts.json');writeFileSync(file,JSON.stringify({source:'原文',claim:'主张'}));
const results=[];
try{for(const {name,raw} of cases){let calls=0;const verdict=await reviewStage({stage:'facts',projectId:'P-independent-extra',artifacts:[{path:file,kind:'json'}],deterministic:[],minScore:85,env:{LLM_BASE_URL:'https://judge.example.test',LLM_API_KEY:'test-only',LLM_MODEL:'injected-judge'},fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:raw}}]}));}});results.push({name,sourceCommit,raw,calls,actual:verdict,expected:{calls:1,approved:false,status:'failed-or-unverified'},pass:calls===1&&!verdict.approved&&verdict.status!=='passed'});}
console.log(JSON.stringify({sourceCommit,externalOrPaidProvider:false,results},null,2));process.exitCode=results.every(x=>x.pass)?0:1;
}finally{rmSync(dir,{recursive:true,force:true});}
