import {EvidenceStorage} from './evidence-storage.js';
import {S3EvidenceStorage,readS3EvidenceConfig} from './s3-evidence-storage.js';

// Unset HELIOS_EVIDENCE_STORE stays on the local filesystem. The stand is not switched by this module.
export function createEvidenceStore(){
 const mode=process.env.HELIOS_EVIDENCE_STORE??'filesystem';
 if(mode==='filesystem')return new EvidenceStorage();
 if(mode==='s3')return new S3EvidenceStorage(readS3EvidenceConfig());
 throw new Error('HELIOS_EVIDENCE_STORE must be filesystem or s3');
}
