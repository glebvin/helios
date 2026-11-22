export function masterDecisionMap(items: { reportId: string; totalAcceptedQuantity: string | null }[], total: number) {
  if (total !== items.length) return null;
  return Object.fromEntries(items.map((item) => [item.reportId, item.totalAcceptedQuantity]));
}

export function boardVolumeLabel(submitted: string, unit: string, accepted: string | null | undefined, list = false) {
  if (typeof accepted !== "string") return list ? `Сообщено ${submitted} ${unit}. Не принято.` : `${submitted} ${unit} · не принято`;
  return list ? `Сообщено ${submitted} ${unit}. Принято мастером ${accepted}.` : `${submitted} ${unit} · принято мастером ${accepted}`;
}
