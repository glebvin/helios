import { useState } from "react";
import type { Desk } from "./api";
import { useBook } from "./book";
import { DeskBadge, DeskCrumbs, DeskEmpty, DeskTimeline, FluidTabs, SmoothButton, StatGrid } from "./kit";
import { amount, personName } from "./model";

type Tab = "registry" | "missing" | "signing" | "sent";

export function Documents({ data, canConfirm, canDraft = false, checklistNote = false }: { data: Desk; canConfirm: boolean; canDraft?: boolean; checklistNote?: boolean }) {
  const { book, update } = useBook();
  const drafts = draftsOf(data, book);
  const missing = drafts.filter((item) => !item.act || !item.fact.cipher);
  const signing = drafts.filter((item) => item.fact.cipher && item.act && !item.act.sent);
  const sent = drafts.filter((item) => item.act?.sent);
  const ready = drafts.filter((item) => item.act?.confirmed).length;
  const [tab, setTab] = useState<Tab>("registry");
  const [openId, setOpenId] = useState<string | null>(null);
  const file = data.files.find((item) => item.id === openId) ?? null;
  if (file) return <FileCard name={file.filename} onBack={() => setOpenId(null)} />;

  return (
    <section className="page">
      <div className="passport-head">
        <div>
          <h1>Акты</h1>
          <p className="sub">Скрытая работа, которую потом закроют. Такой акт называется АОСР. Черновик собирается из принятого задания.</p>
          {checklistNote ? <p className="quiet">Перечень ИД пока не реализован.</p> : null}
          <p className="quiet">Подпись и передача акта пока не реализованы. Черновик, если он собран, остаётся в браузере.</p>
        </div>
        {data.files.length > 0 ? <SmoothButton tone="ghost" onClick={() => save(data.files.map((item) => item.filename))}>Выгрузить реестр</SmoothButton> : null}
      </div>
      <StatGrid items={[
        { value: String(data.files.length), label: "файлов" },
        { value: String(signing.length), label: "на подписи" },
        { value: String(sent.length), label: "передано" },
        { value: drafts.length === 0 ? "—" : `${ready} из ${drafts.length}`, label: "готовность ИД" },
      ]} />
      <FluidTabs
        name="document-tabs"
        label="Акты"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: "registry", label: "Реестр" },
          { id: "missing", label: "Не хватает" },
          { id: "signing", label: "На подписи" },
          { id: "sent", label: "Передано" },
        ]}
      />
      {tab === "registry" ? <Registry files={data.files} onOpen={setOpenId} /> : null}
      {tab === "missing" ? <ActList items={missing} emptyTitle="Нехватки нет" emptyDescription="Сюда попадает принятая скрытая работа без шифра или без черновика." action={canDraft ? "Собрать черновик" : undefined} onAction={canDraft ? (taskId) => update((item) => ({ ...item, acts: { ...item.acts, [taskId]: item.acts[taskId] ?? { confirmed: false, sent: false } } })) : undefined} /> : null}
      {tab === "signing" ? <ActList items={signing} emptyTitle="На подписи пусто" emptyDescription="Черновик с шифром появится здесь. Подпись и передача пока не реализованы." action={canConfirm ? "Подтвердить" : undefined} second={canConfirm ? "Передать" : undefined} onAction={canConfirm ? (taskId) => update((item) => ({ ...item, acts: { ...item.acts, [taskId]: { confirmed: true, sent: false } } })) : undefined} onSecond={canConfirm ? (taskId) => update((item) => ({ ...item, acts: { ...item.acts, [taskId]: { confirmed: true, sent: true } } })) : undefined} /> : null}
      {tab === "sent" ? <ActList items={sent} emptyTitle="Передач нет" emptyDescription="Подтверждённый черновик попадает сюда после передачи." /> : null}
    </section>
  );
}

function draftsOf(data: Desk, book: ReturnType<typeof useBook>["book"]) {
  return data.tasks.flatMap((task) => {
    const fact = book.tasks[task.id];
    if (!fact?.needsHiddenAct) return [];
    const report = data.reports.find((item) => item.task_id === task.id && item.accepted_quantity);
    if (!report?.accepted_quantity) return [];
    return [{ task, fact, report, act: book.acts[task.id], who: personName(data, task.assignee_employee_id) }];
  });
}

function ActList({
  items, emptyTitle, emptyDescription, action, second, onAction, onSecond,
}: {
  items: ReturnType<typeof draftsOf>;
  emptyTitle: string;
  emptyDescription: string;
  action?: string;
  second?: string;
  onAction?: (taskId: string) => void;
  onSecond?: (taskId: string) => void;
}) {
  if (items.length === 0) return <DeskEmpty title={emptyTitle} description={emptyDescription} />;
  return (
    <div className="sheet-wrap">
      <table className="sheet">
        <thead>
          <tr><th>Работа</th><th>Шифр</th><th>Листы</th><th>Объём</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.task.id}>
              <td><b>{item.task.title}</b><div className="quiet">{item.who}</div></td>
              <td>{item.fact.cipher || "нет шифра"}</td>
              <td>{item.fact.sheets || "—"}</td>
              <td>{amount(item.report.accepted_quantity!)} {item.task.unit}</td>
              <td>
                {action && onAction && !item.act?.confirmed ? <button className="ghost" type="button" disabled={!item.fact.cipher} onClick={() => onAction(item.task.id)}>{item.fact.cipher ? action : "Нужен шифр"}</button> : null}
                {second && onSecond && item.act?.confirmed && !item.act.sent ? <button className="ghost" type="button" onClick={() => onSecond(item.task.id)}>{second}</button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="quiet person-note">Подтверждение остаётся в этом браузере. Это не электронная подпись, скана нет.</p>
    </div>
  );
}

function Registry({ files, onOpen }: { files: Desk["files"]; onOpen: (id: string) => void }) {
  if (files.length === 0) return <DeskEmpty title="Файлов нет" description="Скан или акт появится в реестре, когда его положат в кабинет." />;
  return (
    <div className="sheet-wrap">
      <table className="sheet">
        <thead>
          <tr><th>Документ</th><th>Работа</th><th>Ответственный</th><th>Статус</th></tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id} className="is-link" tabIndex={0} onClick={() => onOpen(file.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(file.id); }}>
              <td><b>{file.filename}</b></td>
              <td>—</td>
              <td>—</td>
              <td><DeskBadge>Файл</DeskBadge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileCard({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <section className="page">
      <DeskCrumbs items={[{ label: "Акты", onClick: onBack }, { label: name }]} />
      <div className="passport-head">
        <div>
          <h1>{name}</h1>
          <p className="sub">Запись файла. Акт по нему не собран.</p>
        </div>
        <DeskBadge>Файл</DeskBadge>
      </div>
      <div className="sheet-split">
        <section className="panel">
          <h2>Просмотр</h2>
          <DeskEmpty title="Лист не открывается" description="Кабинет хранит имя файла. Текст акта и пометку «черновик» он не рисует." />
        </section>
        <div className="stack">
          <section className="panel">
            <h2>Движение</h2>
            <DeskTimeline events={[{ id: "stored", title: "Файл в кабинете", detail: name, when: "дата не записана" }]} />
          </section>
          <section className="panel">
            <h2>Подписанный скан</h2>
            <p className="quiet person-note">Скана подписи нет.</p>
          </section>
        </div>
      </div>
    </section>
  );
}

function save(lines: string[]) {
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "reestr.txt";
  link.click();
  URL.revokeObjectURL(url);
}
