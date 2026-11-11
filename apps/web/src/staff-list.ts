export type ServerEmployee = {
  id: string;
  fullName: string;
  phone: string | null;
  organizationId: string;
  userId: string | null;
  version: number;
  status: "active" | "archived";
};

export const staffPageLimit = 25;

export function staffQuery(offset: number) {
  return `/employees?limit=${staffPageLimit}&offset=${offset}`;
}

export function searchStaff(items: ServerEmployee[], needle: string) {
  const query = needle.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => `${item.fullName} ${item.phone ?? ""}`.toLowerCase().includes(query));
}

export function staffError(status: number | null, card = false) {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этот запрос входу не разрешён.";
  if (status === 404 && card) return "Сервер не показал эту карточку.";
  if (status === null) return card ? "Нет ответа сервера. Карточка не подтверждена." : "Нет ответа сервера. Список не подтверждён.";
  return card ? "Сервер не подтвердил карточку." : "Сервер не подтвердил список.";
}

export function staffNotice(input: { error: string; total: number; loaded: number; shown: number; needle: string }) {
  if (input.error) return "";
  const query = input.needle.trim();
  if (query && input.shown === 0 && input.total > input.loaded) return "На этой странице такого нет. Поиск смотрит только загруженные строки.";
  if (input.total > input.loaded) return "Показана не вся выборка сервера. Поиск и выгрузка не выходят за эту страницу.";
  return "";
}
