import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const home=fileURLToPath(new URL('.',import.meta.url));
const dist=resolve(process.argv[2]||'../t1d-open-desk/dist');
const json=async path=>JSON.parse(await readFile(resolve(dist,path),'utf8'));
const [queue,schema]=await Promise.all([json('queue.json'),json('submission.schema.json')]);
const taskIds=queue.tasks.filter(t=>t.status==='open').map(t=>t.id);
if (!taskIds.length || !schema.required?.includes('task_id')) throw new Error('Bad evidence assets or missing task contract.');
const comm=async dir=>{
  for (const entry of await readdir(resolve(dist,dir),{withFileTypes:true})) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(entry.name)||entry.name.startsWith('.')||entry.name==='server')continue;
    const child=dir+entry.name;
    if (entry.isDirectory()) await comm(child+'/');
    else if (entry.isFile() && ['.html','.css','.js','.mjs','.md','.json','.txt','.svg','.png','.webp','.woff2'].includes(extname(entry.name))) {
      const target=resolve(home,'public',child);
      await mkdir(resolve(target,'..'),{recursive:true});
      await cp(resolve(dist,child),target);
    }
  }
};
await rm(resolve(home,'public'),{force:true,recursive:true});
await mkdir(resolve(home,'public'),{recursive:true});
await mkdir(resolve(home,'bundle'),{recursive:true});
await comm('');
const source=await readFile(resolve(home,'worker.mjs'),'utf8');
const assembled=source.replace('const SITE_DATA = null;',()=>`const SITE_DATA = ${JSON.stringify({taskIds,taskKey:'task_id',schema,assets:{}})};`);
if (assembled===source) throw new Error('Missing worker build marker');
const path=resolve(home,'bundle/index.mjs');
await writeFile(path,assembled);
const {default:worker}=await import(pathToFileURL(path));
const forumSchema=await worker.fetch(new Request('https://local.example/forum.schema.json'),{});
if (forumSchema.status!==200) throw new Error('Missing forum schema');
const write=(path,value)=>writeFile(resolve(home,'public',path),JSON.stringify(value,null,2)+'\n');
await write('forum.schema.json',await forumSchema.json());
await write('forum-config.json',{auth:'keys'});
await write('contribute.json',{apiPath:'/api/submissions',forumPath:'/api/forum',forumSchema:'/forum.schema.json',issueUrl:null,title:'T1D Open Desk evidence submission'});
await writeFile(resolve(home,'public','_headers'),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'
`);
console.log(`Native Worker built with ${taskIds.length} task IDs and static public assets.`);
