/** Local-only owner desk against dev D1/R2, using handle()'s existing test JWT/key-source injection.
 * Never deploy this harness. Run: node scripts/official-packs-dev.cjs --dev
 * It creates no Access policy or persistent authentication credentials.
 */
const {createServer}=require('node:http');
const {readFile,mkdtemp,writeFile,rm}=require('node:fs/promises');
const {resolve,join,extname}=require('node:path');
const {tmpdir}=require('node:os');
const {getPlatformProxy}=require('../cloudflare/peta-admin/node_modules/wrangler');
const {build}=require('../cloudflare/peta-admin/node_modules/esbuild');
const root=resolve(__dirname,'..');
if(process.argv[2]!=='--dev')throw Error('Explicit --dev required; production is unsupported.');
(async()=>{
 const work=await mkdtemp(join(tmpdir(),'peta-finish-worker-'));
 await writeFile(join(work,'wrangler.json'),JSON.stringify({name:'peta-finish-local-only',account_id:'7ebfd4fac7f7545a9e34a963af32ae7c',compatibility_date:'2026-10-12',d1_databases:[{binding:'DB',database_name:'peta-dev',database_id:'806da135-64f5-4063-8bce-0dca96d969db',remote:true}],r2_buckets:[{binding:'RELEASES',bucket_name:'peta-downloads-dev',remote:true}]}));
 await build({entryPoints:[join(root,'cloudflare/peta-admin/src/index.ts')],outfile:join(work,'handler.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 const {handle}=require(join(work,'handler.cjs'));
 const proxy=await getPlatformProxy({configPath:join(work,'wrangler.json'),persist:false});
 // Same claims, RSA algorithm, and injected key source as peta-admin/test/helpers.ts.
 const team='https://peta-friends.cloudflareaccess.com',aud='a'.repeat(64),email='Owner@Example.com';
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'owner'};
 const part=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 async function jwt(){const body=part({alg:'RS256',kid:'owner'})+'.'+part({iss:team,aud:[aud],email,exp:Date.now()/1000+600});return body+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(body))).toString('base64url');}
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
 const env={...proxy.env,ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:aud,OWNER_EMAILS:email,PETA_ENV:'dev',ASSETS:{fetch:async request=>{const pathname=new URL(request.url).pathname;const path=resolve(root,'cloudflare/peta-admin/public','.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(join(root,'cloudflare/peta-admin/public')+'/'))return new Response('',{status:403});try{return new Response(await readFile(path),{headers:{'Content-Type':mime[extname(path)]||'application/octet-stream'}});}catch{return new Response('',{status:404});}}}};
 const server=createServer(async(req,res)=>{try{const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v)headers.set(k,String(v));headers.set('Cf-Access-Jwt-Assertion',await jwt());const chunks=[];for await(const c of req)chunks.push(c);const request=new Request('http://127.0.0.1:8789'+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});const response=await handle(request,env,async url=>url===team+'/cdn-cgi/access/certs'?[jwk]:[]);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){console.error(e.message);res.writeHead(500).end('Local harness failed');}});
 server.listen(8789,'127.0.0.1',()=>console.log('Local test owner desk: http://127.0.0.1:8789 (actual Worker handler; dev D1/R2 only)'));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{server.close();await proxy.dispose();await rm(work,{recursive:true,force:true});process.exit();});
})().catch(e=>{console.error(e);process.exit(1)});
