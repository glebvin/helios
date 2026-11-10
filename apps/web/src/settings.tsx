import type { Desk, Session } from "./api";
import { DeskBadge, DeskEmpty, SmoothButton } from "./kit";
import type { ForemanInvite, WorkerInvite } from "./people";

const seats = [
  { role: "РП", name: "Анна Соколова", email: "director@pilot.helios" },
  { role: "Прораб", name: "Павел Орлов", email: "master@pilot.helios" },
  { role: "Рабочий", name: "Иван Петров", email: "worker@pilot.helios" },
];

export function Settings({
  session,
  data,
  theme,
  onTheme,
  onLogout,
  invites = [],
  foremen = [],
  viewLabel,
  viewHint,
  showAccess,
  slim,
}: {
  session: Session;
  data: Desk;
  theme: string;
  onTheme: () => void;
  onLogout: () => void;
  invites?: WorkerInvite[];
  foremen?: ForemanInvite[];
  viewLabel: string;
  viewHint: string;
  showAccess: boolean;
  slim: boolean;
}) {
  const dark = theme === "dark";
  return (
    <section className="page">
      <div>
        <h1>Настройки</h1>
        <p className="sub">{slim ? viewHint : "Кто вошёл, какая тема и как выйти."}</p>
        <p className="quiet">На экране вид «{viewLabel}». Вход сервера — {session.name}.</p>
      </div>
      <div className="sheet-split">
        <div className="stack">
          {slim ? null : (
            <section className="panel">
              <h2>Профиль</h2>
              <dl className="kv">
                <div><dt>Имя</dt><dd>{session.name}</dd></div>
                <div><dt>Почта</dt><dd>{session.email}</dd></div>
                <div><dt>Кабинет</dt><dd>{data.cabinet.name}</dd></div>
                <div><dt>Организация</dt><dd>{data.organizations[0]?.name ?? "—"}</dd></div>
              </dl>
            </section>
          )}
          <section className="panel">
            <h2>Тема</h2>
            <p className="quiet person-note">Сейчас {dark ? "тёмная" : "светлая"}. Кнопка в шапке переключает то же значение.</p>
            <div className="person-note"><SmoothButton tone="ghost" onClick={onTheme}>{dark ? "Включить светлую" : "Включить тёмную"}</SmoothButton></div>
          </section>
          <section className="panel">
            <h2>Выход</h2>
            <p className="quiet person-note">Закроется сеанс этого браузера.</p>
            <div className="person-note"><SmoothButton onClick={onLogout}>Выйти</SmoothButton></div>
          </section>
        </div>
        {showAccess ? <section className="panel">
          <h2>Кто входит</h2>
          <p className="quiet person-note">Три живых входа. Остальные роли в шапке смотрят кабинет Анны и видят только свои разделы. Сервер при этом видит её вход.</p>
          <div className="sheet-wrap">
            <table className="sheet">
              <thead>
                <tr><th>Кто</th><th>Роль</th><th>Почта</th></tr>
              </thead>
              <tbody>
                {seats.map((seat) => (
                  <tr key={seat.email}>
                    <td><b>{seat.name}</b>{session.email === seat.email ? " · сейчас" : ""}</td>
                    <td>{seat.role}</td>
                    <td>{seat.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="person-note">Карточки сотрудников</h2>
          {data.employees.length === 0 ? <DeskEmpty title="Карточек нет" description="Работник появится здесь, когда его заведут в кабинет." /> : (
            <ul className="permit">
              {data.employees.map((item) => (
                <li key={item.id}>
                  <span>{item.full_name}</span>
                  <DeskBadge tone={item.user_id ? "done" : "neutral"}>{item.user_id ? "есть вход" : "без входа"}</DeskBadge>
                </li>
              ))}
            </ul>
          )}
          {invites.length + foremen.length === 0 ? <p className="quiet person-note">Новых приглашений нет. Работника зовут на вкладке «Работники», прораба — на вкладке «Прорабы».</p> : (
            <ul className="permit">
              {foremen.map((item) => <li key={item.id}><span>{item.name}</span><DeskBadge tone="warn">прораб, ждёт вход</DeskBadge></li>)}
              {invites.map((item) => <li key={item.id}><span>{item.name}</span><DeskBadge tone="warn">работник, ждёт вход</DeskBadge></li>)}
            </ul>
          )}
          <dl className="kv person-note">
            <div><dt>Вид</dt><dd>{viewLabel}</dd></div>
            <div><dt>Объект</dt><dd>{data.projects[0]?.name ?? "—"}</dd></div>
          </dl>
        </section> : slim ? null : (
          <section className="panel">
            <h2>{viewLabel}</h2>
            <p className="quiet person-note">{viewHint} Список входов видят руководитель проекта и администратор.</p>
          </section>
        )}
      </div>
    </section>
  );
}
