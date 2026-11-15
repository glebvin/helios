import {createHash,createHmac} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {httpError} from './errors.js';
import {uuid} from './api-input.js';
import {verifyEvidence,type BlobDeclaration,type EvidenceBlobStore} from './evidence-storage.js';

export type S3EvidenceConfig={endpoint:URL;bucket:string;region:string;accessKeyId:string;secretAccessKey:string};
const forbiddenPorts=new Set([54339,54441,4357,54502,54512]);

export function evidenceObjectKey(tenant:string,file:string){return `${uuid(tenant).toLowerCase()}/${uuid(file).toLowerCase()}`;}

export function readS3EvidenceConfig(env:NodeJS.ProcessEnv=process.env):S3EvidenceConfig{
 const endpoint=env.HELIOS_S3_ENDPOINT??'';let url:URL;
 try{url=new URL(endpoint);}catch{throw new Error('HELIOS_S3_ENDPOINT must be http://127.0.0.1 on a QA port');}
 const port=Number(url.port);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!Number.isInteger(port)||port<1||forbiddenPorts.has(port))throw new Error('HELIOS_S3_ENDPOINT must be http://127.0.0.1 on a QA port');
 const bucket=env.HELIOS_S3_BUCKET??'',region=env.HELIOS_S3_REGION??'';
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw new Error('HELIOS_S3_BUCKET is invalid');
 if(!/^[a-z0-9-]{1,32}$/.test(region))throw new Error('HELIOS_S3_REGION is invalid');
 const accessKeyId=env.HELIOS_S3_ACCESS_KEY_ID??'',secretAccessKey=env.HELIOS_S3_SECRET_ACCESS_KEY??'';
 if(accessKeyId.length<8||secretAccessKey.length<16)throw new Error('S3 credentials are missing');
 return {endpoint:url,bucket,region,accessKeyId,secretAccessKey};
}

function signingKey(secret:string,day:string,region:string){
 const date=createHmac('sha256',`AWS4${secret}`).update(day).digest();
 const scoped=createHmac('sha256',date).update(region).digest();
 const service=createHmac('sha256',scoped).update('s3').digest();
 return createHmac('sha256',service).update('aws4_request').digest();
}

function call(cfg:S3EvidenceConfig,method:string,path:string,body:Buffer|null,extra:Record<string,string>={}){
 const payload=body??Buffer.alloc(0),hash=createHash('sha256').update(payload).digest('hex');
 const amz=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const headers:Record<string,string>={host:cfg.endpoint.host,'x-amz-content-sha256':hash,'x-amz-date':amz,...Object.fromEntries(Object.entries(extra).map(([name,value])=>[name.toLowerCase(),value]))};
 const names=Object.keys(headers).sort();
 const canonical=`${method}\n${path}\n\n${names.map(name=>`${name}:${headers[name]}\n`).join('')}\n${names.join(';')}\n${hash}`;
 const scope=`${amz.slice(0,8)}/${cfg.region}/s3/aws4_request`;
 const signature=createHmac('sha256',signingKey(cfg.secretAccessKey,amz.slice(0,8),cfg.region)).update(`AWS4-HMAC-SHA256\n${amz}\n${scope}\n${createHash('sha256').update(canonical).digest('hex')}`).digest('hex');
 headers.authorization=`AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
 return new Promise<{status:number;body:Buffer}>((resolve,reject)=>{
  let settled=false;const finish=(error?:Error,result?:{status:number;body:Buffer})=>{if(settled)return;settled=true;if(error)reject(error);else resolve(result!);};
  const req=httpRequest({protocol:cfg.endpoint.protocol,hostname:cfg.endpoint.hostname,port:cfg.endpoint.port,method,path,headers:{...headers,'content-length':String(payload.length)}},res=>{
   const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>finish(undefined,{status:res.statusCode??0,body:Buffer.concat(chunks)}));res.on('error',error=>finish(error));
  });
  req.setTimeout(10000,()=>req.destroy(new Error('s3 timeout')));
  req.on('error',error=>finish(error));
  if(process.env.HELIOS_S3_INJECT_FAULT==='during-put'&&method==='PUT'&&path.split('/').length>2){req.write(payload.subarray(0,Math.min(8,payload.length)));req.destroy(new Error('injected upload interrupt'));return;}
  req.end(payload);
 });
}

// Loopback QA adapter. It keeps the filesystem contract: one verified object, retries reuse it, different bytes do not replace it.
export class S3EvidenceStorage implements EvidenceBlobStore {
 private ready=false;
 constructor(private readonly config:S3EvidenceConfig){}
 private objectPath(tenant:string,file:string){return `/${this.config.bucket}/${evidenceObjectKey(tenant,file)}`;}
 private async bucket(){
  if(this.ready)return;
  const created=await call(this.config,'PUT',`/${this.config.bucket}`,null,{'x-amz-acl':'private'});
  if(created.status!==200&&created.status!==409)throw new Error('bucket');
  this.ready=true;
 }
 async get(tenant:string,file:string,declaration:BlobDeclaration){
  try{
   await this.bucket();
   const response=await call(this.config,'GET',this.objectPath(tenant,file),null);
   if(response.status!==200)throw new Error('missing');
   verifyEvidence(response.body,declaration);return response.body;
  }catch(error){if(error instanceof Error&&error.message==='bucket')throw httpError(503,'evidence_storage_failed');throw httpError(503,'evidence_unavailable');}
 }
 async put(tenant:string,file:string,bytes:Buffer,declaration:BlobDeclaration){
  verifyEvidence(bytes,declaration);
  try{
   await this.bucket();
   const written=await call(this.config,'PUT',this.objectPath(tenant,file),bytes,{'if-none-match':'*','x-amz-acl':'private'});
   if(written.status!==200&&written.status!==204&&written.status!==412)throw new Error('put');
   await this.get(tenant,file,declaration);
  }catch{throw httpError(503,'evidence_storage_failed');}
 }
}
