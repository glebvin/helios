import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { motion } from "motion/react";
import type { Session } from "./api";
import { Flash } from "./flash";
import { DeskEmpty } from "./kit";
import { NoteMark } from "./note-mark";
import { ApiError, v1 } from "./v1";
import { idSetError, titlesOf } from "./id-set";

type Item = { workTypeId: string; name: string; unit: string; version: number; titles: string[] };

export function IdSetPanel({ session, projectId }: { session: Session; projectId: string }) {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [pass, setPass] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const current = items?.find((item) => item.workTypeId === selected) ?? null;
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void v1<{ items: Item[] }>(session, `/projects/${projectId}/id-sets`).then((body) => {
      if (!live) return;
      setItems(body.items);
      setSelected((value) => body.items.some((item) => item.workTypeId === value) ? value : body.items[0]?.workTypeId ?? "");
      setError("");
    }).catch((reason: unknown) => {
      if (!live) return;
      setItems([]);
      setError(reason instanceof ApiError ? idSetError(reason.status, reason.message) : "Нет подтверждения сервера. Повторите чтение.");
    });
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, pass]);
  useEffect(() => { setDraft(current ? current.titles.join("\n") : ""); }, [current?.workTypeId, current?.version]);
  if (!projectId) return <section className="panel" aria-label="Комплект"><h2>Комплект</h2><p>Сначала подтвердите объект в шапке кабинета.</p></section>;
  return <section className="panel" aria-label="Комплект">
    <div className="panel-head">
      <h2>Комплект <NoteMark label="Что это"><p>Названия документов, которые требуются виду работ. Это ещё не реестр подписанных документов и не долг по принятой части.</p></NoteMark></h2>
    </div>
    {items === null && !error ? <p className="quiet task-hold" role="status">Читаем виды работ…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {items && items.length === 0 ? <DeskEmpty title="Видов работ нет" description="Комплект появится после того, как руководитель добавит вид работ на объекте." /> : null}
    {items && items.length > 0 ? <div className="sheet-split">
      <ul className="check-reasons">
        {items.map((item) => <li key={item.workTypeId}>
          <button className={item.workTypeId === selected ? "ghost desk-action is-on" : "ghost desk-action"} type="button" aria-pressed={item.workTypeId === selected} onClick={() => setSelected(item.workTypeId)}>{item.name}</button>
          <span className="quiet">{item.version === 0 ? "Комплект не записан" : `Версия ${item.version}`}</span>
        </li>)}
      </ul>
      {current ? <motion.div key={`${current.workTypeId}:${current.version}`} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0, duration: reduce ? 0 : 0.26 }}>
        <p><b>{current.name}</b> <span className="quiet">{current.unit}</span></p>
        {current.version === 0 ? <p className="quiet">Комплект этого вида ещё не записан. Пока записи нет, долг по документам этого вида не считается.</p> : null}
        {current.version > 0 && current.titles.length === 0 ? <p>Для этого вида записано, что отдельных документов нет.</p> : null}
        {current.titles.length > 0 ? <ul>{current.titles.map((title) => <li key={title}>{title}</li>)}</ul> : null}
        {session.role === "engineer-pto" ? <form onSubmit={(event) => { event.preventDefault(); void save(current); }}>
          <label className="field"><span>Названия, каждое с новой строки</span><textarea aria-label="Названия документов" value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} /></label>
          <button className="fill desk-action" type="submit" disabled={busy}>{busy ? "Записываем…" : "Записать комплект"}</button>
        </form> : <p className="quiet">Запись доступна инженеру ПТО.</p>}
      </motion.div> : null}
    </div> : null}
    <Flash message={saved} pulse={pulse} />
  </section>;

  async function save(item: Item) {
    if (lock.current) return;
    const titles = titlesOf(draft);
    lock.current = true;
    setBusy(true);
    setSaved("");
    const identity = `helios.id-set:${session.tenantId}:${session.userId}:${item.workTypeId}:${item.version}:${JSON.stringify(titles)}`;
    const requestId = sessionStorage.getItem(identity) ?? crypto.randomUUID();
    try { sessionStorage.setItem(identity, requestId); } catch { /* The same open form still repeats this attempt. */ }
    try {
      await v1(session, `/projects/${projectId}/work-types/${item.workTypeId}/id-set`, { requestId, expectedVersion: item.version, titles });
      try { sessionStorage.removeItem(identity); } catch { /* The server answer is enough. */ }
      setSaved("Сервер записал комплект.");
      setPulse((value) => value + 1);
      setPass((value) => value + 1);
    } catch (reason) {
      setSaved("");
      setError(reason instanceof ApiError ? idSetError(reason.status, reason.message) : "Нет подтверждения сервера. Повторите ту же запись.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
}
