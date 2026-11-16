import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { DeskSelect } from "./kit";
import { chosenProject, civilLabel, hasV1ProjectScope, projectLabel, sameActor, scopeNotice, type ServerActor, type ServerProject } from "./scope";
import { ApiError, v1 } from "./v1";
import { listChecklistCards, openDelivery } from "./delivery";
import { readShiftSnapshot } from "./shift-snapshot";

type ProjectPage = { items: ServerProject[]; total: number };
type OverviewDay = { day: string; timezone: string };

export type CabinetScope = {
  loading: boolean;
  error: string;
  actor: ServerActor | null;
  projects: ServerProject[];
  total: number;
  picked: string;
  setPicked: (id: string) => void;
  projectId: string;
  projectName: string;
  day: string;
  dayLabel: string;
  notice: string;
};

function readError(reason: unknown) {
  if (reason instanceof ApiError && reason.status === 401) return "unauthorized";
  if (reason instanceof ApiError && reason.status === 403) return "Этот запрос входу не разрешён.";
  if (reason instanceof ApiError) return "Сервер не подтвердил объект и день.";
  return "Нет ответа сервера. Объект и день не подтверждены.";
}

export function useCabinetScope(session: Session, onUnauthorized: () => void, cabinetProjects: ServerProject[]): CabinetScope {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actor, setActor] = useState<ServerActor | null>(null);
  const [projects, setProjects] = useState<ServerProject[]>([]);
  const [total, setTotal] = useState(0);
  const [picked, setPickedState] = useState("");
  const [day, setDay] = useState("");
  const [pass, setPass] = useState(0);
  const expire = useRef(onUnauthorized);
  expire.current = onUnauthorized;
  const cabinetProjectKey = JSON.stringify(cabinetProjects.map(({ id, name }) => ({ id, name })));

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") setPass((value) => value + 1); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, 60000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let live = true;
    setError("");
    void (async () => {
      try {
        const nextActor = await v1<ServerActor>(session, "/me");
        if (!live) return;
        if (!sameActor(session, nextActor)) {
          expire.current();
          return;
        }
        if (session.role === "engineer-pto") {
          const home = await v1<{ today: string; projects: ServerProject[] }>(session, "/checklist-templates");
          if (!live) return;
          setActor(nextActor);
          setProjects(home.projects);
          setTotal(home.projects.length);
          setDay(home.today);
          setError("");
          return;
        }
        // Additional cabinets retain their existing assigned-project read projection.
        const page = hasV1ProjectScope(session.role)
          ? await v1<ProjectPage>(session, "/projects?limit=100")
          : { items: JSON.parse(cabinetProjectKey) as ServerProject[], total: cabinetProjects.length };
        if (!live) return;
        const clock = await v1<OverviewDay>(session, "/overview");
        if (!live) return;
        setActor(nextActor);
        setProjects(page.items);
        setTotal(page.total);
        setDay(clock.day);
        setError("");
      } catch (reason) {
        if (!live) return;
        if (reason instanceof ApiError && reason.status === 401) {
          expire.current();
          return;
        }
        const saved = !(reason instanceof ApiError) ? readShiftSnapshot(session.tenantId, session.userId) : null;
        const draft = !saved && !(reason instanceof ApiError) ? (await openDelivery(session).then(() => listChecklistCards()).catch(() => []))[0] : null;
        if (draft?.day) {
          setActor(null);
          setProjects([{ id: draft.projectId, name: draft.projectName }]);
          setTotal(1);
          setDay(draft.day);
          setError("");
        } else if (saved) {
          setActor(null);
          setProjects([{ id: saved.projectId, name: saved.projectName }]);
          setTotal(1);
          setDay(saved.day);
          setError("");
        } else {
          const text = readError(reason);
          setDay("");
          setProjects([]);
          setTotal(0);
          setError(text);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [session.token, session.userId, session.tenantId, session.role, pass, cabinetProjectKey]);

  useEffect(() => {
    setLoading(true);
    setPickedState("");
    setActor(null);
    setProjects([]);
    setTotal(0);
    setDay("");
  }, [session.token, session.userId]);

  function setPicked(id: string) {
    if (!id || projects.some((item) => item.id === id)) setPickedState(id);
  }

  const projectId = chosenProject(projects, picked, total);
  const notice = scopeNotice({ loading, error, projects, total, selected: picked, day });
  return {
    loading, error, actor, projects, total, picked, setPicked, projectId,
    projectName: projectLabel(projects, picked, total),
    day, dayLabel: civilLabel(day), notice,
  };
}

export function ScopeBar({ scope }: { scope: CabinetScope }) {
  if (scope.projects.length > 1 && scope.total === scope.projects.length) {
    return (
      <>
        <DeskSelect
          label="Объект"
          value={scope.projectId}
          options={[{ value: "", label: "Выберите объект" }, ...scope.projects.map((item) => ({ value: item.id, label: item.name }))]}
          onChange={scope.setPicked}
        />
        <span className="scope-day">{scope.notice || scope.dayLabel}</span>
      </>
    );
  }
  if (scope.projects.length === 1 && scope.total === 1) {
    return (
      <>
        <DeskSelect label="Объект" value={scope.projects[0].id} options={[{ value: scope.projects[0].id, label: scope.projects[0].name }]} onChange={() => {}} />
        <span className="scope-day">{scope.notice || scope.dayLabel}</span>
      </>
    );
  }
  return <span className="scope-day">{scope.notice || "Объект и день не подтверждены."}</span>;
}
