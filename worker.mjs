const SITE_DATA = null; // compiler replaces this declaration; no runtime filesystem
const MAX_BYTES = 12288;
const MAX_PER_CONTRIBUTOR = 25;
const MAX_PENDING = 250;
const POLICY = "public-sources-only-v1";
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function response(status, body) {
  return Response.json(body, {status, headers: {...SECURITY_HEADERS,"Cache-Control":"no-store"}});
}
function error(status, message) { return response(status,{error:message}); }
function exactSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}
async function hexDigest(input) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))].map(x => x.toString(16).padStart(2,'0')).join('');
}
function hasOrigin(req) {
  return req.headers.get('origin') === new URL(req.url).origin;
}
async function actor(req, env) {
  // Native Cloudflare deployment: do not trust caller-supplied Sites or user
  // headers. Only locally configured, independently managed key digests grant
  // a role. No token is used for outbound calls or persisted in the database.
  if (env.OPEN_DESK_MODE !== 'invite' || !env.DB) return null;
  const format=/^[a-zA-Z0-9_-]{43,128}$/;
  const ownerKey=req.headers.get('x-t1d-owner-key');
  if (ownerKey) {
    const expected=(env.OPEN_DESK_OWNER_SHA256||'').trim().toLowerCase();
    if (!format.test(ownerKey) || !/^[a-f0-9]{64}$/.test(expected)) return null;
    const d=await hexDigest(ownerKey);
    return exactSecret(d,expected) ? {reviewer:true,key:'owner:'+d} : null;
  }
  const key=req.headers.get('x-t1d-submit-key');
  if (!key || !format.test(key)) return null;
  const digest=await hexDigest(key);
  const allowed=(env.OPEN_DESK_CONTRIBUTOR_SHA256||'').split(',').slice(0,32).map(s=>s.trim().toLowerCase()).filter(s=>/^[a-f0-9]{64}$/.test(s));
  return allowed.some(x=>exactSecret(digest,x)) ? {reviewer:false,key:'agent:'+digest} : null;
}
function safePublicCitation(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash.length > 150) return false;
    const allowed = ["fda.gov","clinicaltrials.gov","nih.gov","doi.org","nejm.org","thelancet.com","jamanetwork.com","nature.com","science.org","diabetesjournals.org","wiley.com","bmj.com","jdrf.org","breakthrought1d.org","trialnet.org","isrctn.com","who.int","ema.europa.eu"];
    return allowed.some(x=>u.hostname===x || u.hostname.endsWith('.'+x));
  } catch { return false; }
}
function schemaErrors(value, schema, path = "packet") {
  const no = () => [`Invalid ${path}.`];
  if (schema.const !== undefined && !Object.is(value, schema.const)) return no();
  if (schema.enum && !schema.enum.some(x=>Object.is(value,x))) return no();
  if (schema.anyOf && !schema.anyOf.some(s=>!schemaErrors(value,s,path).length)) return no();
  if (schema.oneOf && schema.oneOf.filter(s=>!schemaErrors(value,s,path).length).length !== 1) return no();
  switch (schema.type) {
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return no();
      if ((schema.required || []).some(key=>!Object.hasOwn(value,key))) return [`Missing required field in ${path}.`];
      for (const key of Object.keys(value)) {
        if (!schema.properties || !Object.hasOwn(schema.properties,key)) return [`Unexpected field in ${path}.`];
        const e = schemaErrors(value[key],schema.properties[key],path + '.' + key);
        if (e.length) return e;
      }
      break;
    case 'array':
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 10)) return no();
      for (let i = 0; i < value.length; i++) {
        const e = schemaErrors(value[i],schema.items || {},path + '[' + i + ']');
        if (e.length) return e;
      }
      break;
    case 'string':
      if (typeof value !== 'string' || value.trim().length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 1800) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return no();
      if (schema.pattern && !new RegExp(schema.pattern,'u').test(value)) return no();
      if ((schema.format === "uri" || /(?:url|uri|href)$/i.test(path)) && !safePublicCitation(value)) return [`Use a supported public HTTPS source at ${path}.`];
      if (schema.format === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) return no();
      break;
    case 'number':
    case 'integer':
      if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) return no();
      break;
    case 'boolean': if (typeof value !== "boolean") return no(); break;
    case 'null': if (value !== null) return no(); break;
    case undefined: break;
    default: return no(); // Fail closed on unsupported simple schema types.
  }
  return [];
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
async function parseBody(req) {
  if (!/^application\/json\s*(?:;|$)/i.test(req.headers.get('content-type') || '')) return {failure:error(415,"Send application/json.")};
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return {failure:error(413,"Submission is too large.")};
  if (!req.body) return {failure:error(400,"Missing JSON body.")};
  const reader = req.body.getReader();
  let size = 0, chunks = [];
  for (;;) {
    const {value,done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(()=>{});
      return {failure:error(413,"Submission is too large.")};
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk,offset); offset += chunk.length; }
  try { return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined))}; }
  catch { return {failure:error(400,"Malformed UTF-8 JSON.")}; }
}
function asset(req,data) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return error(405,"Method not allowed.");
  const path = new URL(req.url).pathname;
  const item = Object.hasOwn(data.assets,path) ? data.assets[path] : null;
  if (!item) return error(404,"Not found.");
  return new Response(req.method === 'HEAD' ? null : item.content, {headers:{...SECURITY_HEADERS,
    "Content-Type":item.type,
    "Cache-Control":"no-cache",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
  }});
}
export function createWorker(data) {
  return {async fetch(req,env) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === FORUM_PATH || path === FORUM_MODERATION_PATH) return forumFetch(req,env,url);
    if (path === '/forum.schema.json') {
      if (req.method !== 'GET') return error(405,"Method not allowed.");
      return response(200,FORUM_CONTRIBUTION_SCHEMA);
    }
    if (path !== '/api/submissions' && path !== '/api/submissions/availability') {
      if (path.startsWith('/api/')) return error(404,'Not found.');
      if (req.method!=='GET' && req.method!=='HEAD') return error(405,'Method not allowed.');
      return env.ASSETS ? env.ASSETS.fetch(req) : asset(req,data);
    }
    try {
      const a = await actor(req,env);
      if (path.endsWith('/availability')) {
        if (req.method !== 'GET') return error(405,"Method not allowed.");
        if (!a || !env.DB) return response(200,{submit:false,review:false,policy:POLICY});
        await env.DB.prepare("SELECT id FROM submissions LIMIT 1").first();
        return response(200,{submit:true,review:a.reviewer,policy:POLICY});
      }
      if (!a) return error(403,"Contributor access is required.");
      if (!env.DB) return error(503,"The review inbox is not configured.");
      if (req.method === 'GET') {
        if (!a.reviewer) return error(403,"Only the reviewer can read the inbox.");
        const {results} = await env.DB.prepare("SELECT id,task_id,packet,submitted_at FROM submissions ORDER BY submitted_at DESC,id DESC LIMIT 25").all();
        return response(200,{submissions:results.map(r=>({id:r.id,taskId:r.task_id,packet:JSON.parse(r.packet),submittedAt:r.submitted_at,status:"pending-review"}))});
      }
      if (req.method === 'DELETE') {
        if (!a.reviewer || !hasOrigin(req)) return error(403,"Only the reviewer can remove a submission.");
        const id = new URL(req.url).searchParams.get('id');
        if (!/^[0-9a-f-]{36}$/.test(id || '')) return error(400,"A submission ID is required.");
        const deleted = await env.DB.prepare("DELETE FROM submissions WHERE id=?").bind(id).run();
        return response(deleted.meta.changes === 1 ? 200 : 404,{removed:deleted.meta.changes === 1});
      }
      if (req.method !== 'POST') return error(405,"Method not allowed.");
      if ((a.reviewer || req.headers.has('origin')) && !hasOrigin(req)) return error(403,"Use the same-origin inbox.");
      if (req.headers.get('x-t1d-evidence-policy') !== POLICY) return error(422,"Confirm that this packet contains only public-source evidence and no patient data.");
      const parsed = await parseBody(req);
      if (parsed.failure) return parsed.failure;
      const packet = parsed.value;
      const validation = schemaErrors(packet,data.schema);
      if (validation.length) return error(422,validation[0]);
      const task = packet[data.taskKey];
      if (typeof task !== 'string' || !data.taskIds.includes(task)) return error(422,"Use an open task ID from the queue.");
      const serialized = canonical(packet);
      const digest = await hexDigest(serialized);
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO submissions (id,submitter,task_id,digest,packet,submitted_at)
      SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM submissions WHERE submitter=?) < ? AND (SELECT count(*) FROM submissions) < ?`)
        .bind(id,a.key,task,digest,serialized,at,a.key,MAX_PER_CONTRIBUTOR,MAX_PENDING).run();
      if (inserted.meta.changes === 1) return response(201,{id,status:"pending-review"});
      const existing = await env.DB.prepare("SELECT id FROM submissions WHERE submitter=? AND digest=?").bind(a.key,digest).first();
      if (existing) return response(200,{id:existing.id,status:"pending-review",duplicate:true});
      return error(429,"The review inbox is at capacity; save the packet locally.");
    } catch {
      return error(503,"The review inbox is temporarily unavailable.");
    }
  }};
}
const FORUM_PATH = '/api/forum';
const FORUM_MODERATION_PATH = '/api/forum/moderation';
const FORUM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORUM_PAGE = 30;
const FORUM_REPLIES = 60;
const FORUM_PENDING_LIMIT = 150;
const FORUM_PER_ACTOR_DAILY = 8;
const FORUM_GLOBAL_DAILY = 60;
const FORUM_MAX_OFFSET = 9999;
const FORUM_SOURCES = {
  type:'array',maxItems:6,items:{type:'object',required:['url','locator'],additionalProperties:false,properties:{
    url:{type:'string',format:'uri',minLength:10,maxLength:350},
    locator:{type:'string',minLength:4,maxLength:180}
  }}
};
const FORUM_TEXT = {type:'string',minLength:20,maxLength:1800};
const FORUM_CONTRIBUTION_SCHEMA = {
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  title:'T1D Open Desk forum contribution',
  oneOf:[
    {type:'object',required:['kind','title','text','sources'],additionalProperties:false,properties:{
      kind:{const:'question'},title:{type:'string',minLength:8,maxLength:140},text:FORUM_TEXT,sources:FORUM_SOURCES
    }},
    {type:'object',required:['kind','threadId','text','sources'],additionalProperties:false,properties:{
      kind:{enum:['finding','challenge']},threadId:{type:'string',pattern:FORUM_ID.source},text:FORUM_TEXT,sources:{...FORUM_SOURCES,minItems:1}
    }}
  ]
};
const FORUM_DECISION_SCHEMA = {
  type:'object',required:['id','decision'],additionalProperties:false,properties:{
    id:{type:'string',pattern:FORUM_ID.source},decision:{enum:['approve','reject']}
  }
};
async function forumActor(req,env) {
  const authorized=await actor(req,env);
  return authorized ? {...authorized,browser:authorized.reviewer} : null;
}
function forumPublicPost(row) {
  return {
    id:row.id,
    ...(row.title===null?{}:{title:row.title}),
    kind:row.kind,text:row.body,sources:JSON.parse(row.sources),submittedAt:row.submitted_at,
    ...(row.thread_id===null?{}:{threadId:row.thread_id}),
    ...(row.reply_count===undefined?{}:{replyCount:row.reply_count})
  };
}
function forumOffset(url) {
  const raw=url.searchParams.get('offset');
  if (raw===null) return 0;
  return /^\d{1,4}$/.test(raw)&&Number(raw)<=FORUM_MAX_OFFSET ? Number(raw) : null;
}
async function forumFetch(req,env,url) {
  try {
    if (!env.DB) {
      if (req.method==='GET' && url.pathname===FORUM_PATH && !url.searchParams.has('id')) {
        return response(200,{threads:[],nextOffset:null,contribute:false,moderate:false,postingMode:'read-only'});
      }
      if (req.method==='GET' && url.pathname===FORUM_PATH) return error(404,'Thread not found.');
      return error(403,'Forum posting and moderation are not enabled.');
    }
    const a=await forumActor(req,env);
    if (url.pathname===FORUM_MODERATION_PATH) {
      if (!a?.reviewer) return error(403,'Only the reviewer can access moderation.');
      if (req.method==='GET') {
        const {results}=await env.DB.prepare("SELECT id,thread_id,kind,title,body,sources,submitted_at FROM forum_posts WHERE status='pending' ORDER BY submitted_at ASC,id ASC LIMIT 25").all();
        return response(200,{pending:results.map(row=>({...forumPublicPost(row),threadId:row.thread_id,title:row.title}))});
      }
      if (req.method!=='POST') return error(405,'Method not allowed.');
      if (!hasOrigin(req)) return error(403,'Use the same-origin review page.');
      const parsed=await parseBody(req);
      if (parsed.failure) return parsed.failure;
      const p=parsed.value;
      if (schemaErrors(p,FORUM_DECISION_SCHEMA).length) return error(422,'Specify a valid moderation decision.');
      const reviewedAt=new Date().toISOString();
      // Reject also lets an owner remove and redact a previously published post.
      // Public reply queries require an approved parent, so a removed thread
      // immediately hides every reply without having to rewrite other rows.
      const changed=p.decision==='approve'
        ? await env.DB.prepare(`UPDATE forum_posts SET status='approved',reviewed_at=?
          WHERE id=? AND status='pending' AND (thread_id IS NULL OR EXISTS
          (SELECT 1 FROM forum_posts AS parent WHERE parent.id=forum_posts.thread_id AND parent.status='approved'))`).bind(reviewedAt,p.id).run()
        : await env.DB.prepare(`UPDATE forum_posts SET status='rejected',reviewed_at=?,body='',sources='[]',
          title=CASE WHEN kind='question' THEN '[removed]' ELSE NULL END
          WHERE id=? AND status IN ('pending','approved')`).bind(reviewedAt,p.id).run();
      if (changed.meta.changes!==1) return error(409,'This post cannot receive that decision.');
      return response(200,{id:p.id,status:p.decision==='approve'?'approved':'rejected'});
    }
    if (req.method==='GET') {
      const offset=forumOffset(url);
      if (offset===null) return error(400,'Use a valid page offset.');
      const id=url.searchParams.get('id');
      const access={contribute:Boolean(a),moderate:Boolean(a?.reviewer),postingMode:env.OPEN_DESK_MODE==='invite'?'invite':'read-only'};
      if (id===null) {
        const {results}=await env.DB.prepare(`SELECT root.id,root.thread_id,root.kind,root.title,root.body,root.sources,root.submitted_at,
          (SELECT count(*) FROM forum_posts WHERE thread_id=root.id AND status='approved') AS reply_count
          FROM forum_posts AS root WHERE root.thread_id IS NULL AND root.status='approved'
          ORDER BY root.submitted_at DESC,root.id DESC LIMIT ? OFFSET ?`).bind(FORUM_PAGE+1,offset).all();
        return response(200,{threads:results.slice(0,FORUM_PAGE).map(forumPublicPost),nextOffset:results.length>FORUM_PAGE?offset+FORUM_PAGE:null,...access});
      }
      if (!FORUM_ID.test(id)) return error(404,'Thread not found.');
      const row=await env.DB.prepare(`SELECT root.id,root.thread_id,root.kind,root.title,root.body,root.sources,root.submitted_at,
        (SELECT count(*) FROM forum_posts WHERE thread_id=root.id AND status='approved') AS reply_count
        FROM forum_posts AS root WHERE root.id=? AND root.thread_id IS NULL AND root.status='approved'`).bind(id).first();
      if (!row) return error(404,'Thread not found.');
      const {results}=await env.DB.prepare(`SELECT p.id,p.thread_id,p.kind,p.title,p.body,p.sources,p.submitted_at
        FROM forum_posts AS p JOIN forum_posts AS parent ON parent.id=p.thread_id AND parent.status='approved'
        WHERE p.thread_id=? AND p.status='approved' ORDER BY p.submitted_at ASC,p.id ASC LIMIT ? OFFSET ?`).bind(id,FORUM_REPLIES+1,offset).all();
      return response(200,{thread:forumPublicPost(row),replies:results.slice(0,FORUM_REPLIES).map(forumPublicPost),
        nextOffset:results.length>FORUM_REPLIES?offset+FORUM_REPLIES:null,...access});
    }
    if (req.method!=='POST') return error(405,'Method not allowed.');
    if (!a) return error(403,'Use an approved contributor key to submit.');
    if ((a.browser || req.headers.has('origin')) && !hasOrigin(req)) return error(403,'Use the same-origin forum.');
    if (req.headers.get('x-t1d-evidence-policy')!==POLICY) return error(422,'Confirm public sources only and no sensitive or experimental content.');
    const parsed=await parseBody(req);
    if (parsed.failure) return parsed.failure;
    const post=parsed.value;
    if (schemaErrors(post,FORUM_CONTRIBUTION_SCHEMA).length) return error(422,'Use the forum contribution schema and supported public source links.');
    const parentId=post.threadId??null;
    const record={...post,text:post.text.trim(),...(post.title?{title:post.title.trim()}:{})};
    const digest=await hexDigest(canonical(record));
    const id=crypto.randomUUID(), now=new Date();
    const at=now.toISOString(), since=new Date(now.getTime()-86400000).toISOString();
    const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO forum_posts
      (id,thread_id,submitter,digest,kind,title,body,sources,status,submitted_at)
      SELECT ?,?,?,?,?,?,?,?,'pending',? WHERE
      (? IS NULL OR EXISTS(SELECT 1 FROM forum_posts WHERE id=? AND thread_id IS NULL AND status='approved'))
      AND (SELECT count(*) FROM forum_posts WHERE status='pending') < ?
      AND (SELECT count(*) FROM forum_posts WHERE submitter=? AND submitted_at>=?) < ?
      AND (SELECT count(*) FROM forum_posts WHERE submitted_at>=?) < ?`)
      .bind(id,parentId,a.key,digest,post.kind,record.title??null,record.text,JSON.stringify(record.sources),at,parentId,parentId,
        FORUM_PENDING_LIMIT,a.key,since,FORUM_PER_ACTOR_DAILY,since,FORUM_GLOBAL_DAILY).run();
    if (inserted.meta.changes===1) return response(201,{id,status:'pending-review'});
    const existing=await env.DB.prepare('SELECT id FROM forum_posts WHERE submitter=? AND digest=?').bind(a.key,digest).first();
    if (existing) return response(200,{id:existing.id,status:'received',duplicate:true});
    if (parentId) {
      const parent=await env.DB.prepare("SELECT id FROM forum_posts WHERE id=? AND thread_id IS NULL AND status='approved'").bind(parentId).first();
      if (!parent) return error(404,'Thread not found.');
    }
    return error(429,'The forum review queue or contribution limit has been reached.');
  } catch {
    return error(503,'The forum is temporarily unavailable.');
  }
}
export default createWorker(SITE_DATA);
