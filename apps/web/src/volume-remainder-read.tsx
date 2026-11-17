import type {Session} from './api';
import {amount} from './model';
import {InternalInspection} from './internal-inspection';
type Entry={id:string;version:number;action:string;presentedQuantity:string;acceptedQuantity:string|null;acceptedPartId:string|null;reason:string|null;actorName:string;createdAt:string};
export type RemainderRead={remainingQuantity:string;history:Entry[];presentation:Entry|null};
export function VolumeRemainderRead({session,projectId,unit,total,row}:{session:Session;projectId:string;unit:string;total:string;row:RemainderRead}){
 return <section className="panel">
  <h3>Остаток объёма</h3>
  <p role="status">Режим возврата: новые предъявления и решения по остатку временно выключены. Сохранённые части и их приёмка доступны.</p>
  <p>Принято всего: {amount(total)} {unit}. Осталось: {amount(row.remainingQuantity)} {unit}.</p>
  {row.presentation?<p>Предъявлен остаток {amount(row.presentation.presentedQuantity)} {unit}. Решение можно продолжить после восстановления основной версии.</p>:null}
  {row.history.length?<details><summary>История остатка · {row.history.length}</summary><ol>{row.history.map(event=><li key={event.version}><p>{event.action==='present'?`Предъявлено ${amount(event.presentedQuantity)}`:`Принято ${amount(event.acceptedQuantity??'0')}`} {unit} · {event.actorName}</p>{event.reason?<p>{event.reason}</p>:null}<p className="quiet">{new Date(event.createdAt).toLocaleString('ru-RU')}</p></li>)}</ol></details>:null}
  {row.history.filter(event=>event.acceptedPartId).map(event=><details key={event.id}><summary>ПТО: часть {amount(event.acceptedQuantity!)} {unit}</summary><InternalInspection session={session} projectId={projectId} partId={event.acceptedPartId!}/></details>)}
 </section>;
}
