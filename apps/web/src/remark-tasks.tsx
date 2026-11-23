import { useState } from "react";
import type { Session } from "./api";
import { DeskBadge } from "./kit";
import { useServerRead } from "./server-read";
import { ApiError, v1 } from "./v1";

export type RemarkTask = {
  id: string;
  remarkId: string;
  acceptedPartId: string;
  body: string;
  dueOn: string;
  closedAt: string | null;
};

function explain(reason: unknown) {
  const status = reason instanceof ApiError ? reason.status : 0;
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этому входу замечания недоступны.";
  if (status === 404) return "Объект этому входу недоступен.";
  return "Нет подтверждения сервера. Повторите чтение.";
}

export function MyRemarkTasks({ session, projectId, notice }: { session: Session; projectId: string; notice: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const read = useServerRead(session, `${projectId}:remark-tasks`, notice || (!projectId ? "Объект не подтверждён." : ""), () => v1<{ items: RemarkTask[] }>(session, `/projects/${projectId}/customer-remark-tasks`), explain);
  if (notice || !projectId) return null;
  if (read.loading) return <p className="quiet task-hold" role="status">Читаем замечания…</p>;
  if (read.error) return <p role="alert">{read.error} <button className="ghost desk-action" type="button" onClick={read.retry}>Повторить чтение</button></p>;
  const items = read.body?.items ?? [];
  const selected = items.find((item) => item.id === open);
  if (selected) return (
    <article className="job">
      <button className="ghost desk-action" type="button" onClick={() => setOpen(null)}>К делам</button>
      <h2>{selected.body}</h2>
      <p className="quiet">Срок {selected.dueOn}. {selected.closedAt ? "Закрыто." : "Открыто."} Закрытие не удаляет задачу.</p>
    </article>
  );
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => (
        <article className="job" key={item.id}>
          <div className="rowline">
            <h2>{item.body}</h2>
            <DeskBadge tone={item.closedAt ? "neutral" : "warn"}>{item.closedAt ? "Закрыто" : "Открыто"}</DeskBadge>
          </div>
          <p className="quiet">Срок {item.dueOn}</p>
          <button className="ghost desk-action" type="button" onClick={() => setOpen(item.id)}>К замечанию</button>
        </article>
      ))}
    </>
  );
}
