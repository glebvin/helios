// RED checkpoint: saves deliberately fail until native storage is implemented.
export async function openOfflineQueue(_options: unknown) {
  return {enqueueEvent:async (_event:unknown)=>{throw new Error('offline_queue_not_implemented');},get:async (_id:string)=>null};
}
