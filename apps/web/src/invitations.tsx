import {useEffect,useRef,useState} from 'react';
import {saveSession,type Session} from './api';
import {Dialog} from './dialog';
import {Mark} from './mark';

export type Invitation={id:string;role:'worker'|'master';projectId:string;code:string|null;status:string;expiresAt:string;acceptedName:string|null};
const messages:Record<string,string>={
  invitation_used:'Эта ссылка уже использована. Войдите с почтой и паролем, которые указали при регистрации.',
  invitation_revoked:'Ссылка заменена. Попросите руководителя прислать новое приглашение.',
  invitation_expired:'Срок приглашения истёк. Попросите руководителя обновить код.',
  invitation_not_found:'Приглашение не найдено. Проверьте ссылку или запросите новую.',
  email_registered:'Эта почта уже зарегистрирована. Войдите в свой аккаунт или укажите другую почту.',
  invalid_name:'Введите имя — от 1 до 120 символов.',invalid_email:'Проверьте адрес электронной почты.',
  invalid_password:'Пароль должен содержать от 10 до 128 символов.',
  role_denied:'Нет прав для этого приглашения. Обратитесь к руководителю.',project_denied:'Нет доступа к этому объекту.',
  unauthorized:'Сессия истекла. Войдите снова.',auth_rate_limited:'Слишком много попыток. Подождите минуту и повторите.',
};
export const invitationError=(e:unknown)=>messages[e instanceof Error?e.message:'']??'Не удалось выполнить действие. Проверьте связь и повторите.';
export async function inviteRequest<T>(path:string,session:Session|null,body?:unknown):Promise<T>{
  const r=await fetch('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(session?{authorization:`Bearer ${session.token}`,'x-tenant-id':session.tenantId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store'});
  const value=await r.json();if(!r.ok)throw new Error(value.error??'request_failed');return value;
}
export function InvitationDialog({session,projectId,organizationId,role,onClose}:{session:Session;projectId:string;organizationId:string;role:'worker'|'master';onClose:()=>void}){
  const [item,setItem]=useState<Invitation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const createId=useRef(crypto.randomUUID()),refreshId=useRef(crypto.randomUUID());
  const link=item?.code?`${location.origin}/join/${item.code}`:'';
  async function issue(){
    if(busy)return;setBusy(true);setError('');setCopied(false);
    try{
      const next=await inviteRequest<Invitation>(item?`/invitations/${item.id}/refresh`:'/invitations',session,item?{requestId:refreshId.current}:{requestId:createId.current,projectId,organizationId,role});
      setItem(next);refreshId.current=crypto.randomUUID();
    }catch(e){setError(invitationError(e));}finally{setBusy(false);}
  }
  async function copy(){try{await navigator.clipboard.writeText(link);setCopied(true);}catch{setError('Не удалось скопировать автоматически. Выделите ссылку и скопируйте её.');}}
  return <Dialog title={role==='worker'?'Пригласить работника':'Пригласить прораба'} onClose={onClose}>
    <p className="quiet">Отправьте личную ссылку одному человеку. Он укажет имя, почту и пароль и сразу получит доступ.</p>
    {item?<><label className="field"><span>Ссылка приглашения</span><input readOnly value={link} onFocus={e=>e.target.select()}/></label><p>Код: <strong className="invite-code">{item.code}</strong></p><p className="quiet">Действует до {new Date(item.expiresAt).toLocaleString('ru-RU')}. Один вход по приглашению. Обновление отключит старую ссылку.</p><button className="fill" onClick={()=>void copy()}>{copied?'Скопировано':'Копировать'}</button></>:null}
    {error?<p role="alert">{error}</p>:null}
    <button className={item?'ghost':'fill'} disabled={busy||!projectId||!organizationId} onClick={()=>void issue()}>{busy?'Создаём…':item?'Обновить код':'Создать ссылку'}</button>
    <button className="ghost" onClick={onClose}>Закрыть</button>
  </Dialog>;
}
export function InvitationList({session,projectId,role}:{session:Session;projectId:string;role:'worker'|'master'}){
  const [items,setItems]=useState<Invitation[]>([]),[members,setMembers]=useState<{id:string;name:string;role:string}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState('');
  const retries=useRef(new Map<string,string>());
  async function load(){try{const r=await inviteRequest<{items:Invitation[];members:typeof members}>(`/projects/${projectId}/invitations`,session);setItems(r.items);setMembers(r.members);setError('');}catch(e){setError(invitationError(e));}}
  useEffect(()=>{void load();const focus=()=>void load();window.addEventListener('focus',focus);const t=setInterval(focus,15000);return()=>{window.removeEventListener('focus',focus);clearInterval(t);};},[projectId,session.token]);
  async function rotate(item:Invitation){if(busy)return;setBusy(item.id);setNotice('');try{if(!retries.current.has(item.id))retries.current.set(item.id,crypto.randomUUID());await inviteRequest(`/invitations/${item.id}/refresh`,session,{requestId:retries.current.get(item.id)});retries.current.delete(item.id);await load();setNotice('Старая ссылка отключена. Новая — в списке.');}catch(e){setError(invitationError(e));}finally{setBusy(null);}}
  async function copy(code:string){try{await navigator.clipboard.writeText(`${location.origin}/join/${code}`);setNotice('Ссылка скопирована.');}catch{setError('Выделите ссылку и скопируйте её вручную.');}}
  const active=items.filter(i=>i.role===role&&i.status==='active');
  return <section className="panel invite-list" aria-label="Приглашения"><div className="panel-tools"><h2>Приглашения</h2><button className="ghost" onClick={()=>void load()}>Обновить список</button></div>
    {role==='master'&&members.some(m=>m.role==='master')?<div><h3>Прорабы с доступом</h3>{members.filter(m=>m.role==='master').map(m=><p key={m.id}>{m.name} · Доступ открыт</p>)}</div>:null}
    {!active.length?<p className="quiet">Нет неиспользованных приглашений.</p>:active.map(i=><article className="invite-row" key={i.id}><label className="field"><span>Код {i.code}</span><input readOnly value={`${location.origin}/join/${i.code}`} onFocus={e=>e.target.select()}/></label><div className="panel-tools"><button className="ghost" onClick={()=>void copy(i.code!)}>Копировать</button><button className="ghost" disabled={busy!==null} onClick={()=>void rotate(i)}>{busy===i.id?'Обновляем…':'Обновить код'}</button></div></article>)}
    {items.filter(i=>i.role===role&&i.status==='used').slice(0,5).map(i=><p className="quiet" key={i.id}>✓ {i.acceptedName} — приглашение использовано</p>)}
    {notice?<p role="status">{notice}</p>:null}{error?<p role="alert">{error}</p>:null}
  </section>;
}
export function JoinPage({code,onEntered}:{code:string;onEntered:(s:Session)=>void}){
  const [info,setInfo]=useState<{role:string;projectName:string}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[terminal,setTerminal]=useState(false);
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
  useEffect(()=>{let active=true;setLoading(true);void inviteRequest<{role:string;projectName:string}>(`/join/${encodeURIComponent(code)}`,null).then(v=>{if(active){setInfo(v);setError('');}}).catch(e=>{if(active){setError(invitationError(e));setTerminal(true);}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[code]);
  async function submit(){if(busy)return;setBusy(true);setError('');try{
    const r=await inviteRequest<{token:string;user:{id:string;name:string;email:string};memberships:{tenant_id:string;role:string}[]}>(`/join/${encodeURIComponent(code)}`,null,{name,email,password});
    const m=r.memberships[0];const s:Session={token:r.token,userId:r.user.id,name:r.user.name,email:r.user.email,tenantId:m.tenant_id,role:m.role};saveSession(s);history.replaceState(null,'','/');onEntered(s);
  }catch(e){setError(invitationError(e));if(e instanceof Error&&['invitation_used','invitation_revoked','invitation_expired'].includes(e.message))setTerminal(true);}finally{setBusy(false);}}
  return <main className="login"><form onSubmit={e=>{e.preventDefault();void submit();}}><Mark/><h1>Добро пожаловать</h1>
    {loading?<p role="status">Проверяем приглашение…</p>:info&&!terminal?<><p className="quiet">{info.projectName} · {info.role==='worker'?'Кабинет работника':'Кабинет прораба'}</p><label className="field"><span>Имя и фамилия</span><input autoComplete="name" required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label className="field"><span>Электронная почта</span><input type="email" autoComplete="username" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="field"><span>Пароль</span><input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><p className="quiet">Минимум 10 символов. Почта станет вашим логином; письмо не отправляется.</p><button className="fill" disabled={busy} type="submit">{busy?'Создаём аккаунт…':'Войти'}</button></>:null}
    {error?<p role="alert">{error}</p>:null}<a className="quiet" href="/">Уже есть аккаунт? Войти</a>
  </form></main>;
}
