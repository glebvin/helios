import { useState } from "react";
import { useBook, type Lot } from "./book";
import { DeskBadge, DeskEmpty } from "./kit";

export function Materials({ canEdit }: { canEdit: boolean }) {
  return (
    <section className="page">
      <div>
        <h1>Материалы</h1>
        <p className="sub">Черновик поставки. Завершённый входной контроль по маршруту 2.2 пока не реализован, поэтому поставка в задание не выбирается.</p>
      </div>
      <Lots canEdit={canEdit} />
    </section>
  );
}

function Lots({ canEdit }: { canEdit: boolean }) {
  const { book, update } = useBook();
  const [name, setName] = useState("");
  const [batch, setBatch] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <h2>Поставки</h2>
      {book.lots.length === 0 ? <DeskEmpty title="Поставок нет" description="Добавьте материал, который приехал на объект. Отклонённый в задание не попадает." /> : (
        <ul className="permit">
          {book.lots.map((lot) => (
            <li key={lot.id}>
              <span>{lot.name}{lot.batch ? ` · ${lot.batch}` : ""}</span>
              <DeskBadge tone={lot.result === "accepted" ? "done" : lot.result === "rejected" ? "warn" : "neutral"}>{lot.result === "accepted" ? "принята" : lot.result === "rejected" ? "отклонена" : "ожидает контроль"}</DeskBadge>
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form className="person-note" onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) { setError("Напишите, что приехало."); return; }
          const lot: Lot = { id: crypto.randomUUID(), name: name.trim(), batch: batch.trim(), result: "recorded" };
          update((item) => ({ ...item, lots: [lot, ...item.lots] }));
          setName("");
          setBatch("");
          setError("");
        }}>
          <div className="pair-fields">
            <label className="field"><span>Что приехало</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field"><span>Номер поставки</span><input value={batch} onChange={(event) => setBatch(event.target.value)} /></label>
          </div>
          <p className="quiet">Запись — черновик в браузере этого входа. Результат входного контроля здесь не ставится.</p>
          {error ? <p role="alert">{error}</p> : null}
          <button className="fill" type="submit">Добавить поставку</button>
        </form>
      ) : <p className="quiet person-note">Добавить поставку от этого просмотра нельзя: запись пошла бы на текущий вход.</p>}
    </section>
  );
}
