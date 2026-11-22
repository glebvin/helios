export type CatalogStatus = "active" | "archived";
export type CatalogKind = "zones" | "work-types";
export type Zone = { id: string; projectId: string; name: string; version: number; status: CatalogStatus };
export type WorkType = Zone & {
  unit: string;
  requiresRd: boolean;
  requiresMaterialControl: boolean;
  requiresPredecessorAcceptance: boolean;
  requiresId: boolean;
  hiddenWork: boolean;
};
export type CatalogItem = Zone | WorkType;
export type CatalogPage<T> = { items: T[]; total: number; limit: number; offset: number };
export type ZoneDraft = { name: string; status: CatalogStatus };
export type WorkTypeDraft = ZoneDraft & {
  unit: string;
  requiresRd: boolean;
  requiresMaterialControl: boolean;
  requiresPredecessorAcceptance: boolean;
  requiresId: boolean;
  hiddenWork: boolean;
};

export function activeForNewTask<T extends { status: CatalogStatus }>(items: T[]) {
  return items.filter((item) => item.status === "active");
}

export function canWriteCatalog(role: string) {
  return role === "director";
}

export function zoneDraft(row: Zone | null): ZoneDraft {
  return { name: row?.name ?? "", status: row?.status ?? "active" };
}

export function workTypeDraft(row: WorkType | null): WorkTypeDraft {
  return {
    name: row?.name ?? "",
    unit: row?.unit ?? "",
    requiresRd: row?.requiresRd ?? false,
    requiresMaterialControl: row?.requiresMaterialControl ?? false,
    requiresPredecessorAcceptance: row?.requiresPredecessorAcceptance ?? false,
    requiresId: row?.requiresId ?? false,
    hiddenWork: row?.hiddenWork ?? false,
    status: row?.status ?? "active",
  };
}

export function catalogValidation(kind: CatalogKind, draft: ZoneDraft | WorkTypeDraft) {
  if (!draft.name.trim() || draft.name.trim().length > 200) return "Укажите название до 200 символов.";
  if (kind === "work-types") {
    const unit = "unit" in draft ? draft.unit.trim() : "";
    if (!unit || unit.length > 40) return "Укажите единицу измерения, до 40 символов.";
  }
  return "";
}

export function catalogBody(kind: CatalogKind, draft: ZoneDraft | WorkTypeDraft, row: CatalogItem | null, requestId: string) {
  const shared = { requestId, name: draft.name.trim(), ...(row ? { expectedVersion: row.version, status: draft.status } : {}) };
  if (kind === "zones") return shared;
  const type = draft as WorkTypeDraft;
  return {
    ...shared,
    unit: type.unit.trim(),
    requiresRd: type.requiresRd,
    requiresMaterialControl: type.requiresMaterialControl,
    requiresPredecessorAcceptance: type.requiresPredecessorAcceptance,
    requiresId: type.requiresId,
    hiddenWork: type.hiddenWork,
  };
}

export function catalogError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли изменение справочника недоступно.";
  if (status === 404) return "Объект или запись недоступны этому входу.";
  if (status === 409 && code === "stale_version") return "Запись уже изменена в другом окне. Прочитайте актуальную версию перед повтором.";
  if (status === 409 && code === "idempotency_payload_mismatch") return "Номер попытки относится к другому изменению. Прочитайте актуальную версию.";
  if (status === 409) return "Конфликт данных. Запись не сохранена.";
  if (status === 400) return "Сервер не принял название, единицу или требования.";
  if (status === 422) return "Сервер не разрешил изменение этого справочника.";
  return "Нет подтверждения сервера. Повторите попытку с теми же данными.";
}

export function requirementLabels(row: WorkType) {
  return [
    row.requiresRd ? "РД" : "",
    row.requiresMaterialControl ? "материалы" : "",
    row.requiresPredecessorAcceptance ? "предшественник" : "",
    row.requiresId ? "ИД" : "",
    row.hiddenWork ? "скрытые" : "",
  ].filter(Boolean);
}
