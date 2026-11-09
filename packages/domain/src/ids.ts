export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";
export const ORG_A = "11111111-1111-4111-8111-111111111112";
export const ORG_B = "22222222-2222-4222-8222-222222222223";
export const USER_DIRECTOR = "11111111-1111-4111-8111-111111111121";
export const USER_MASTER = "11111111-1111-4111-8111-111111111122";
export const USER_WORKER = "11111111-1111-4111-8111-111111111123";
export const USER_OTHER = "22222222-2222-4222-8222-222222222221";
export const EMPLOYEE_A = "11111111-1111-4111-8111-111111111131";
export const EMPLOYEE_B = "22222222-2222-4222-8222-222222222231";
export const PROJECT_A = "11111111-1111-4111-8111-111111111141";
export const FILE_B = "22222222-2222-4222-8222-222222222241";
export const QUEUE_WORK_REPORT = "work-report.recorded";

export const DEMO_USERS = [
  { id: USER_DIRECTOR, email: "director@pilot.helios", name: "Анна Соколова", password: "pilot-director", role: "director" },
  { id: USER_MASTER, email: "master@pilot.helios", name: "Павел Орлов", password: "pilot-master", role: "master" },
  { id: USER_WORKER, email: "worker@pilot.helios", name: "Иван Петров", password: "pilot-worker", role: "worker" },
  { id: USER_OTHER, email: "other@foreign.helios", name: "Чужой пользователь", password: "pilot-other", role: "director" },
] as const;
