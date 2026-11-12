import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function NoteMark({ label, children }: { label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  const shown = hover || pinned;
  useEffect(() => {
    if (!shown) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setPinned(false); setHover(false); }
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setPinned(false); setHover(false); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [shown]);
  return (
    <span className="note-mark" ref={root} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className="note-mark-button" aria-label={label} aria-expanded={shown} aria-controls={id} onClick={(event) => { event.stopPropagation(); setPinned((value) => !value); }}>i</button>
      {shown ? <span className="note-mark-pop" id={id} role="note">{children}</span> : null}
    </span>
  );
}
