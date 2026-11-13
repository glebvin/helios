import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { DeskBadge, DeskEmpty } from "./kit";
import { civilLabel } from "./scope";
import { type ServerTask } from "./task-read";
import { ApiError, v1Collection } from "./v1";
import type { EvidenceFileRow } from "./evidence";
import { useServerRead } from "./server-read";

type Report = { reportId: string; taskId: string; employeeId: string; submittedQuantity: string; unit: string; acceptedQuantity: null };
type Page<T> = { items: T[]; total: number };

function readError(reason: unknown) {
  const status = reason instanceof ApiError ? reason.status : 0;
  if (status === 403) return "Этому входу эти записи недоступны.";
  if (status === 404) return "Объект этому входу недоступен.";
  if (status === 400) return "Сервер не принял день или объект.";
  return "Нет подтверждения сервера. Повторите чтение.";
}

function useRead<T>(session: Session, projectId: string, day: string, notice: string, load: (session: Session, projectId: string, day: string) => Promise<T>) {
  return useServerRead(session, `${projectId}:${day}`, notice || (!projectId || !day ? "Объект и день не подтверждены." : ""), () => load(session, projectId, day), readError);
}

export function PtoFacts({
  session, projectId, projectName, day, notice, onOpenSheet,
}: {
  session: Session;
  projectId: string;
  projectName: string;
  day: string;
  notice: string;
  onOpenSheet: () => void;
}) {
  const read = useRead(session, projectId, day, notice, async (current, project, date) => {
    const [reports, tasks] = await Promise.all([
      v1Collection<Report>(current, `/projects/${project}/execution/reports?day=${date}`),
      v1Collection<ServerTask>(current, `/projects/${project}/tasks`),
    ]);
    return { reports, tasks };
  });
  const titles = Object.fromEntries((read.body?.tasks.items ?? []).map((task) => [task.id, task.title]));
  return (
    <section className="page">
      <div>
        <h1>Приёмка</h1>
        <p className="sub">{notice || `${projectName} · ${civilLabel(day)}`}</p>
      </div>
      <p className="quiet">Приёмка качества не подключена. Отметка в браузере общий статус не меняет.</p>
      {notice ? <DeskEmpty title="День не подтверждён" description={notice} /> : null}
      {!notice && read.loading ? <p className="quiet task-hold" role="status">Читаем факты…</p> : null}
      {!notice && read.error ? <p role="alert">{read.error} <button className="ghost desk-action" type="button" onClick={read.retry}>Повторить чтение</button></p> : null}
      {!notice && read.body && read.body.reports.items.length === 0 ? <DeskEmpty title="За этот день сообщений нет" description="Пустой ответ не означает, что работу приняли или отклонили." /> : null}
      {!notice && read.body && read.body.reports.items.length > 0 ? (
        <div className="sheet-wrap">
          <table className="sheet facts-grid">
            <thead><tr><th>Работа</th><th>Сообщено</th><th>Приёмка</th></tr></thead>
            <tbody>
              {read.body.reports.items.map((row) => (
                <tr key={row.reportId}>
                  <td><b>{titles[row.taskId] ?? "Задание вне этой страницы"}</b></td>
                  <td>{row.submittedQuantity} {row.unit}</td>
                  <td><DeskBadge>не подключено</DeskBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {read.body && read.body.reports.total > read.body.reports.items.length ? <p className="quiet">Показаны первые {read.body.reports.items.length} из {read.body.reports.total}.</p> : null}
      <button className="ghost desk-action" type="button" onClick={onOpenSheet}>К табелю</button>
    </section>
  );
}

export function PtoFiles({
  session, projectId, projectName, day, notice,
}: {
  session: Session;
  projectId: string;
  projectName: string;
  day: string;
  notice: string;
}) {
  const context = JSON.stringify([session.token, session.tenantId, projectId]);
  const active = useRef(context);
  active.current = context;
  useEffect(() => { active.current = context; return () => { active.current = ""; }; }, [context]);
  const [fileState, setFileState] = useState({ context, opening: "", error: "" });
  const opening = fileState.context === context ? fileState.opening : "";
  const fileError = fileState.context === context ? fileState.error : "";
  const read = useRead(session, projectId, day, notice, (current, project) => v1Collection<EvidenceFileRow>(current, `/projects/${project}/evidence`));
  async function open(file: EvidenceFileRow) {
    setFileState({ context, opening: file.id, error: "" });
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/evidence/${file.id}/content`, {
        headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId },
      });
      if (active.current !== context) return;
      if (!response.ok) throw new ApiError(response.status, "");
      const blob = await response.blob();
      if (active.current !== context) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      if (active.current === context) setFileState({ context, opening: "", error: readError(reason) });
    } finally {
      if (active.current === context) setFileState((value) => ({ ...value, opening: "" }));
    }
  }
  return (
    <section className="page">
      <div>
        <h1>Акты</h1>
        <p className="sub">{notice || projectName}</p>
      </div>
      <p className="quiet">Здесь файлы, которые сервер уже хранит. Подпись и передача акта не подключены.</p>
      {notice ? <DeskEmpty title="Объект не подтверждён" description={notice} /> : null}
      {!notice && read.loading ? <p className="quiet task-hold" role="status">Читаем файлы…</p> : null}
      {!notice && read.error ? <p role="alert">{read.error} <button className="ghost desk-action" type="button" onClick={read.retry}>Повторить чтение</button></p> : null}
      {fileError ? <p role="alert">{fileError}</p> : null}
      {!notice && read.body && read.body.items.length === 0 ? <DeskEmpty title="Файлов нет" description="Сервер не отдал ни одного файла. Это не пустой акт и не принятая работа." /> : null}
      {!notice && read.body && read.body.items.length > 0 ? (
        <div className="sheet-wrap">
          <table className="sheet facts-grid">
            <thead><tr><th>Файл</th><th>Состояние</th><th></th></tr></thead>
            <tbody>
              {read.body.items.map((file) => (
                <tr key={file.id}>
                  <td><b>{file.filename}</b></td>
                  <td>{file.state === "ready" ? "На сервере" : "Ещё не дописан"}</td>
                  <td>{file.state === "ready" ? <button className="ghost desk-action" type="button" disabled={opening === file.id} onClick={() => void open(file)}>{opening === file.id ? "Открываем…" : "Скачать"}</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {read.body && read.body.total > read.body.items.length ? <p className="quiet">Показаны первые {read.body.items.length} из {read.body.total}.</p> : null}
    </section>
  );
}
