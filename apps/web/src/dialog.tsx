import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { amount } from "./model";

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const node = panel.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      [...(node?.querySelectorAll<HTMLElement>("button, input, select, textarea") ?? [])].filter((item) => !item.hasAttribute("disabled"));
    focusable()[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  const host = typeof document === "undefined" ? null : document.querySelector(".phone");
  const tree = (
    <div className="dialog-back" onClick={() => close.current()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desk-dialog-title"
        ref={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="desk-dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
  return host ? createPortal(tree, host) : tree;
}

export function AcceptForm({ submitted, unit, onSubmit }: { submitted: string; unit: string; onSubmit: (quantity: string) => void }) {
  const [quantity, setQuantity] = useState(amount(submitted));
  const [error, setError] = useState("");
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const value = quantity.trim().replace(",", ".");
      const number = Number(value);
      const cap = Number(submitted);
      if (!value || Number.isNaN(number) || number < 0) { setError("Укажите объём от нуля до сданного."); return; }
      if (number > cap) { setError(`Не больше сданного: ${amount(submitted)} ${unit}.`); return; }
      onSubmit(value);
    }}>
      <p className="quiet form-note">Сдано {amount(submitted)} {unit}. Принятое не больше этого числа.</p>
      <label className="field"><span>Принято, {unit}</span><input value={quantity} inputMode="decimal" onChange={(event) => { setQuantity(event.target.value); setError(""); }} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button className="fill" type="submit">Принять</button>
    </form>
  );
}

export function AcceptDialog({ submitted, unit, onClose, onSubmit }: { submitted: string; unit: string; onClose: () => void; onSubmit: (quantity: string) => void }) {
  return (
    <Dialog title="Сколько принято" onClose={onClose}>
      <AcceptForm submitted={submitted} unit={unit} onSubmit={onSubmit} />
      <button className="ghost" type="button" onClick={onClose}>Закрыть</button>
    </Dialog>
  );
}
