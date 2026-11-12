import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

let lastNote = 0;

export function NoteMark({ label, children }: { label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; origin: string } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const wait = useRef(0);
  const id = useId();
  const shown = hover || pinned;
  const openHover = () => {
    window.clearTimeout(wait.current);
    const delay = Date.now() - lastNote < 400 ? 0 : 280;
    wait.current = window.setTimeout(() => setHover(true), delay);
  };
  const closeHover = () => {
    window.clearTimeout(wait.current);
    wait.current = window.setTimeout(() => setHover(false), 80);
  };
  useLayoutEffect(() => {
    if (!shown) { setPlace(null); return; }
    const move = () => {
      const trigger = root.current?.getBoundingClientRect();
      const pop = popup.current;
      if (!trigger || !pop) return;
      const frame = root.current?.closest(".phone")?.getBoundingClientRect();
      const viewLeft = frame?.left ?? 0;
      const viewRight = frame?.right ?? document.documentElement.clientWidth;
      const viewTop = frame?.top ?? 0;
      const viewBottom = frame?.bottom ?? window.innerHeight;
      const inset = 16;
      const room = Math.max(120, viewRight - viewLeft - inset * 2);
      const width = frame ? room : Math.min(280, room);
      pop.style.width = `${width}px`;
      const height = pop.offsetHeight;
      const roomBelow = viewBottom - trigger.bottom - inset;
      const roomAbove = trigger.top - viewTop - inset;
      const above = roomBelow < height + 8 && roomAbove > roomBelow;
      const top = Math.max(viewTop + inset, Math.min(above ? trigger.top - 8 - height : trigger.bottom + 8, viewBottom - inset - height));
      const left = frame ? viewLeft + inset : Math.max(viewLeft + inset, Math.min(trigger.left + trigger.width / 2 - width / 2, viewRight - inset - width));
      const originX = Math.max(16, trigger.left + trigger.width / 2 - left);
      setPlace({ top, left, origin: `${originX}px ${above ? "bottom" : "top"}` });
    };
    move();
    window.addEventListener("resize", move);
    window.addEventListener("scroll", move, true);
    return () => {
      window.removeEventListener("resize", move);
      window.removeEventListener("scroll", move, true);
    };
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    lastNote = Date.now();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !popup.current?.contains(target)) { setPinned(false); setHover(false); }
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
    <span className="note-mark" ref={root} onMouseEnter={openHover} onMouseLeave={closeHover}>
      <button type="button" className="note-mark-button" aria-label={label} aria-expanded={shown} aria-controls={id} onClick={(event) => { event.stopPropagation(); setPinned((value) => !value); }}>i</button>
      {shown ? createPortal(
        <span className={place ? "note-mark-pop is-placed" : "note-mark-pop"} ref={popup} id={id} role="note" onMouseEnter={openHover} onMouseLeave={closeHover} style={{ top: place?.top ?? -9999, left: place?.left ?? 12, transformOrigin: place?.origin ?? "top center", visibility: place ? "visible" : "hidden" }}>{children}</span>,
        document.body,
      ) : null}
    </span>
  );
}
