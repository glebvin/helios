export type View =
  | "gd" | "ds" | "zds-sso" | "zds-soso" | "rp"
  | "master" | "pto" | "supply" | "safety" | "hr"
  | "customer" | "admin" | "worker";

export type Section = "overview" | "mine" | "people" | "tasks" | "quality" | "materials" | "documents" | "objects" | "settings";
export type PeopleTab = "people" | "foremen" | "crews" | "sheet" | "contractors";
export type QualityTab = "queue" | "check" | "remarks" | "history";

export type Access = {
  id: View;
  label: string;
  hint: string;
  account: "director" | "master" | "worker";
  sections: { id: Section; label: string }[];
  createTask: boolean;
  acceptVolume: boolean;
  writeCheck: boolean;
  writeCustomer: boolean;
  writeRemark: boolean;
  resubmit: boolean;
  editCheck: boolean;
  editMaterials: boolean;
  confirmAct: boolean;
  draftAct: boolean;
  recordSupply: boolean;
  inviteWorker: boolean;
  inviteForeman: boolean;
  prepareAdmit: boolean;
  prepareDay: boolean;
  closeDay: boolean;
  editPlace: boolean;
  showAccess: boolean;
  exportPeople: boolean;
  peopleTabs: PeopleTab[];
  qualityTabs: QualityTab[];
  qualityFirst: QualityTab;
  shell: "desk" | "foreman" | "phone";
  normsNote: boolean;
  checklistNote: boolean;
  settingsSlim: boolean;
  overviewTitle: string;
};

const people = [
  { id: "people" as const, label: "Работники" },
  { id: "foremen" as const, label: "Прорабы" },
  { id: "crews" as const, label: "Бригады" },
  { id: "sheet" as const, label: "Табель" },
  { id: "contractors" as const, label: "Подрядчики" },
];

const quality = [
  { id: "queue" as const, label: "Предъявления" },
  { id: "check" as const, label: "Наша проверка" },
  { id: "remarks" as const, label: "Замечания" },
  { id: "history" as const, label: "История" },
];

const look = {
  createTask: false,
  acceptVolume: false,
  writeCheck: false,
  writeCustomer: false,
  writeRemark: false,
  resubmit: false,
  editCheck: false,
  editMaterials: false,
  confirmAct: false,
  draftAct: false,
  recordSupply: false,
  inviteWorker: false,
  inviteForeman: false,
  prepareAdmit: false,
  prepareDay: false,
  closeDay: false,
  editPlace: false,
  showAccess: false,
  exportPeople: false,
  peopleTabs: [] as PeopleTab[],
  qualityTabs: [] as QualityTab[],
  qualityFirst: "queue" as QualityTab,
  normsNote: false,
  checklistNote: false,
  settingsSlim: false,
};

const desk: Access[] = [
  {
    ...look,
    id: "gd",
    label: "ГД",
    hint: "Генеральный директор. Утренняя сводка.",
    account: "director",
    sections: [
      { id: "overview", label: "Сегодня" },
      { id: "mine", label: "Мои дела" },
    ],
    shell: "desk",
    overviewTitle: "Сегодня",
  },
  {
    ...look,
    id: "ds",
    label: "ДС",
    hint: "Директор по строительству. Нормы трудозатрат пока не реализованы.",
    account: "director",
    sections: [
      { id: "overview", label: "Сегодня" },
      { id: "mine", label: "Мои дела" },
      { id: "objects", label: "Объект" },
    ],
    shell: "desk",
    normsNote: true,
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "zds-sso",
    label: "ЗДС ССО",
    hint: "Заместитель директора по строительству — руководитель службы строительства.",
    account: "director",
    sections: [
      { id: "overview", label: "Сегодня" },
      { id: "mine", label: "Мои дела" },
      { id: "quality", label: "Приёмка" },
    ],
    qualityTabs: ["queue", "remarks", "history"],
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "zds-soso",
    label: "ЗДС СОСО",
    hint: "Заместитель директора по строительству — руководитель службы обеспечения. Шаблоны чек-листов и перечень ИД пока не реализованы.",
    account: "director",
    sections: [{ id: "documents", label: "Акты" }],
    checklistNote: true,
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "rp",
    label: "РП",
    hint: "Руководитель проекта. Владелец объекта.",
    account: "director",
    sections: [
      { id: "overview", label: "Сегодня" },
      { id: "mine", label: "Мои дела" },
      { id: "people", label: "Люди" },
      { id: "tasks", label: "Задания" },
      { id: "quality", label: "Приёмка" },
      { id: "materials", label: "Материалы" },
      { id: "documents", label: "Акты" },
      { id: "objects", label: "Объект" },
      { id: "settings", label: "Настройки" },
    ],
    createTask: true,
    acceptVolume: true,
    writeCheck: false,
    writeCustomer: false,
    writeRemark: false,
    resubmit: true,
    editCheck: false,
    editMaterials: false,
    confirmAct: false,
    draftAct: false,
    inviteWorker: true,
    inviteForeman: true,
    prepareAdmit: false,
    prepareDay: false,
    closeDay: true,
    recordSupply: true,
    editPlace: true,
    showAccess: true,
    exportPeople: true,
    peopleTabs: people.map((item) => item.id),
    qualityTabs: quality.map((item) => item.id),
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "master",
    label: "Прораб",
    hint: "Мастер СМО. Готовит задание, самоконтроль, допуск и закрытие дня.",
    account: "master",
    sections: [
      { id: "overview", label: "Сегодня" },
      { id: "people", label: "Работники" },
      { id: "tasks", label: "Задания" },
      { id: "quality", label: "Приёмка" },
      { id: "materials", label: "Материалы" },
      { id: "documents", label: "Акты" },
      { id: "objects", label: "Объект" },
      { id: "settings", label: "Настройки" },
    ],
    createTask: true,
    acceptVolume: true,
    writeCheck: false,
    writeCustomer: false,
    writeRemark: false,
    resubmit: true,
    editCheck: true,
    editMaterials: false,
    confirmAct: false,
    draftAct: true,
    recordSupply: true,
    inviteWorker: true,
    prepareAdmit: true,
    prepareDay: true,
    editPlace: true,
    peopleTabs: ["people", "sheet"],
    qualityTabs: quality.map((item) => item.id),
    shell: "foreman",
    overviewTitle: "Сегодня",
  },
  {
    ...look,
    id: "pto",
    label: "ПТО",
    hint: "Руководитель ПТО. Принимает работу по чек-листу. Сервер этого решения текущему входу не отдаёт.",
    account: "director",
    sections: [
      { id: "quality", label: "Приёмка" },
      { id: "documents", label: "Акты" },
      { id: "people", label: "Табель" },
    ],
    peopleTabs: ["sheet"],
    writeCheck: false,
    qualityTabs: ["check"],
    qualityFirst: "check",
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "supply",
    label: "Снабжение",
    hint: "ОМТС, кладовщик. Поставка и завершённый входной контроль — разные действия. Маршрут 2.2 пока не реализован.",
    account: "director",
    sections: [{ id: "materials", label: "Материалы" }],
    recordSupply: true,
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "safety",
    label: "Охрана труда",
    hint: "Охрана труда и пожарная безопасность. Согласует допуск. Сервер этого шага текущему входу не отдаёт.",
    account: "director",
    sections: [{ id: "people", label: "Люди" }],
    peopleTabs: ["people"],
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "hr",
    label: "Кадры",
    hint: "Директор по персоналу, служба персонала. Выпускает сводную ревизию табеля.",
    account: "director",
    sections: [{ id: "people", label: "Люди" }],
    exportPeople: true,
    peopleTabs: ["people", "sheet"],
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "customer",
    label: "Заказчик",
    hint: "Строительный контроль заказчика. Результат заказчика сервер текущему входу не отдаёт.",
    account: "director",
    sections: [
      { id: "quality", label: "Приёмка" },
      { id: "settings", label: "Настройки" },
    ],
    writeCustomer: false,
    writeRemark: false,
    qualityTabs: ["queue", "check", "remarks"],
    settingsSlim: true,
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "admin",
    label: "Админ",
    hint: "Администратор. Пользователи и роли, без изменения подтверждённых записей.",
    account: "director",
    sections: [
      { id: "people", label: "Люди" },
      { id: "settings", label: "Настройки" },
    ],
    inviteWorker: true,
    inviteForeman: true,
    showAccess: true,
    exportPeople: true,
    peopleTabs: ["people", "foremen"],
    shell: "desk",
    overviewTitle: "Объект сегодня",
  },
  {
    ...look,
    id: "worker",
    label: "Рабочий",
    hint: "Своя смена и объём.",
    account: "worker",
    sections: [],
    shell: "phone",
    overviewTitle: "Сегодня",
  },
];

export const views = desk;

export function accessOf(id: View): Access {
  return desk.find((item) => item.id === id) ?? desk.find((item) => item.id === "rp")!;
}

export function homeView(role: string): View {
  if (desk.some((item) => item.id === role)) return role as View;
  if (role === "master") return "master";
  if (role === "worker") return "worker";
  if (role === "pto") return "pto";
  return "rp";
}

export const demoCabinets = import.meta.env.DEV;

export function serverRights(role: string) {
  return {
    createTask: ["director", "master"].includes(role),
    acceptReport: ["director", "master", "pto"].includes(role),
    savePlace: role === "director" || role === "master",
    ownShift: role === "worker",
  };
}

export function roleTitle(role: string) {
  const cabinet = desk.find((item) => item.id === role);
  if (cabinet) return cabinet.label;
  if (role === "director") return "Руководитель";
  if (role === "master") return "Мастер СМО";
  if (role === "worker") return "Рабочий";
  if (role === "pto") return "Руководитель ПТО";
  return role;
}

export function RoleSwitch({ view, onView }: { view: View; onView: (view: View) => void }) {
  return (
    <div className="roles" role="group" aria-label="Просмотр кабинета">
      <span className="roles-label">Просмотр</span>
      {desk.map((item) => (
        <button key={item.id} type="button" className={view === item.id ? "is-on" : ""} title={item.hint} onClick={() => onView(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
