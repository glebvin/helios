export type Session = {
  token: string;
  userId: string;
  name: string;
  email: string;
  tenantId: string;
  role: string;
};

export type Desk = {
  actor: { role: string; name: string };
  projectId: string;
  cabinet: { name: string };
  organizations: { id: string; name: string; kind: string }[];
  projects: { id: string; name: string; address: string; latitude: number | null; longitude: number | null }[];
  files: { id: string; filename: string }[];
  employees: { id: string; full_name: string; phone: string; user_id: string | null; document_number?: string | null; role?: string | null }[];
  tasks: {
    id: string;
    title: string;
    work_date: string;
    planned_quantity: string;
    unit: string;
    assignee_employee_id: string;
    status: string;
  }[];
  shifts: { id: string; task_id: string; employee_id?: string; status: string; started_at?: string | null; finished_at?: string | null; clock_requires_review: boolean }[];
  reports: { id: string; task_id: string; submitted_quantity: string; accepted_quantity: string | null }[];
  summary: {
    sample: boolean;
    label: string;
    rings: { label: string; current: number; target: number; unit: string }[];
    live: { tasksToday: number; openShifts: number };
  };
};

const sessionKey = "helios.session";

export function loadSession(): Session | null {
  const raw = localStorage.getItem(sessionKey);
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value.token === 'string' && typeof value.tenantId === 'string' && typeof value.role === 'string' ? value as Session : null;
  } catch { localStorage.removeItem(sessionKey); return null; }
}

export function saveSession(session: Session | null) {
  if (!session) localStorage.removeItem(sessionKey);
  else localStorage.setItem(sessionKey, JSON.stringify(session));
}

async function request<T>(path: string, session: Session | null, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (session) {
    headers.set("authorization", `Bearer ${session.token}`);
    headers.set("x-tenant-id", session.tenantId);
  }
  const response = await fetch(path, { ...init, headers });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "request_failed");
  return body;
}

export async function login(email: string, password: string): Promise<Session> {
  const body = await request<{
    token: string;
    user: { id: string; name: string; email: string };
    memberships: { tenant_id: string; role: string; status?: string }[];
  }>("/api/v1/auth/login", null, { method: "POST", body: JSON.stringify({ email, password }) });
  const membership = body.memberships.find((item) => !("status" in item) || item.status === "active") ?? body.memberships[0];
  if (!membership) throw new Error("tenant_denied");
  const session = {
    token: body.token,
    userId: body.user.id,
    name: body.user.name,
    email: body.user.email,
    tenantId: membership.tenant_id,
    role: membership.role,
  };
  saveSession(session);
  return session;
}

export const desk = (session: Session) => request<Desk>("/api/desk", session);
export type NewTask = {
  title: string;
  organizationId: string;
  projectId: string;
  zone: string;
  employeeId: string;
  crewId: string;
  plannedQuantity: string;
  unit: string;
  workDate: string;
  needsHiddenAct: boolean;
  drawingCipher: string;
  drawingSheets: string;
  lotId: string;
};

export const createTask = (session: Session, input: NewTask) =>
  request<{ id: string }>("/api/tasks", session, { method: "POST", body: JSON.stringify(input) });
export const syncEvents = (session: Session, events: unknown[]) =>
  request("/api/sync/events", session, { method: "POST", body: JSON.stringify({ events }) });
export const acceptReport = (session: Session, id: string, acceptedQuantity: string) =>
  request(`/api/reports/${id}/accept`, session, { method: "POST", body: JSON.stringify({ acceptedQuantity }) });
export const savePlace = (
  session: Session,
  projectId: string,
  place: { address: string; latitude: number; longitude: number },
) => request(`/api/projects/${projectId}/place`, session, { method: "POST", body: JSON.stringify(place) });
