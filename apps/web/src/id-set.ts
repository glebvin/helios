export function idSetError(status: number | null, code = "") {
  if (status === 403 && code === "route_denied") return "Комплект записывает назначенный инженер ПТО.";
  if (status === 403) return "Этой роли запись комплекта недоступна.";
  if (status === 409 && code === "stale_version") return "Комплект уже изменён. Прочитайте его перед повтором.";
  if (status === 409) return "Этот номер записи относится к другому комплекту.";
  if (status === 400) return "Сервер не принял названия документов.";
  if (status === 404) return "Вид работ или объект недоступны этому входу.";
  return "Нет подтверждения сервера. Повторите ту же запись.";
}

export function titlesOf(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}
