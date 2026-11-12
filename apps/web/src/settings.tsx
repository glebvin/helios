import { AdmissionTemplatePanel } from "./admission-template-panel";
import { FrontTemplatePanel } from "./front-template-panel";
import type { Desk, Session } from "./api";
import { DeskBadge, DeskEmpty } from "./kit";
import { NoteMark } from "./note-mark";

export function Settings({
  session,
  projectId,
  data,
  onLogout,
  viewLabel,
  viewHint,
  showAccess,
  slim,
}: {
  session: Session;
  projectId: string;
  data: Desk;
  onLogout: () => void;
  viewLabel: string;
  viewHint: string;
  showAccess: boolean;
  slim: boolean;
}) {
  const canTemplate = !slim && ["director", "master"].includes(session.role);
  return (
    <section className="page">
      <div>
        <h1>Настройки</h1>
        <p className="sub">{slim ? viewHint : "Шаблон допуска этого объекта и входы сотрудников."}</p>
      </div>
      <div className="settings-layout">
          {canTemplate ? <div className="person-column">
            <AdmissionTemplatePanel key={`${session.token}:${session.tenantId}:${projectId}`} session={session} projectId={projectId} />
            <FrontTemplatePanel key={`front:${session.token}:${session.tenantId}:${projectId}`} session={session} projectId={projectId} writable={session.role === "director"} />
          </div> : null}
          {slim ? null : (
            <aside className="panel profile-card" aria-label="Профиль">
              <div className="documents-heading"><h2>Профиль</h2></div>
              <dl className="profile-facts">
                <div><dt>Имя</dt><dd>{session.name}</dd></div>
                <div><dt>Почта</dt><dd>{session.email}</dd></div>
                <div><dt>Кабинет</dt><dd>{data.cabinet.name}</dd></div>
                <div><dt>Организация</dt><dd>{data.organizations[0]?.name ?? "—"}</dd></div>
              </dl>
              <button className="ghost desk-action" type="button" onClick={onLogout}>Выйти</button>
            </aside>
          )}
          {showAccess ? (
            <section className="panel settings-wide" aria-label="Кто входит">
              <div className="documents-heading">
                <div className="documents-title">
                  <h2>Кто входит</h2>
                  <NoteMark label="Как устроены входы">
                    <p>Каждый человек входит со своей почтой и паролем. Роль и доступ к объекту проверяет сервер.</p>
                    <p>Одноразовые приглашения создаются в разделе «Люди», на вкладках «Работники» и «Прорабы».</p>
                    <p>Сейчас открыт вид «{viewLabel}». Объект в шапке: {data.projects[0]?.name ?? "не выбран"}.</p>
                  </NoteMark>
                </div>
              </div>
              {data.employees.length === 0 ? <DeskEmpty title="Карточек нет" description="Работник появится здесь, когда его заведут в кабинет." /> : (
                <div className="settings-people">
                  {data.employees.map((item) => (
                    <article className="qualification-row" key={item.id}>
                      <div><b>{item.full_name}</b></div>
                      <DeskBadge tone={item.user_id ? "done" : "neutral"}>{item.user_id ? "есть вход" : "без входа"}</DeskBadge>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : slim ? null : (
            <section className="panel settings-wide">
              <h2>{viewLabel}</h2>
              <p className="quiet person-note">{viewHint} Список входов видят руководитель проекта и администратор.</p>
            </section>
          )}
      </div>
    </section>
  );
}
