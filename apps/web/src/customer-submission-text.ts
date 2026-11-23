export function customerLine(card: { recorded: boolean; attemptNumber: number | null; openRemarks: number; scans: unknown[] } | null) {
  if (!card?.recorded || card.attemptNumber === null) return "Внешней заявки ещё нет.";
  const scan = card.scans.length ? "Скан приложен." : "Подписанного скана ещё нет.";
  return `Попытка ${card.attemptNumber}. Открытых замечаний: ${card.openRemarks}. ${scan}`;
}
