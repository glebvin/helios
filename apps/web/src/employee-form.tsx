import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { DeskSelect } from "./kit";
import { canWriteStaff, staffBody, staffDraft, staffWriteError, type StaffOrg } from "./staff-form";
import type { ServerEmployee } from "./staff-list";
import { ApiError, v1 } from "./v1";

export function EmployeeForm({
  session, organizations, employee, onSaved, onReload,
}: {
  session: Session;
  organizations: StaffOrg[];
  employee: ServerEmployee | null;
  onSaved: (row: ServerEmployee) => void;
  onReload?: () => void;
}) {
  const [draft, setDraft] = useState(() => staffDraft(employee, organizations));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const request = useRef({ id: "", key: "" });
  const orgKey = organizations.map((item) => item.id).join();
  useEffect(() => {
    setDraft(staffDraft(employee, organizations));
    setError("");
  }, [employee?.id, employee?.version, employee?.fullName, employee?.phone, employee?.status, orgKey]);
  if (!canWriteStaff(session.role)) return null;
  const archived = employee?.status === "archived";
  const ready = Boolean(draft.fullName.trim() && draft.organizationId);

  async function submit() {
    if (saving || archived || !ready) return;
    const key = JSON.stringify(staffBody(draft, employee, ""));
    if (request.current.key !== key) request.current = { id: crypto.randomUUID(), key };
    const body = staffBody(draft, employee, request.current.id);
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const row = await v1<ServerEmployee>(session, employee ? `/employees/${employee.id}` : "/employees", body, employee ? "PUT" : "POST");
      setSaved(`Сервер записал «${row.fullName}».`);
      onSaved(row);
    } catch (reason) {
      const status = reason instanceof ApiError ? reason.status : null;
      const code = reason instanceof ApiError ? reason.message : "";
      setError(staffWriteError(status, code));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="field"><span>Имя</span><input value={draft.fullName} maxLength={200} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></label>
      <label className="field"><span>Телефон</span><input value={draft.phone} maxLength={500} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
      {organizations.length > 0 ? (
        <DeskSelect label="Организация" value={draft.organizationId} options={organizations.map((item) => ({ value: item.id, label: item.name }))} onChange={(organizationId) => setDraft({ ...draft, organizationId })} />
      ) : <p className="quiet">В кабинете нет организации, поэтому запись некуда привязать.</p>}
      {employee ? (
        <DeskSelect label="Состояние" value={draft.status} options={[{ value: "active", label: "Работает" }, { value: "archived", label: "В архиве" }]} onChange={(status) => setDraft({ ...draft, status: status === "archived" ? "archived" : "active" })} />
      ) : null}
      {draft.status === "archived" ? <p className="quiet">Архив снимает назначение на объекты. Это произойдёт только после ответа сервера.</p> : null}
      {archived ? <p className="quiet">Архивную карточку сервер не принимает к правке.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {error && onReload ? <button className="ghost" type="button" onClick={onReload}>Прочитать карточку</button> : null}
      {saved ? <p className="quiet">{saved}</p> : null}
      <button className="fill" type="submit" disabled={saving || archived || !ready}>{saving ? "Записываем на сервере…" : employee ? "Сохранить на сервере" : "Создать на сервере"}</button>
    </form>
  );
}
