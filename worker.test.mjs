import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createWorker} from './worker.mjs';
const localRoot=dirname(fileURLToPath(import.meta.url));
const project=process.env.T1D_PROJECT_ROOT??localRoot;
const assets=process.env.T1D_PROJECT_ROOT?join(project,'dist'):join(localRoot,'frontend');
const schema=JSON.parse(await readFile(join(assets,'submission.schema.json'),'utf8'));
const queue=JSON.parse(await readFile(join(assets,'queue.json'),'utf8'));
const database=new DatabaseSync(':memory:');
const sql=async name=>await readFile(new URL('./drizzle/'+name,import.meta.url),'utf8').catch(e=>{
  if(e.code!=='ENOENT')throw e;
  return readFile(project+'/drizzle/'+name,'utf8');
});
database.exec(await sql('0000_intake.sql'));
database.exec(await sql('0001_forum.sql'));
database.exec(await sql('0002_forum_budget_indexes.sql'));
const DB={
  prepare(sql) {
    const statement=database.prepare(sql);
    const bound=(p)=>({
      async all(){return {results:statement.all(...p)}},
      async first(){return statement.get(...p)},
      async run(){return {meta:statement.run(...p)}}
    });
    return {...bound([]),bind(...p){return bound(p)}};
  }
};
const host='https://research.example.org';
const ownerKey='8HZ-6YdAlZCIk3hncX0ptKMJjjHXLNtV8jNrjVNGexg';
const key='ax0llAE5E0L4zybJM1ezuTvhD1iTkQGFPngGYvvul-k';
const userKey='oYoMxbMQOc5JO3Q5sISeTxgbIwQQI5Fs6X9NtdJYbhE';
const hash=k=>createHash('sha256').update(k).digest('hex');
const identity={'X-T1D-Owner-Key':ownerKey};
const other={'oai-authenticated-user-id':'another-id','oai-authenticated-user-email':'unknown@example.org'};
const env={DB,OPEN_DESK_MODE:'invite',OPEN_DESK_OWNER_SHA256:hash(ownerKey),OPEN_DESK_CONTRIBUTOR_SHA256:[key,userKey].map(hash).join(',')};
const taskId=queue.tasks.find(x=>x.status==='open').id;
const worker=createWorker({schema,taskKey:'task_id',taskIds:[taskId],assets:{'/':{content:'test',type:'text/plain'}}});
const path='/api/submissions';
const testPacket={schema_version:1,task_id:taskId,title:'Trial endpoint audit',population:'Children and adolescents in the published cohort',stage:'stage-3',outcome:'C-peptide preservation at follow-up',follow_up:'78 weeks',finding:'The trial measured C-peptide preservation, not long-term insulin independence.',limitations:'This surrogate endpoint cannot establish sustained insulin independence.',sources:[{url:'https://www.nejm.org/doi/full/10.1056/NEJMoa2308743',locator:'Methods and endpoint results'}],claims_cure:false,public_sources_only:true,no_personal_or_health_data:true};
function request(p=path,{method='GET',headers={},body}={}) {
  return worker.fetch(new Request(host+p,{method,headers,...(body===undefined?{}:{body})}),env);
}
function send(packet=testPacket,headers=identity,options={}) {
  return request(path,{method:'POST',headers:{'content-type':'application/json','x-t1d-evidence-policy':'public-sources-only-v1',...headers,...options.headers},body:options.body??JSON.stringify(packet)});
}
test('private inbox authorization, validation, duplicates, agent-only rights and caps',async ()=>{
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/.openai/hosting.json')).status,404);
  assert.equal((await request(path)).status,403);
  assert.equal((await (await request(path+'/availability')).json()).submit,false);
  assert.equal((await (await request(path+'/availability',{headers:identity})).json()).review,true);
  assert.equal((await request(path,{headers:other})).status,403);
  assert.equal((await request(path,{headers:{'OAI-Sites-Authorization':'fake'}})).status,403);
  assert.equal((await request(path,{headers:{'oai-authenticated-user-email':'owner@example.org'}})).status,403);
  assert.equal((await send()).status,403);
  assert.equal((await send(testPacket,identity,{headers:{origin:'https://foreign.invalid'}})).status,403);
  assert.equal((await send(testPacket,identity,{headers:{origin:host,'x-t1d-evidence-policy':'no'}})).status,422);
  assert.equal((await send({...testPacket,claims_cure:true},identity,{headers:{origin:host}})).status,422);
  assert.equal((await send({...testPacket,task_id:'CLOSED-OR-MISSING'},identity,{headers:{origin:host}})).status,422);
  assert.equal((await send({...testPacket,extra:'not allowed'},identity,{headers:{origin:host}})).status,422);
  assert.equal((await send({...testPacket,sources:[{url:'https://www.nejm.org.private.example/path',locator:'full article'}]},identity,{headers:{origin:host}})).status,422);
  assert.equal((await send(testPacket,identity,{headers:{origin:host},body:' '.repeat(13000)})).status,413);
  assert.equal((await send(testPacket,identity,{headers:{origin:host},body:'{'})).status,400);
  let r=await send(testPacket,identity,{headers:{origin:host}});
  assert.equal(r.status,201,JSON.stringify(await r.clone().json()));
  const item=await r.json();
  assert.equal(item.status,'pending-review');
  r=await send(Object.fromEntries(Object.entries(testPacket).reverse()),identity,{headers:{origin:host}});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{...item,duplicate:true});
  const agent={'x-t1d-submit-key':key};
  r=await send(testPacket,agent);
  assert.equal(r.status,201);
  assert.equal((await request(path,{headers:agent})).status,403);
  const agentId=(await r.json()).id;
  assert.equal((await request(path+'?id='+agentId,{method:'DELETE',headers:{...agent,origin:host}})).status,403);
  r=await request(path,{headers:identity});
  assert.equal(r.status,200);
  assert.equal((await r.json()).submissions.length,2);
  for (let i=0;i<24;i++) assert.equal((await send({...testPacket,title:'Trial endpoint audit amendment '+i},agent)).status,201);
  assert.equal((await send({...testPacket,title:'Trial endpoint cap audit'},agent)).status,429);
  assert.equal((await send(testPacket,agent)).status,200);
  assert.equal((await request(path+'?id='+agentId,{method:'DELETE',headers:{...identity,origin:host}})).status,200);
  assert.equal((await send({...testPacket,title:'Trial endpoint cap audit'},agent)).status,201);
});

const forum='/api/forum';
const moderation=forum+'/moderation';
const regular={'X-T1D-Submit-Key':userKey};
const absent='00000000-0000-0000-0000-000000000001';
const q={kind:'question',title:'Does the surrogate track long-term independence?',text:'Find pediatric papers that measured both the surrogate and insulin independence at follow-up.',sources:[]};
const cite={url:'https://www.nejm.org/doi/full/10.1056/NEJMoa2308743',locator:'Methods and endpoint results'};
function contribution(post, opts={}) {
  return request(forum,{method:'POST',headers:{'Content-Type':'application/json','X-T1D-Evidence-Policy':'public-sources-only-v1',...opts.headers},body:JSON.stringify(post)});
}
function decide(id,decision,headers={...identity,origin:host}) {
  return request(moderation,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id,decision})});
}
test('public forum shows only approved evidence and allows separate approved keys for proposals',async ()=>{
  assert.equal((await request('/forum.schema.json')).status,200);
  assert.deepEqual(await (await request(forum)).json(),{threads:[],nextOffset:null,contribute:false,moderate:false,postingMode:'invite'});
  assert.equal((await (await request(forum,{headers:regular})).json()).contribute,true);
  assert.equal((await (await request(forum,{headers:identity})).json()).moderate,true);
  assert.equal((await request(moderation)).status,403);
  assert.equal((await request(moderation,{headers:regular})).status,403);
  assert.equal((await contribution(q)).status,403);
  assert.equal((await contribution(q,{headers:{...other,origin:host}})).status,403);
  assert.equal((await contribution(q,{headers:{'X-T1D-Owner-Key':key,origin:host}})).status,403);
  assert.equal((await contribution(q,{headers:{'X-T1D-Submit-Key':ownerKey}})).status,403);
  assert.equal((await contribution(q,{headers:other})).status,403);
  const session={...regular,origin:host};
  assert.equal((await contribution(q,{headers:{...session,origin:'https://other.example'}})).status,403);
  assert.equal((await contribution({...q,private_note:'not permitted'},{headers:session})).status,422);
  const question=await contribution(q,{headers:session});
  assert.equal(question.status,201);
  const {id:rootId}=await question.json();
  assert.equal((await request(forum+'?id='+rootId)).status,404);
  assert.equal((await (await request(forum)).json()).threads.length,0);
  const reply={kind:'finding',threadId:rootId,text:'The source reports a surrogate finding and does not establish durable insulin independence.',sources:[cite]};
  assert.equal((await contribution(reply,{headers:session})).status,404);
  assert.equal((await decide(rootId,'approve',session)).status,403);
  assert.equal((await decide(rootId,'approve',{...identity,origin:'https://other.example'})).status,403);
  assert.equal((await (await request(moderation,{headers:identity})).json()).pending[0].id,rootId);
  assert.equal((await decide(rootId,'approve')).status,200);
  assert.equal((await decide(rootId,'approve')).status,409);
  const publicThread=(await (await request(forum)).json()).threads[0];
  assert.equal(publicThread.id,rootId);
  assert.equal(publicThread.replyCount,0);
  assert.equal('submitter' in publicThread,false);
  assert.equal('email' in publicThread,false);
  assert.equal((await contribution({...reply,threadId:absent},{headers:session})).status,404);
  assert.equal((await contribution({...reply,sources:[]},{headers:session})).status,422);
  const agent={'X-T1D-Submit-Key':key};
  const found=await contribution(reply,{headers:agent});
  assert.equal(found.status,201,JSON.stringify(await found.clone().json()));
  const {id:replyId}=await found.json();
  assert.equal((await request(moderation,{headers:agent})).status,403);
  assert.equal((await decide(replyId,'approve',agent)).status,403);
  assert.equal((await request(forum+'?id='+replyId)).status,404);
  assert.equal((await (await request(forum+'?id='+rootId)).json()).replies.length,0);
  assert.equal((await decide(replyId,'approve')).status,200);
  assert.equal((await (await request(forum+'?id='+rootId)).json()).replies[0].sources[0].url,cite.url);
  assert.equal((await (await request(forum)).json()).threads[0].replyCount,1);
  const correction={...reply,kind:'challenge',text:'Additional published follow-up will be needed and the early trial does not answer this.'};
  const {id:correctionId}=await (await contribution(correction,{headers:session})).json();
  assert.equal((await decide(rootId,'reject')).status,200);
  assert.equal((await decide(correctionId,'approve')).status,409);
  assert.equal((await decide(correctionId,'reject')).status,200);
  assert.equal((await request(forum+'?id='+rootId)).status,404);
  assert.equal((await (await request(forum)).json()).threads.length,0);
  assert.deepEqual(Object.values(database.prepare('SELECT title,body,sources,status FROM forum_posts WHERE id=?').get(rootId)),['[removed]','','[]','rejected']);
  assert.deepEqual(Object.values(database.prepare('SELECT title,body,sources,status FROM forum_posts WHERE id=?').get(correctionId)),[null,'','[]','rejected']);
  for (let i=0;i<6;i++) assert.equal((await contribution({...q,title:q.title+' amended '+i},{headers:session})).status,201);
  assert.equal((await contribution({...q,title:q.title+' over cap'},{headers:session})).status,429);
  database.prepare("UPDATE forum_posts SET submitted_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await contribution({...q,title:q.title+' next day'},{headers:session})).status,201);
});
test('default read-only and failed database never allow writes, even with supplied credentials',async ()=>{
  const invoke=(path,options,configuration)=>worker.fetch(new Request(host+path,options),configuration);
  const sample={method:'POST',headers:{...identity,origin:host,'Content-Type':'application/json','X-T1D-Evidence-Policy':'public-sources-only-v1'},body:JSON.stringify(q)};
  const readOnly={...env,OPEN_DESK_MODE:'read-only'};
  assert.equal((await invoke(forum,sample,readOnly)).status,403);
  assert.equal((await invoke(moderation,{headers:identity},readOnly)).status,403);
  const none={OPEN_DESK_MODE:'read-only'};
  assert.deepEqual(await (await invoke(forum,{},none)).json(),{threads:[],nextOffset:null,contribute:false,moderate:false,postingMode:'read-only'});
  assert.equal((await invoke(forum,sample,none)).status,403);
  assert.equal((await invoke(forum+'?id='+absent,{},none)).status,404);
  const dbStops={...env,DB:{prepare(){throw Error('quota exceeded');}}};
  assert.equal((await invoke(forum,sample,dbStops)).status,503);
  assert.equal((await invoke(forum,{},dbStops)).status,503);
});
