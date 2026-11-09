const items = [
  ["director", "Руководитель"],
  ["master", "Прораб"],
  ["worker", "Рабочий"],
] as const;

export function RoleSwitch({ role, onRole }: { role: string; onRole: (role: "director" | "master" | "worker") => void }) {
  return (
    <div className="roles" role="group" aria-label="Сменить роль">
      {items.map(([id, label]) => (
        <button key={id} type="button" className={role === id ? "is-on" : ""} onClick={() => onRole(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
