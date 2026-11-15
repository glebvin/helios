import {JoinPage} from "./invitations";
import { useEffect, useRef, useState } from "react";
import { acceptReport, createTask, desk, loadSession, login, savePlace, saveSession, syncEvents, type Desk, type NewTask, type Session } from "./api";
import { bindRemoteClose, closeDelivery, openDelivery } from "./delivery";
import { clearShiftSnapshot, readShiftSnapshot, type ShiftSnapshot } from "./shift-snapshot";
import { DirectorDesk, type Section } from "./director";
import { BookProvider } from "./book";
import { WorkerPhone } from "./field";
import { Mark } from "./mark";
import { enqueue, pendingFor, readOutbox, writeOutbox, type OutboxEvent } from "./outbox";
import { PriceDesk } from "./prices";
import { accessOf, demoCabinets, homeView, type View } from "./roles";

const entries = [
  { account: "director" as const, role: "Руководитель", email: "director@pilot.helios", password: "pilot-director", hint: "Стол руководителя проекта" },
  { account: "master" as const, role: "Прораб", email: "master@pilot.helios", password: "pilot-master", hint: "Свой день на объекте" },
  { account: "worker" as const, role: "Рабочий", email: "worker@pilot.helios", password: "pilot-worker", hint: "Моя смена" },
];

function explain(code: string) {
  const text: Record<string, string> = {
    auth_rate_limited: "Слишком много попыток входа. Подождите минуту и повторите.",
    unauthorized: "Неверная почта или пароль.",
    tenant_denied: "Сессия закончилась. Войдите снова.",
    role_denied: "Этой роли действие недоступно.",
    already_started: "Смена уже открыта.",
    invalid_shift_order: "Сначала начните смену.",
    invalid_place: "Точка или адрес не подходят. Укажите место на карте.",
    not_found: "Объект не найден.",
  };
  return text[code] ?? code;
}

function offlineDesk(session: Session, saved: ShiftSnapshot): Desk {
  return {
    actor: { role: session.role, name: session.email },
    projectId: saved.projectId,
    cabinet: { name: saved.projectName },
    organizations: [],
    projects: [{ id: saved.projectId, name: saved.projectName, address: "", latitude: null, longitude: null }],
    files: [],
    employees: [],
    tasks: [],
    shifts: [],
    reports: [],
    summary: { sample: false, label: "", rings: [], live: { tasksToday: 0, openShifts: 0 } },
  };
}

function loadTheme(): "light" | "dark" {
  return localStorage.getItem("helios.theme") === "dark" ? "dark" : "light";
}

export function App() {
  const [joinCode,setJoinCode] = useState(() => /^\/join\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? null);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const activeSession = useRef(session);
  activeSession.current = session;
  const [data, setData] = useState<Desk | null>(null);
  const [deskFailed, setDeskFailed] = useState(false);
  const [error, setError] = useState("");
  const [entering, setEntering] = useState(false);
  const [pending, setPending] = useState(0);
  const [section, setSection] = useState<Section>("overview");
  const [view, setView] = useState<View>(() => homeView(loadSession()?.role ?? "director"));
  const [theme, setTheme] = useState<"light" | "dark">(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("helios.theme", theme);
  }, [theme]);

  async function refresh(next = session) {
    if (!next) return;
    const body = await desk(next);
    if (activeSession.current?.token !== next.token || activeSession.current?.tenantId !== next.tenantId) return;
    setData(body);
    setPending(pendingFor(next.tenantId, next.userId).length);
  }

  useEffect(() => {
    if (!session || joinCode || session.role === "cost") return;
    let live = true;
    setDeskFailed(false);
    void refresh(session).then(() => { if (live) setDeskFailed(false); }).catch((reason: Error) => {
      if (!live) return;
      if (reason.message === "unauthorized" || reason.message === "tenant_denied") {
        expire();
        return;
      }
      setDeskFailed(true);
      if (session.role === "worker" && readShiftSnapshot(session.tenantId, session.userId)) return;
      setError(explain(reason.message));
    });
    return () => { live = false; };
  }, [session, joinCode]);

  useEffect(() => {
    if (!session || joinCode || session.role === "cost") return;
    let live = true;
    void openDelivery(session).catch(() => { if (live) setError("Очередь на этом входе не открылась."); });
    const unbind = bindRemoteClose(() => {
      if (!live) return;
      clearShiftSnapshot(session.tenantId, session.userId);
      activeSession.current = null;
      saveSession(null);
      setSession(null);
      setData(null);
      setError("Сессия закончилась. Войдите снова.");
    });
    return () => { live = false; unbind(); };
  }, [session, joinCode]);

  useEffect(() => {
    if (!session || joinCode || session.role === "cost") return;
    const update = () => { if (document.visibilityState === 'visible') void refresh(session).catch(() => {}); };
    window.addEventListener('focus', update);
    const timer = setInterval(update, 15000);
    return () => { window.removeEventListener('focus', update); clearInterval(timer); };
  }, [session, joinCode]);

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

  function expire() {
    const current = activeSession.current;
    if (current) clearShiftSnapshot(current.tenantId, current.userId);
    void closeDelivery().catch(() => {});
    activeSession.current = null;
    saveSession(null);
    setSession(null);
    setData(null);
    setError("Сессия закончилась. Войдите снова.");
  }

  async function enter(email: string, password: string) {
    if (entering) return;
    setEntering(true);
    const previous = session;
    setData(null);
    try {
      await closeDelivery();
      const next = await login(email, password);
      activeSession.current = next;
      const chosen = homeView(next.role);
      setSession(next);
      setView(chosen);
      setSection(accessOf(chosen).sections[0]?.id ?? "overview");
      setError("");
    } catch (reason) {
      setError(explain(reason instanceof Error ? reason.message : "Не удалось войти"));
      if (previous) {
        void openDelivery(previous).catch(() => {});
        void refresh(previous).catch(() => {});
      }
    } finally { setEntering(false); }
  }

  function switchView(next: View) {
    if (!demoCabinets) return;
    const access = accessOf(next);
    setView(next);
    setSection((current) => (access.sections.some((item) => item.id === current) ? current : access.sections[0]?.id ?? "overview"));
  }

  async function logout() {
    if (!session) return;
    const current = session;
    // Close the local private context immediately, including when the API is unreachable.
    activeSession.current = null;
    clearShiftSnapshot(current.tenantId, current.userId);
    saveSession(null);
    setSession(null);
    setData(null);
    setError("");
    await closeDelivery().catch(() => {});
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${current.token}`, "x-tenant-id": current.tenantId },
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* Local credentials are already removed; never reopen on a network failure. */ }
  }

  if (joinCode) {
    if (session) return <main className="login"><div><Mark/><h1>Вы уже вошли</h1><p>Сейчас открыт аккаунт {session.email}. Выйдите, чтобы зарегистрировать другого человека по приглашению.</p><button className="fill" onClick={() => void logout()}>Выйти из аккаунта</button><a href="/">Вернуться в кабинет</a>{error ? <p role="alert">{error}</p> : null}</div></main>;
    return <JoinPage code={joinCode} onEntered={next => { setJoinCode(null); setSession(next); setView(homeView(next.role)); setSection(accessOf(homeView(next.role)).sections[0]?.id ?? 'overview'); setError(''); }}/>;
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
          <Mark />
          <h1 style={{ fontSize: 32, letterSpacing: "-0.04em" }}>Кто входит</h1>
          <p className="sub">{demoCabinets ? "Учебные входы отдельно от просмотра кабинета." : "Вход по логину и паролю."}</p>
          {demoCabinets ? entries.map((item) => (
            <button className="role-pick" type="button" key={item.email} onClick={() => void enter(item.email, item.password)}>
              <strong>{item.role}</strong>
              <small>{item.hint}</small>
            </button>
          )) : null}
          <label className="field"><span>Логин</span><input name="email" required maxLength={320} defaultValue={demoCabinets ? "director@pilot.helios" : ""} autoComplete="username" autoCapitalize="none" autoCorrect="off" /></label>
          <label className="field"><span>Пароль</span><input name="password" required maxLength={1024} type="password" defaultValue={demoCabinets ? "pilot-director" : ""} autoComplete="current-password" /></label>
          {error ? <div className="alert" role="alert">{error}</div> : null}
          <button className="fill" type="submit" disabled={entering}>{entering ? "Входим…" : "Войти"}</button>
          <button className="ghost" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</button>
        </form>
      </main>
    );
  }

  if (session.role === "cost") {
    return <PriceDesk session={session} theme={theme} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} onLogout={() => void logout()} />;
  }

  const savedShift = session.role === "worker" ? readShiftSnapshot(session.tenantId, session.userId) : null;
  const deskData = data ?? (deskFailed && savedShift ? offlineDesk(session, savedShift) : null);
  if (!deskData) {
    return <main className="login"><p>{error || "Открываем кабинет"}</p></main>;
  }

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const shown = demoCabinets ? view : homeView(session.role);
  const preview = demoCabinets && shown !== homeView(session.role);
  const access = accessOf(shown);

  if (access.shell === "phone") {
    return (
      <BookProvider tenantId={session.tenantId} userId={session.userId}>
        <WorkerPhone
          key={`${session.userId}:${shown}`}
          session={session}
          data={deskData}
          pending={pending}
          theme={theme}
          onTheme={toggleTheme}
          onLogout={logout}
          view={shown}
          demo={demoCabinets}
          preview={preview}
          onRole={switchView}
          onDemoAccount={(email, password) => void enter(email, password)}
          onStart={(taskId, employeeId) => queue(session, { kind: "shift_start", payload: { taskId, employeeId } })}
          onEnd={(taskId) => queue(session, { kind: "shift_end", payload: { taskId } })}
          onSubmit={(taskId, quantity) => queue(session, { kind: "submit_volume", payload: { taskId, quantity } })}
          onExpire={expire}
        />
      </BookProvider>
    );
  }

  const deskActions = {
    onStart: (taskId: string, employeeId: string) => queue(session, { kind: "shift_start" as const, payload: { taskId, employeeId } }),
    onEnd: (taskId: string) => queue(session, { kind: "shift_end" as const, payload: { taskId } }),
    onSubmit: (taskId: string, quantity: string) => queue(session, { kind: "submit_volume" as const, payload: { taskId, quantity } }),
    onAccept: async (reportId: string, acceptedQuantity: string) => {
      await acceptReport(session, reportId, acceptedQuantity);
      await refresh();
    },
    onCreate: async (input: NewTask) => {
      const created = await createTask(session, input);
      await refresh();
      return created.id;
    },
    onSavePlace: async (projectId: string, place: { address: string; latitude: number; longitude: number }) => {
      await savePlace(session, projectId, place);
      await refresh();
    },
  };

  return (
    <BookProvider tenantId={session.tenantId} userId={session.userId}>
      {error ? <div className="alert" style={{ margin: 12 }}>{error}</div> : null}
      <DirectorDesk
        key={`${session.userId}:${shown}`}
        view={shown}
        preview={preview}
        demo={demoCabinets}
        onDemoAccount={(email, password) => void enter(email, password)}
        session={session}
        data={deskData}
        section={section}
        onSection={setSection}
        theme={theme}
        onTheme={toggleTheme}
        onLogout={logout}
        onRole={switchView}
        onExpire={expire}
        {...deskActions}
      />
    </BookProvider>
  );
}
