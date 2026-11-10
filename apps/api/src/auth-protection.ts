// Bounded global limits are intentional on the small public staging installation.
// Never trust arbitrary X-Forwarded-For headers for bypassable per-client limits.
export function authProtection() {
  const buckets=new Map<string,{count:number;until:number}>();
  return (req:any,res:any,next:()=>void)=>{
    res.setHeader('Cache-Control','no-store');
    const path=(req.path??'').replace(/\/+$/,'').toLowerCase();
    const bucket=req.method==='POST'&&['/api/auth/login','/api/v1/auth/login'].includes(path)?'login':/^\/api\/v1\/join\/[^/]+$/.test(path)?(req.method==='POST'?'join':'inspect'):null;
    if(bucket){
      const now=Date.now();let value=buckets.get(bucket);
      if(!value||value.until<=now){value={count:0,until:now+60000};buckets.set(bucket,value);}
      if(++value.count>(bucket==='inspect'?200:40)){
        res.setHeader('Retry-After',Math.max(1,Math.ceil((value.until-now)/1000)));
        return res.status(429).json({error:'auth_rate_limited'});
      }
    }
    next();
  };
}
