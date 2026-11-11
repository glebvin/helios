import type { Desk } from "./api";

export const hasV1ProjectScope = (role: string) => ["director", "master", "worker", "pto"].includes(role);

export function projectDesk(data: Desk, projectId: string): Desk {
  const tasks = data.tasks.filter((task) => task.project_id === projectId);
  const ids = new Set(tasks.map((task) => task.id));
  return { ...data, projectId, projects: data.projects.filter((project) => project.id === projectId), tasks,
    shifts: data.shifts.filter((shift) => ids.has(shift.task_id)),
    reports: data.reports.filter((report) => ids.has(report.task_id)) };
}

export type ServerActor = {
  userId: string;
  tenantId: string;
  role: string;
  name: string;
  email: string;
};

export type ServerProject = { id: string; name: string };

export function chosenProject(projects: ServerProject[], selected: string, total = projects.length) {
  if (total === 1 && projects.length === 1) return projects[0]?.id ?? "";
  if (selected && projects.some((item) => item.id === selected)) return selected;
  return "";
}

export function projectLabel(projects: ServerProject[], selected: string, total = projects.length) {
  const id = chosenProject(projects, selected, total);
  return projects.find((item) => item.id === id)?.name ?? "";
}

export function civilLabel(day: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
}

export function scopeNotice(input: { loading: boolean; error: string; projects: ServerProject[]; total: number; selected: string; day: string }) {
  if (input.loading) return "Читаем вход, объект и день на сервере.";
  if (input.error) return input.error;
  if (input.total > input.projects.length) return "Сервер отдал не весь список объектов. Выбор по неполной странице не делается.";
  if (input.projects.length === 0) return "Этому входу сервер не показал ни одного объекта. Для работника нужно ещё назначение.";
  if (!chosenProject(input.projects, input.selected, input.total)) return "Объектов несколько. Выберите один: первый в списке сам не подставляется.";
  if (!input.day) return "Сервер не назвал рабочий день.";
  return "";
}

export function sameActor(session: { userId: string; tenantId: string; role: string }, actor: ServerActor) {
  return session.userId === actor.userId && session.tenantId === actor.tenantId && session.role === actor.role;
}
