import { useEffect, useState } from "react";
import { acceptReport, createTask, desk, loadSession, login, saveSession, syncEvents, type Desk, type Session } from "./api";
import { DirectorDesk, type Section } from "./director";
import { WorkerPhone } from "./field";
import { todayKey } from "./model";
import { enqueue, pendingFor, readOutbox, writeOutbox, type OutboxEvent } from "./outbox";

const entries = [
  { role: "Руководитель", email: "director@pilot.helios", password: "pilot-director", hint: "Объект сегодня" },
  { role: "Прораб", email: "master@pilot.helios", password: "pilot-master", hint: "Задания и сдача" },
  { role: "Рабочий", email: "worker@pilot.helios", password: "pilot-worker", hint: "Моя смена" },
];

function explain(code: string) {
  const text: Record<string, string> = {
    unauthorized: "Неверная почта или пароль.",
    tenant_denied: "Сессия закончилась. Войдите снова.",
    role_denied: "Этой роли действие недоступно.",
    already_started: "Смена уже открыта.",
    invalid_shift_order: "Сначала начните смену.",
  };
  return text[code] ?? code;
}

function loadTheme(): "light" | "dark" {
  return localStorage.getItem("helios.theme") === "dark" ? "dark" : "light";
}

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [data, setData] = useState<Desk | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [section, setSection] = useState<Section>("overview");
  const [theme, setTheme] = useState<"light" | "dark">(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("helios.theme", theme);
  }, [theme]);

  async function refresh(next = session) {
    if (!next) return;
    const body = await desk(next);
    setData(body);
    setPending(pendingFor(next.tenantId, next.userId).length);
  }

  useEffect(() => {
    if (!session) return;
    void refresh(session).catch((reason: Error) => {
      if (reason.message === "unauthorized" || reason.message === "tenant_denied") {
        saveSession(null);
        setSession(null);
        setData(null);
      }
      setError(explain(reason.message));
    });
  }, [session]);

  async function flush(current: Session) {
    const events = pendingFor(current.tenantId, current.userId);
    if (!events.length) return;
    await syncEvents(current, events);
    const sent = new Set(events.map((event) => event.eventId));
    writeOutbox(
      current.tenantId,
      current.userId,
      readOutbox(current.tenantId, current.userId).map((item) => (sent.has(item.eventId) ? { ...item, status: "sent" as const } : item)),
    );
    setPending(0);
  }

  function queue(current: Session, event: Omit<OutboxEvent, "status" | "tenantId" | "userId" | "occurredAt" | "eventId">) {
    enqueue({
      ...event,
      eventId: crypto.randomUUID(),
      tenantId: current.tenantId,
      userId: current.userId,
      occurredAt: new Date().toISOString(),
      status: "pending",
    });
    setPending(pendingFor(current.tenantId, current.userId).length);
    void flush(current)
      .then(() => setError(""))
      .catch(() => setError("Нет связи. Событие осталось на этом телефоне."))
      .finally(() => void refresh(current));
  }

  async function enter(email: string, password: string) {
    try {
      const next = await login(email, password);
      setSession(next);
      setSection(email.startsWith("master@") ? "tasks" : "overview");
      setError("");
    } catch (reason) {
      setError(explain(reason instanceof Error ? reason.message : "Не удалось войти"));
    }
  }

  function switchRole(role: "director" | "master" | "worker") {
    const item = entries.find((entry) => entry.role === (role === "director" ? "Руководитель" : role === "master" ? "Прораб" : "Рабочий"));
    if (item) void enter(item.email, item.password);
  }

  function logout() {
    saveSession(null);
    setSession(null);
    setData(null);
  }

  if (!session) {
    return (
      <main className="login">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void enter(String(form.get("email")), String(form.get("password")));
          }}
        >
          <div className="wordmark">
            <span className="bars"><i /><i /><i /></span>
            <div><strong>HELIOS</strong><small>WORKFORCE</small></div>
          </div>
          <h1 style={{ fontSize: 32, letterSpacing: "-0.04em" }}>Кто входит</h1>
          <p className="sub">Один кабинет. У руководителя и прораба стол, у рабочего телефон.</p>
          {entries.map((item) => (
            <button className="role-pick" type="button" key={item.email} onClick={() => void enter(item.email, item.password)}>
              <strong>{item.role}</strong>
              <small>{item.hint}</small>
            </button>
          ))}
          <label className="field"><span>Почта</span><input name="email" defaultValue="director@pilot.helios" autoComplete="username" /></label>
          <label className="field"><span>Пароль</span><input name="password" type="password" defaultValue="pilot-director" autoComplete="current-password" /></label>
          {error ? <div className="alert">{error}</div> : null}
          <button className="fill" type="submit">Войти</button>
          <button className="ghost" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</button>
        </form>
      </main>
    );
  }

  if (!data) {
    return <main className="login"><p>{error || "Открываем кабинет"}</p></main>;
  }

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  if (session.role === "worker") {
    return (
      <WorkerPhone
        session={session}
        data={data}
        pending={pending}
        theme={theme}
        onTheme={toggleTheme}
        onLogout={logout}
        onRole={switchRole}
        onStart={(taskId, employeeId) => queue(session, { kind: "shift_start", payload: { taskId, employeeId } })}
        onEnd={(taskId) => queue(session, { kind: "shift_end", payload: { taskId } })}
        onSubmit={(taskId, quantity) => queue(session, { kind: "submit_volume", payload: { taskId, quantity } })}
      />
    );
  }

  const deskActions = {
    onStart: (taskId: string, employeeId: string) => queue(session, { kind: "shift_start" as const, payload: { taskId, employeeId } }),
    onSubmit: (taskId: string, quantity: string) => queue(session, { kind: "submit_volume" as const, payload: { taskId, quantity } }),
    onAccept: async (reportId: string) => {
      await acceptReport(session, reportId, "17");
      await refresh();
    },
    onCreate: async (title: string, employeeId: string) => {
      await createTask(session, { title, employeeId, plannedQuantity: "40", unit: "м²", workDate: todayKey() });
      await refresh();
    },
  };

  return (
    <>
      {error ? <div className="alert" style={{ margin: 12 }}>{error}</div> : null}
      <DirectorDesk
        session={session}
        data={data}
        section={section}
        onSection={setSection}
        theme={theme}
        onTheme={toggleTheme}
        onLogout={logout}
        onRole={switchRole}
        {...deskActions}
      />
    </>
  );
}
