import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { DeskSelect } from "./kit";
import { canWriteStaff, staffBody, staffDraft, staffRequest, staffWriteError, type StaffOrg } from "./staff-form";
import type { ServerEmployee } from "./staff-list";
import { ApiError, v1 } from "./v1";

export function EmployeeForm({
  session, organizations, employee, onSaved,
}: {
  session: Session;
  organizations: StaffOrg[];
  employee: ServerEmployee | null;
  onSaved: (row: ServerEmployee) => void;
}) {
  const [source, setSource] = useState(employee);
  const [draft, setDraft] = useState(() => staffDraft(employee, organizations));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const request = useRef({ id: "", key: "" });
  const busy = useRef(false);
  const [retryStored, setRetryStored] = useState(true);
  const pendingKey = `helios.staff-create:${session.tenantId}:${session.userId}`;
  useEffect(() => {
    // Background reads must not overwrite a draft or silently advance its expectedVersion.
    setSource(employee);
    setDraft(staffDraft(employee, organizations));
    setError("");
    setSaved("");
    request.current = { id: "", key: "" };
  }, [employee?.id, session.tenantId, session.userId]);
  if (!canWriteStaff(session.role)) return null;
  const archived = employee?.status === "archived";
  const ready = Boolean(draft.fullName.trim() && draft.organizationId);

  async function submit() {
    if (busy.current || archived || !ready) return;
    const key = JSON.stringify(staffBody(draft, source, ""));
    if (!source && !request.current.id) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
        if (stored && typeof stored.id === "string" && typeof stored.key === "string") request.current = stored;
      } catch { /* The in-memory command can still be retried in this form. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    if (!source) {
      try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setRetryStored(true); }
      catch { setRetryStored(false); }
    }
    const body = staffBody(draft, source, request.current.id);
    busy.current = true;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const row = await v1<ServerEmployee>(session, source ? `/employees/${source.id}` : "/employees", body, source ? "PUT" : "POST");
      if (source) { setSource(row); setDraft(staffDraft(row, organizations)); }
      else { try { sessionStorage.removeItem(pendingKey); } catch { /* Confirmed response is authoritative. */ } }
      setSaved(`Сервер записал «${row.fullName}».`);
      onSaved(row);
    } catch (reason) {
      const status = reason instanceof ApiError ? reason.status : null;
      const code = reason instanceof ApiError ? reason.message : "";
      setError(staffWriteError(status, code));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function readCard() {
    if (!employee || busy.current) return;
    busy.current = true; setSaving(true);
    try {
      const row = await v1<ServerEmployee>(session, `/employees/${employee.id}`);
      setSource(row); setDraft(staffDraft(row, organizations)); setError(""); setSaved(""); onSaved(row);
    } catch (reason) { setError(staffWriteError(reason instanceof ApiError ? reason.status : null)); }
    finally { busy.current = false; setSaving(false); }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset className="employee-fields" disabled={saving || archived}>
      <label className="field"><span>Имя</span><input value={draft.fullName} maxLength={200} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></label>
      <label className="field"><span>Телефон</span><input value={draft.phone} maxLength={500} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
      {organizations.length > 0 ? (
        <DeskSelect label="Организация" value={draft.organizationId} options={[{ value: "", label: "Выберите организацию" }, ...organizations.map((item) => ({ value: item.id, label: item.name }))]} onChange={(organizationId) => setDraft({ ...draft, organizationId })} />
      ) : <p className="quiet">В кабинете нет организации, поэтому запись некуда привязать.</p>}
      {employee ? (
        <DeskSelect label="Состояние" value={draft.status} options={[{ value: "active", label: "Работает" }, { value: "archived", label: "В архиве" }]} onChange={(status) => setDraft({ ...draft, status: status === "archived" ? "archived" : "active" })} />
      ) : null}
      {draft.status === "archived" ? <p className="quiet">Архив снимает назначение на объекты. Это произойдёт только после ответа сервера.</p> : null}
      {archived ? <p className="quiet">Архивную карточку сервер не принимает к правке.</p> : null}
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      {error && employee ? <button className="ghost" type="button" disabled={saving} onClick={() => void readCard()}>Прочитать карточку</button> : null}
      {error && !retryStored ? <p className="quiet">Браузер не сохранил номер попытки. Повторите в этой форме, не закрывая её.</p> : null}
      {saved ? <p className="quiet">{saved}</p> : null}
      <button className="fill" type="submit" disabled={saving || archived || !ready}>{saving ? "Записываем на сервере…" : employee ? "Сохранить на сервере" : "Создать на сервере"}</button>
    </form>
  );
}
