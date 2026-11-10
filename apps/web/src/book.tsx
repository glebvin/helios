import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type TaskFact = {
  zone: string;
  cipher: string;
  sheets: string;
  needsHiddenAct: boolean;
  lotId: string;
};

export type Lot = { id: string; name: string; batch: string; result: "recorded" | "accepted" | "rejected" };
export type ControlMark = { result: "accepted" | "remark"; note: string };
export type Downtime = { id: string; taskId: string; day: string; minutes: number; cause: string };
export type Act = { confirmed: boolean; sent: boolean };
export type Check = { flat: boolean; seam: boolean; photo: boolean; sent: boolean };

export type Book = {
  tasks: Record<string, TaskFact>;
  lots: Lot[];
  pto: Record<string, ControlMark>;
  customer: Record<string, ControlMark>;
  downtime: Downtime[];
  acts: Record<string, Act>;
  approvedDays: string[];
  preparedDays: string[];
  closedDays: string[];
};

export const checkItems = [
  ["flat", "Ровность поверхности"],
  ["seam", "Толщина шва"],
  ["photo", "Фото результата"],
] as const;

const empty = (): Book => ({ tasks: {}, lots: [], pto: {}, customer: {}, downtime: [], acts: {}, approvedDays: [], preparedDays: [], closedDays: [] });
const bookKey = (tenantId: string, userId: string) => `helios.book.${tenantId}.${userId}`;
const checkKey = (tenantId: string, userId: string, taskId: string) => `helios.check.${tenantId}.${userId}.${taskId}`;

export function loadBook(tenantId: string, userId: string): Book {
  try {
    const raw = localStorage.getItem(bookKey(tenantId, userId));
    if (!raw) return empty();
    return { ...empty(), ...(JSON.parse(raw) as Book) };
  } catch {
    return empty();
  }
}

export function saveBook(tenantId: string, userId: string, book: Book) {
  localStorage.setItem(bookKey(tenantId, userId), JSON.stringify(book));
}

export function readCheck(tenantId: string, userId: string, taskId: string): Check {
  try {
    const raw = localStorage.getItem(checkKey(tenantId, userId, taskId));
    if (!raw) return { flat: false, seam: false, photo: false, sent: false };
    const parsed = JSON.parse(raw) as Check;
    return { flat: !!parsed.flat, seam: !!parsed.seam, photo: !!parsed.photo, sent: !!parsed.sent };
  } catch {
    return { flat: false, seam: false, photo: false, sent: false };
  }
}

export function writeCheck(tenantId: string, userId: string, taskId: string, check: Check) {
  localStorage.setItem(checkKey(tenantId, userId, taskId), JSON.stringify(check));
}

export function checkReady(check: Check) {
  return check.flat && check.seam && check.photo;
}

export function blockedZone(book: Book, zone: string) {
  const key = zone.trim().toLowerCase();
  if (!key) return "";
  for (const [id, fact] of Object.entries(book.tasks)) {
    if (!fact.needsHiddenAct || fact.zone.trim().toLowerCase() !== key) continue;
    if (!book.acts[id]?.confirmed) return fact.zone;
  }
  return "";
}

export function minutesLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} ч ${rest} мин`;
  if (hours) return `${hours} ч`;
  return `${rest} мин`;
}

const Ctx = createContext<{ book: Book; update: (fn: (book: Book) => Book) => void; tenantId: string; userId: string } | null>(null);

export function BookProvider({ tenantId, userId, children }: { tenantId: string; userId: string; children: ReactNode }) {
  const [book, setBook] = useState(() => loadBook(tenantId, userId));
  useEffect(() => setBook(loadBook(tenantId, userId)), [tenantId, userId]);
  function update(fn: (book: Book) => Book) {
    setBook((current) => {
      const next = fn(current);
      saveBook(tenantId, userId, next);
      return next;
    });
  }
  return <Ctx.Provider value={{ book, update, tenantId, userId }}>{children}</Ctx.Provider>;
}

export function useBook() {
  const value = useContext(Ctx);
  if (!value) throw new Error("book");
  return value;
}

export function SelfCheck({ taskId, locked = false }: { taskId: string; locked?: boolean }) {
  const { tenantId, userId } = useBook();
  const [check, setCheck] = useState(() => readCheck(tenantId, userId, taskId));
  function save(next: Check) {
    if (locked) return;
    setCheck(next);
    writeCheck(tenantId, userId, taskId, next);
  }
  return (
    <div>
      {checkItems.map(([key, label]) => (
        <label className="check" key={key}>
          <input type="checkbox" checked={check[key]} disabled={locked} onChange={(event) => save({ ...check, [key]: event.target.checked })} />
          {label}
        </label>
      ))}
      <p className="quiet person-note">{checkReady(check) ? "Три пункта отмечены." : "Отметьте три пункта. Они хранятся в этом браузере."}</p>
    </div>
  );
}
