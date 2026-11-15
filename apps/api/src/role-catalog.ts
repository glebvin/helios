/** Target role names from TZ v1.0 §5.1. Existing runtime behaviour is not a grant of the target permissions. */
const entries = [
  { code: 'director', label: 'РП', name: 'Руководитель проекта', pilot: true, runtime: 'existing' },
  { code: 'master', label: 'Мастер СМО', name: 'Мастер строительно-монтажных работ', pilot: true, runtime: 'existing' },
  { code: 'worker', label: 'Рабочий', name: 'Рабочий', pilot: true, runtime: 'existing' },
  { code: 'pto', label: 'ПТО', name: 'Руководитель ПТО — наш строительный контроль', pilot: true, runtime: 'existing' },
  { code: 'gd', label: 'ГД', name: 'Генеральный директор', pilot: true, runtime: 'existing' },
  { code: 'ds', label: 'ДС', name: 'Директор по строительству', pilot: true, runtime: 'existing' },
  { code: 'zds-sso', label: 'ЗДС ССО', name: 'Заместитель ДС — служба строительства', pilot: true, runtime: 'existing' },
  { code: 'zds-soso', label: 'ЗДС СОСО', name: 'Заместитель ДС — служба обеспечения', pilot: true, runtime: 'existing' },
  { code: 'supply', label: 'ОМТС / кладовщик', name: 'Снабжение и кладовщик', pilot: true, runtime: 'existing' },
  { code: 'safety', label: 'ОТиПБ', name: 'Охрана труда и промышленная безопасность', pilot: true, runtime: 'existing' },
  { code: 'hr', label: 'ДП / служба персонала', name: 'Служба персонала', pilot: true, runtime: 'existing' },
  { code: 'admin', label: 'Администратор', name: 'Администратор ИТ заказчика', pilot: true, runtime: 'existing' },
  { code: 'customer', label: 'СК Заказчика', name: 'СК Заказчика — прежний учебный кабинет, гостевой доступ этапа 2', pilot: false, runtime: 'existing' },
  { code: 'brigadier', label: 'Бригадир', name: 'Бригадир', pilot: true, runtime: 'reserved' },
  { code: 'engineer-pto', label: 'Инженер ПТО', name: 'Инженер ПТО', pilot: true, runtime: 'reserved' },
  { code: 'cost', label: 'СО', name: 'Сметный отдел', pilot: true, runtime: 'reserved' },
  { code: 'subcontractor', label: 'Субподрядчик', name: 'Пользователь субподрядчика', pilot: true, runtime: 'reserved' },
  { code: 'peo', label: 'ПЭО', name: 'Планово-экономический отдел', pilot: true, runtime: 'reserved' },
  { code: 'gb', label: 'ГБ', name: 'Главный бухгалтер', pilot: true, runtime: 'reserved' },
  { code: 'uo', label: 'ЮО', name: 'Юридический отдел', pilot: true, runtime: 'reserved' },
] as const;
export const roleCatalog = Object.freeze(entries.map(entry => Object.freeze(entry)));

export type RoleCode = typeof roleCatalog[number]['code'];
const byCode = new Map<string, typeof roleCatalog[number]>(roleCatalog.map(entry => [entry.code, entry]));
export function roleDescriptor(code: unknown) {
  return typeof code === 'string' ? byCode.get(code) : undefined;
}
export function isKnownRole(code: unknown): code is RoleCode { return !!roleDescriptor(code); }
export function isExistingRuntimeRole(code: unknown) { return roleDescriptor(code)?.runtime === 'existing'; }
