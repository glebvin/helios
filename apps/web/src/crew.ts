export type CrewAdmission = { eligible: boolean; reasons: string[] };
export type CrewMember = { employeeId: string; status: "active" | "revoked"; version: number; currentAdmission: CrewAdmission };
export type Crew = { id: string; projectId: string; name: string; version: number; members: CrewMember[] };
export type CrewAssignment = { employeeId: string; status: "active" | "revoked"; currentAdmission: CrewAdmission };

export function memberFacts(status: "active" | "revoked", eligible: boolean) {
  return {
    membership: status === "active" ? "В составе" : "Снят",
    admission: eligible ? "Допуск актуален" : "Допуск не актуален",
  };
}

export function memberVersion(members: CrewMember[], employeeId: string) {
  return members.find((member) => member.employeeId === employeeId)?.version ?? 0;
}

export function addable(assignments: CrewAssignment[], crews: Crew[]) {
  const busy = new Set(crews.flatMap((crew) => crew.members.filter((member) => member.status === "active").map((member) => member.employeeId)));
  return assignments.filter((row) => row.status === "active" && row.currentAdmission.eligible && !busy.has(row.employeeId));
}

export function crewError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Состав бригады меняет руководитель проекта.";
  if (status === 404) return "Бригада или сотрудник этому входу не видны.";
  if (status === 409 && code === "stale_version") return "Состав уже изменён в другом окне. Повторите после чтения.";
  if (status === 409 && code === "crew_conflict") return "Человек уже в другой бригаде этого объекта. Сначала снимите его там.";
  if (status === 409) return "Команда разошлась с сервером. Перечитайте состав.";
  if (status === 422 && code === "admission_required") return "В состав нужен действующий допуск и назначение. Доступ к объекту сам по себе состав не даёт.";
  if (status === 422) return "Сотрудник или назначение не подходят для состава.";
  if (status === 400) return "Сервер не принял название или команду.";
  return "Состав прочитать не удалось.";
}
