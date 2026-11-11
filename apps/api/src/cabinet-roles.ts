// Additional cabinets currently expose assigned-project reads only.
// Operational write permissions remain with the existing four API roles.
export const readOnlyCabinetRoles = new Set([
  "gd", "ds", "zds-sso", "zds-soso", "supply", "safety", "hr", "customer", "admin",
]);

export function cabinetReadRole(role: string) {
  return readOnlyCabinetRoles.has(role) ? "pto" : role;
}
