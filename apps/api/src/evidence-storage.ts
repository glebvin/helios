import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,chmod,link,unlink} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {isAbsolute,resolve,join,dirname} from 'node:path';
import type {IncomingMessage} from 'node:http';
import {fileURLToPath} from 'node:url';
import {httpError} from './errors.js';
import {MAX_EVIDENCE_BYTES,type EvidenceType} from './evidence-input.js';
import {uuid} from './api-input.js';
export type BlobDeclaration={sizeBytes:number;sha256:string;contentType:EvidenceType};
export function verifyEvidence(bytes:Buffer,d:BlobDeclaration){
 if(bytes.length!==d.sizeBytes||bytes.length<1||bytes.length>MAX_EVIDENCE_BYTES)throw httpError(422,'evidence_size_mismatch');
 if(createHash('sha256').update(bytes).digest('hex')!==d.sha256)throw httpError(422,'evidence_digest_mismatch');
 const magic=d.contentType==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):d.contentType==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes.subarray(0,5).equals(Buffer.from('%PDF-'));
 if(!magic)throw httpError(422,'evidence_type_mismatch');
}
export async function readEvidenceRequest(req:IncomingMessage,d:BlobDeclaration){
 if(req.headers['content-type']?.toLowerCase()!=='application/octet-stream')throw httpError(415,'octet_stream_required');
 const length=req.headers['content-length'];
 if(length!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(length)||!Number.isSafeInteger(Number(length))))throw httpError(400,'invalid_content_length');
 if(length!==undefined&&Number(length)>MAX_EVIDENCE_BYTES)throw httpError(413,'evidence_too_large');
 if(length!==undefined&&Number(length)!==d.sizeBytes)throw httpError(422,'evidence_size_mismatch');
 // data listeners let us stop buffering on overflow without destroying the response socket.
 const bytes=await new Promise<Buffer>((resolve,reject)=>{
  let size=0,settled=false;const buffered=Buffer.alloc(d.sizeBytes);
  const cleanup=()=>{req.off('data',data);req.off('end',end);req.off('aborted',abort);req.off('error',error);};
  const fail=(e:unknown)=>{if(settled)return;settled=true;cleanup();req.resume();reject(e);};
  const data=(chunk:Buffer)=>{const start=size;size+=chunk.length;if(size>MAX_EVIDENCE_BYTES){fail(httpError(413,'evidence_too_large'));return;}if(size>d.sizeBytes){fail(httpError(422,'evidence_size_mismatch'));return;}chunk.copy(buffered,start);};
  const end=()=>{if(settled)return;settled=true;cleanup();resolve(buffered.subarray(0,size));};
  const abort=()=>fail(httpError(400,'upload_aborted'));const error=()=>fail(httpError(400,'upload_interrupted'));
  req.on('data',data);req.once('end',end);req.once('aborted',abort);req.once('error',error);
  if(req.aborted)abort();else if(req.readableEnded)end();
 });
 verifyEvidence(bytes,d);return bytes;
}
// Local/pilot adapter. Filesystem promotion and PostgreSQL ready commit are separate durability boundaries.
export class EvidenceStorage {
 private readonly root:string;
 constructor(){const configured=process.env.HELIOS_EVIDENCE_ROOT;if(configured&&!isAbsolute(configured))throw new Error('HELIOS_EVIDENCE_ROOT must be absolute');this.root=configured??resolve(fileURLToPath(new URL('../../../.data/evidence-54339',import.meta.url)));}
 private key(tenant:string,file:string){return join(this.root,uuid(tenant).toLowerCase(),uuid(file).toLowerCase());}
 // Small method seams allow tests to inject actual filesystem-stage failures without replacing the adapter.
 private async write(handle:FileHandle,bytes:Buffer){await handle.writeFile(bytes);}
 private async sync(handle:FileHandle){await handle.sync();}
 private async promote(temp:string,destination:string){await link(temp,destination);}
 async get(tenant:string,file:string,d:BlobDeclaration):Promise<Buffer>{
  try{const h=await open(this.key(tenant,file),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await h.stat();if(!stat.isFile()||stat.size!==d.sizeBytes||stat.size>MAX_EVIDENCE_BYTES)throw new Error('invalid evidence');const bytes=Buffer.alloc(d.sizeBytes);let read=0;while(read<bytes.length){const n=await h.read(bytes,read,bytes.length-read,read);if(!n.bytesRead)throw new Error('short evidence');read+=n.bytesRead;}verifyEvidence(bytes,d);return bytes;}finally{await h.close();}}catch{throw httpError(503,'evidence_unavailable');}
 }
 async put(tenant:string,file:string,bytes:Buffer,d:BlobDeclaration){
  verifyEvidence(bytes,d);const destination=this.key(tenant,file),directory=join(this.root,tenant.toLowerCase()),temp=join(directory,`.upload-${randomUUID()}`);let handle:FileHandle|undefined;
  try{
   await mkdir(this.root,{recursive:true,mode:0o700});await chmod(this.root,0o700);await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
   handle=await open(temp,'wx',0o600);await this.write(handle,bytes);await this.sync(handle);await handle.close();handle=undefined;
   try{await this.promote(temp,destination);}catch(e:any){if(e.code!=='EEXIST')throw e;}
   await this.get(tenant,file,d);
   // Persist the destination entry and newly created storage directories as well.
   for(const directoryToSync of [directory,this.root,dirname(this.root)]){const dir=await open(directoryToSync,'r');try{await this.sync(dir);}finally{await dir.close();}}
  }catch{throw httpError(503,'evidence_storage_failed');}
  finally{await handle?.close().catch(()=>{});await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw httpError(503,'evidence_storage_failed');});}
 }
}
