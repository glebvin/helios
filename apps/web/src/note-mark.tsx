import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function NoteMark({ label, children }: { label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const [offset, setOffset] = useState(0);
  const lastOffset = useRef(0);
  const id = useId();
  const shown = hover || pinned;
  useLayoutEffect(() => {
    if (!shown) return;
    const place = () => {
      if (!popup.current) return;
      const rect = popup.current.getBoundingClientRect();
      const left = rect.left - lastOffset.current;
      const right = left + rect.width;
      const next = Math.max(12 - left, Math.min(0, document.documentElement.clientWidth - 12 - right));
      lastOffset.current = next; setOffset(next);
    };
    place(); window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [shown]);
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
      {shown ? <span className="note-mark-pop" ref={popup} style={{ marginLeft: offset }} id={id} role="note">{children}</span> : null}
    </span>
  );
}
