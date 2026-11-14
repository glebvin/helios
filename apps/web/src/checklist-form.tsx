import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { checklistPage, checklistPageCount, validateChecklist, type ChecklistAnswer, type ChecklistSnapshot, type ChecklistVerdict } from "@helios/domain";

const reasonText: Record<string, string> = {
  critical_empty: "Критичный пункт не заполнен.",
  critical_invalid: "Критичный пункт не проходит проверку.",
  required_empty: "Обязательный пункт не заполнен.",
  type_mismatch: "Ответ не соответствует типу пункта.",
  out_of_bounds: "Число вне допустимых границ.",
  photo_limit: "В прохождении больше 20 фото.",
  invalid_template: "Шаблон этой версии составлен неверно.",
};

export function ChecklistForm({ snapshot, answers, onAnswers }: {
  snapshot: ChecklistSnapshot;
  answers: ChecklistAnswer[];
  onAnswers: (answers: ChecklistAnswer[]) => void;
}) {
  const reduce = useReducedMotion();
  const [page, setPage] = useState(0);
  const [verdict, setVerdict] = useState<ChecklistVerdict | null>(null);
  const pages = checklistPageCount(snapshot.items.length);
  const visible = checklistPage(snapshot.items, page);
  const start = page * 10;

  function change(itemId: string, value: string) {
    setVerdict(null);
    const next = answers.filter((answer) => answer.itemId !== itemId);
    if (value !== "") next.push({ itemId, value });
    onAnswers(next);
  }

  return (
    <form className="checklist-form" onSubmit={(event) => { event.preventDefault(); setVerdict(validateChecklist(snapshot, answers)); }}>
      {snapshot.items.length === 0 ? <p className="quiet">В закреплённой версии нет пунктов. Новый шаблон сюда не подставляется.</p> : null}
      <motion.div key={`${snapshot.templateVersion}-${page}`} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.28, bounce: 0 }}>
        {visible.map((item, index) => {
          const value = answers.find((answer) => answer.itemId === item.id)?.value ?? "";
          const problem = verdict?.refusals.find((refusal) => refusal.itemId === item.id);
          return (
            <fieldset className="checklist-item" key={item.id}>
              <legend>{start + index + 1}. {item.prompt}{item.critical ? " · критичный" : ""}</legend>
              {item.kind === "yes_no" ? (
                <div className="checklist-choice" role="group" aria-label={item.prompt}>
                  <button className={value === "yes" ? "is-on" : ""} type="button" onClick={() => change(item.id, "yes")}>Да</button>
                  <button className={value === "no" ? "is-on" : ""} type="button" onClick={() => change(item.id, "no")}>Нет</button>
                </div>
              ) : (
                <label>
                  <span className="quiet">{item.kind === "number" ? `Число, ${item.unit}${item.min || item.max ? `, от ${item.min ?? "…"} до ${item.max ?? "…"}` : ""}` : "Идентификатор, без загрузки файла"}</span>
                  <input value={value} inputMode={item.kind === "number" ? "decimal" : "text"} onChange={(event) => change(item.id, event.target.value)} />
                </label>
              )}
              {problem ? <p className="checklist-warn" role="alert">{reasonText[problem.reason]}</p> : null}
            </fieldset>
          );
        })}
      </motion.div>
      {pages > 1 ? (
        <div className="checklist-step">
          <button className="ghost desk-action" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
          <span className="quiet">Пункты {start + 1}–{start + visible.length} из {snapshot.items.length}</span>
          <button className="ghost desk-action" type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>Далее</button>
        </div>
      ) : null}
      {verdict?.refusals.some((item) => item.reason === "photo_limit") ? <p className="checklist-warn" role="alert">{reasonText.photo_limit}</p> : null}
      <button className="fill desk-action" type="submit">Проверить ответы</button>
      {verdict?.ok ? <p role="status">Замечаний нет. Это не сохранение и не приёмка работы.</p> : null}
      {verdict && !verdict.ok ? <p role="status">{verdict.refused ? "Критичный пункт останавливает проверку." : "Проверка не пройдена."} Ответы не отправлены.</p> : null}
    </form>
  );
}
