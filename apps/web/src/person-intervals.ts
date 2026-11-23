import { durationLabel } from "./worker-day";

type Day = { recorded: boolean; source: { totals: { breakMs: string; downtimeMs: string }; hasOpenIntervals: boolean } };

export function personIntervalFacts(day: Day) {
  if (!day.recorded) return { breakLabel: "—", downtimeLabel: "—", note: "За этот день сервер не записал интервалы." };
  return {
    breakLabel: durationLabel(day.source.totals.breakMs) || "—",
    downtimeLabel: durationLabel(day.source.totals.downtimeMs) || "—",
    note: day.source.hasOpenIntervals ? "Есть открытый интервал: длительность ещё растёт." : "Это записанные интервалы дня, не утверждённые часы.",
  };
}
