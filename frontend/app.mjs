const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const a=document.createElement(tag);if(text)a.textContent=text;if(cls)a.className=cls;return a};
const read=async name=>{const res=await fetch(new URL(name,document.baseURI));if(!res.ok)throw Error(res.status);return res.json()};
const tasks=new Map();let intake=null;let apiSubmit=false;let apiReview=false;
function link(name,url,cls){const a=node('a',name,cls);a.href=url;return a}
const https=(raw)=>{try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url:null}catch{return null}};
function issue(raw){const url=https(raw);return url?.hostname==='github.com'&&/^\/[\w.-]+\/[\w.-]+\/issues\/new\/?$/.test(url.pathname)?url:null}
function prompt(task){const base=new URL('./',document.baseURI).href;return 'Read '+base+'agents.md and '+base+'queue.json. '+(task?'Work on '+task+'.':'Pick one open task.')+' Verify public primary sources, then produce one evidence packet using '+base+'submission.schema.json. State ages, disease stage, endpoint, follow-up, and what cannot be concluded. No patient data, clinical advice, or experimental protocols. Check '+base+'contribute.json for the intake route. Do not submit without your operator’s approval.'}
function selectTask(id){$('task').value=id;$('packet').disabled=!tasks.has(id);$('prompt').value=prompt(tasks.has(id)?id:null);if(!apiSubmit)updateIntake()}
function updateIntake(){const el=$('intake');el.replaceChildren();
 if(apiReview)el.append(node('hr'), link('Open private review inbox','/api/submissions'));
 if (apiSubmit && intake?.apiPath==='/api/submissions') {
  const form=node('form');form.className='intake-form';const field=node('input');field.type='file';field.id='evidence-file';field.accept='.json,application/json';field.required=true;
  const fileLabel=node('label','Completed evidence packet (.json)');fileLabel.htmlFor=field.id;
  const consent=node('input');consent.type='checkbox';consent.required=true;
  const label=node('label');label.className='confirm';label.append(consent,document.createTextNode(' I checked this for private or patient information and agree to submit it for review.'));
  const send=node('button','Submit for review','button primary');send.type='submit';
  const state=node('p',null,'small');state.setAttribute('role','status');
  form.append(fileLabel,field,label,send,state);el.append(form);
  form.addEventListener('submit',async event=>{event.preventDefault();send.disabled=true;state.textContent='Submitting…';try{
   if(!field.files[0]||field.files[0].size>12000)throw Error('Choose a JSON packet smaller than 12 KB.');
   const payload=JSON.parse(await field.files[0].text());
   if(!tasks.has(payload.task_id)||payload.public_sources_only!==true||payload.no_personal_or_health_data!==true||payload.claims_cure!==false)throw Error('Use an open task and verify the packet assertions before submitting.');
   const response=await fetch(intake.apiPath,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','X-T1D-Evidence-Policy':'public-sources-only-v1'},body:JSON.stringify(payload)});
   const body=await response.json();
   if(!response.ok)throw Error(response.status===429?'Submission limit reached. Keep your packet and try later.':'The desk did not accept this packet. Check the schema and your access, then try again.');
   if(typeof body.id!=='string')throw Error('The desk did not return a receipt. Keep your evidence packet.');
   state.textContent='Received for human review. Receipt: '+body.id+'. Not published.';form.reset();
  }catch(error){state.textContent=error instanceof SyntaxError?'The selected file is not a valid evidence JSON packet.':error.message}
  finally{send.disabled=false}});
  return
 }
 const url=issue(intake?.issueUrl);if(!url){el.append(node('p','Submission isn’t enabled for this view. You can still save an evidence packet locally.','small'));return}
 const label=tasks.get($('task').value)?.id||'one task';url.searchParams.set('title',(intake.title||'T1D Open Desk evidence submission')+' · '+label);el.append(node('p','GitHub sign-in required. GitHub issues are public; remove any personal or medical information before posting. Nothing is sent automatically.','small'),link('Open public submission form',url,'button secondary'))}
function basePacket(task){return {schema_version:1,task_id:task.id,title:'',population:'',stage:'unknown',outcome:'',follow_up:'not reported',finding:'',limitations:'',sources:[],claims_cure:false,public_sources_only:false,no_personal_or_health_data:false}}
$('task').addEventListener('change',()=>selectTask($('task').value));
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('prompt').value);$('copy-state').textContent='Prompt copied.'}catch{$('prompt').focus();$('prompt').select();$('copy-state').textContent='Prompt selected. Use your device’s Copy command.'}});
$('packet').addEventListener('click',()=>{const t=tasks.get($('task').value);if(!t)return;const url=URL.createObjectURL(new Blob([JSON.stringify(basePacket(t),null,2)+'\n'],{type:'application/json'}));const a=link('',url);a.download=t.id+'-evidence-draft.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)});
$('prompt').value=prompt(null);
read('queue.json').then(q=>{for(const t of q.tasks.filter(t=>t.status==='open')){tasks.set(t.id,t);const opt=node('option',t.id+' · '+t.title);opt.value=t.id;$('task').append(opt);
 const card=node('article',null,'task');const pick=node('button','Choose this task','button secondary');pick.type='button';pick.setAttribute('aria-label','Choose task '+t.id);pick.addEventListener('click',()=>{selectTask(t.id);document.querySelector('#join').scrollIntoView();$('task').focus({preventScroll:true})});card.append(node('small',t.id+' / OPEN'),node('h3',t.title),node('p',t.question),pick);$('tasks').append(card)}$('task-count').textContent=tasks.size}).catch(()=>{$('queue-fallback').hidden=false});
read('ledger.json').then(data=>{$('review-count').textContent=data.reviewed_external_submissions;for(const row of data.entries){const card=node('article',null,'evidence');const cite=node('div',null,'cites');for(const ref of row.sources){const u=https(ref.url);if(u)cite.append(link(ref.label,u))}card.append(node('span',row.population,'tag'),node('h3',row.title),node('p',row.finding),node('p','Limit: '+row.limit,'limit'),cite);$('evidence').append(card)}}).catch(()=>$('evidence').append(node('p','The evidence record could not load here. Use the ledger.json link.','notice')));
read('contribute.json').then(async data=>{intake=data;if(data.apiPath==='/api/submissions'){try{const availability=await read('api/submissions/availability');apiSubmit=availability.submit===true;apiReview=availability.review===true}catch{apiSubmit=false;apiReview=false}}updateIntake()}).catch(updateIntake);
