export function customerLine(card: { recorded: boolean; attemptNumber: number | null; openRemarks: number; scans: { fileId?: string; filename?: string }[]; decision?: { attemptNumber: number; quantity: string; scanId: string } | null } | null) {
  if (!card?.recorded || card.attemptNumber === null) return "Внешней заявки ещё нет.";
  if (card.decision?.attemptNumber === card.attemptNumber) {
    const scan = card.scans.find((item) => item.fileId === card.decision?.scanId);
    return `Принято внешним СК. Попытка ${card.attemptNumber}. Количество ${card.decision.quantity}. Скан: ${scan?.filename ?? "приложен"}.`;
  }
  const scan = card.scans.length ? "Скан приложен." : "Подписанного скана ещё нет.";
  return `Попытка ${card.attemptNumber}. Открытых замечаний: ${card.openRemarks}. ${scan}`;
}
