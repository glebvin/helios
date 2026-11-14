import { useState } from "react";
import { pinChecklist, type ChecklistAnswer, type ChecklistItem, type ChecklistTemplate } from "@helios/domain";
import { ChecklistForm } from "./checklist-form";

const longPrompt = "Площадка свободна от посторонних, проходы не перекрыты складом и можно пройти к шву без перестановки оборудования";

function point(id: string, prompt: string, patch: Partial<ChecklistItem> = {}): ChecklistItem {
  return { id, prompt, kind: "yes_no", required: false, critical: false, ...patch };
}

const current: ChecklistTemplate = {
  id: "seam-check",
  version: 1,
  items: [
    point("clear", longPrompt, { required: true, critical: true }),
    point("thickness", "Толщина защитного слоя", { kind: "number", unit: "мм", min: "10", max: "20", required: true, critical: true }),
    point("photo", "Фото шва", { kind: "photo", required: true }),
    point("document", "Документ входного контроля", { kind: "document", required: true }),
    point("batch", "Партия смеси", { kind: "batch", required: true }),
    point("dry", "Поверхность сухая"),
    point("mark", "Маркировка читается"),
    point("edge", "Кромка без сколов"),
    point("clean", "Основание обеспылено"),
    point("access", "Доступ для следующего звена открыт"),
    point("width", "Ширина шва", { kind: "number", unit: "мм", min: "4", max: "8", required: true }),
  ],
};

const filled: ChecklistAnswer[] = [
  { itemId: "clear", value: "yes" },
  { itemId: "thickness", value: "12" },
  { itemId: "photo", value: "file-seam-1" },
  { itemId: "document", value: "doc-seam-1" },
  { itemId: "batch", value: "batch-seam-1" },
  { itemId: "dry", value: "yes" },
  { itemId: "mark", value: "yes" },
  { itemId: "edge", value: "yes" },
  { itemId: "clean", value: "yes" },
  { itemId: "access", value: "yes" },
  { itemId: "width", value: "5" },
];

export function ChecklistPreview() {
  const pinned = pinChecklist(current);
  const newer: ChecklistTemplate = { ...current, version: 2, items: current.items.map((item) => item.id === "thickness" ? { ...item, prompt: "Новая толщина следующей версии", min: "0", max: "5" } : item) };
  const [answers, setAnswers] = useState<ChecklistAnswer[]>([]);
  const [sample, setSample] = useState(0);
  return (
    <main className="checklist-preview">
      <p className="quiet">Учебный просмотр. Ответы остаются на экране и не записываются на сервер.</p>
      <h1>Чек-лист шва</h1>
      <p>Закреплена версия {pinned.templateVersion}. Версия {newer.version} меняет допуск толщины на {newer.items[1].min}–{newer.items[1].max} мм и это прохождение не меняет.</p>
      <ChecklistForm key={sample} snapshot={pinned} answers={answers} onAnswers={setAnswers} />
      <button className="ghost desk-action" type="button" onClick={() => { setAnswers(filled); setSample((value) => value + 1); }}>Показать заполненный пример</button>
    </main>
  );
}
