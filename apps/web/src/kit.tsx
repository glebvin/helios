import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

const ease = [0.2, 0, 0, 1] as const;

export function StatGrid({ items }: { items: { value: string; label: string; tone?: "accent" | "warn" | "done" }[] }) {
  return (
    <div className="metrics">
      {items.map((item) => (
        <article className={item.tone ? `metric is-${item.tone}` : "metric"} key={item.label}>
          <ShiftValue value={item.value} />
          <span>{item.label}</span>
        </article>
      ))}
    </div>
  );
}

function ShiftValue({ value }: { value: string }) {
  const reduce = useReducedMotion();
  const seen = useRef(false);
  const first = !seen.current;
  useEffect(() => {
    seen.current = true;
  }, []);
  return (
    <span className="shift-num">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.b
          key={value}
          initial={first || reduce ? false : { y: "100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {value}
        </motion.b>
      </AnimatePresence>
    </span>
  );
}

const badgeTone = { accent: "is-accent", warn: "is-warn", done: "is-done" } as const;

export function DeskBadge({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "accent" | "warn" | "done" }) {
  return <span className={tone === "neutral" ? "badge" : `badge ${badgeTone[tone]}`}>{children}</span>;
}

export function DeskEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty" role="status">
      <b>{title}</b>
      <p>{description}</p>
    </div>
  );
}

export function DeskProgress({ value, label, compact = false, tone = "accent" }: { value: number; label: string; compact?: boolean; tone?: "ink" | "accent" | "warn" | "done" }) {
  const reduce = useReducedMotion();
  const width = Math.max(0, Math.min(100, Math.round(value)));
  const names = [compact ? "meter is-compact" : "meter", `is-${tone}`].join(" ");
  return (
    <div className={names}>
      {compact ? null : (
        <div className="meter-top">
          <span>{label}</span>
          <span>{width}%</span>
        </div>
      )}
      <div className="track" role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <motion.span initial={false} animate={{ transform: `translateX(${width - 100}%)` }} transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.45 }} />
      </div>
      {compact ? <span className="meter-pct">{width}%</span> : null}
    </div>
  );
}

const stageSpring = { type: "spring" as const, bounce: 0.1, duration: 0.25 };

export function DeskStepper({ steps, current, done }: { steps: { label: string }[]; current: number; done?: boolean[] }) {
  const reduce = useReducedMotion();
  return (
    <ol className="stage" aria-label="Ход работы">
      {steps.map((step, index) => {
        const finished = done ? Boolean(done[index]) : index < current;
        const now = index === current;
        return (
          <li key={step.label} className={finished ? "is-done" : now ? "is-now" : ""} aria-current={now ? "step" : undefined}>
            <span className="stage-mark">
              {now && !reduce ? (
                <motion.i className="stage-ring" aria-hidden="true" initial={{ opacity: 0.45, scale: 1 }} animate={{ opacity: 0, scale: 1.55 }} transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }} />
              ) : null}
              {finished ? <StageCheck /> : <span>{index + 1}</span>}
            </span>
            <span className="stage-label">{step.label}</span>
            {index < steps.length - 1 ? (
              <span className="stage-line" aria-hidden="true">
                <motion.i initial={false} animate={{ scaleX: finished ? 1 : 0 }} transition={reduce ? { duration: 0 } : stageSpring} />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StageCheck() {
  const reduce = useReducedMotion();
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <motion.path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={reduce ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }} />
    </svg>
  );
}

export function FluidTabs({ label, value, onChange, tabs }: { name?: string; label: string; value: string; onChange: (id: string) => void; tabs: { id: string; label: string }[] }) {
  return (
    <div
      className="roles"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        const index = tabs.findIndex((tab) => tab.id === value);
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
        onChange(tabs[next].id);
      }}
    >
      {tabs.map((tab) => {
        const on = tab.id === value;
        return (
          <button key={tab.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} className={on ? "is-on" : ""} onClick={() => onChange(tab.id)}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function DeskCrumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  const reduce = useReducedMotion();
  return (
    <nav className="crumbs" aria-label="Путь">
      <ol>
        {items.map((item, index) => (
          <motion.li key={item.label} initial={reduce ? false : { opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.1, duration: 0.25, delay: index * 0.04 }}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.onClick ? <button type="button" onClick={item.onClick}>{item.label}</button> : <span aria-current="page">{item.label}</span>}
          </motion.li>
        ))}
      </ol>
    </nav>
  );
}

export function SmoothButton({ children, tone = "solid", type = "button", onClick }: { children: string; tone?: "solid" | "ghost"; type?: "button" | "submit"; onClick?: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.button className={tone === "ghost" ? "ghost smooth-btn" : "fill smooth-btn"} type={type} onClick={onClick} whileTap={reduce ? undefined : { scale: 0.97 }}>
      {children}
    </motion.button>
  );
}

export function DeskSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="desk-select">
      <span>{label}</span>
      <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value || option.label} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function DeskFeed({ items }: { items: { id: string; title: string; detail: string; when: string }[] }) {
  const reduce = useReducedMotion();
  return (
    <ul className="feed">
      {items.map((item, index) => (
        <motion.li key={item.id} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.1, duration: 0.25, delay: Math.min(index * 0.04, 0.24) }}>
          <b>{item.title}</b>
          <small>{item.detail}</small>
          <time>{item.when}</time>
        </motion.li>
      ))}
    </ul>
  );
}

export function DeskTimeline({ events }: { events: { id: string; title: string; detail: string; when: string }[] }) {
  const full = Math.max(0, events.length - 1);
  const [active, setActive] = useState(-1);
  const [prev, setPrev] = useState<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const frame = requestAnimationFrame(() => setActive(full));
    return () => cancelAnimationFrame(frame);
  }, [full]);
  if (!events.length) return null;
  const move = (index: number) => {
    if (activeRef.current === index) return;
    setPrev(activeRef.current);
    setActive(index);
  };
  return (
    <div className="timeline" onMouseLeave={() => move(full)}>
      {events.map((event, index) => {
        const dot = active >= index;
        const line = active > index;
        const delays = timelineDelay(index, active, prev);
        return (
          <div className="timeline-item" key={event.id} onMouseEnter={() => move(index)}>
            <span className="timeline-rail" aria-hidden="true">
              {index < events.length - 1 ? <i style={{ transform: line ? "scaleY(1)" : "scaleY(0)", transitionDelay: `${delays.line}s` }} /> : null}
              <b className={dot ? "is-on" : ""} style={{ transitionDelay: `${delays.dot}s` }} />
            </span>
            <span>
              <strong>{event.title}</strong>
              {event.detail ? <small>{event.detail}</small> : null}
            </span>
            <time>{event.when}</time>
          </div>
        );
      })}
    </div>
  );
}

function timelineDelay(index: number, active: number, prev: number | null) {
  const from = prev ?? -1;
  if (active > from) return { dot: Math.max(0, index - Math.max(from, 0)) * 0.08, line: Math.max(0, index - Math.max(from, 0)) * 0.08 + 0.04 };
  return { dot: 0, line: 0 };
}

export function LiquidGauge({ value, label }: { value: number; label: string }) {
  const reduce = useReducedMotion();
  const liquid = useRef<HTMLDivElement>(null);
  const number = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = liquid.current;
    const text = number.current;
    const target = Math.max(0, Math.min(100, value));
    if (!node) return;
    if (reduce) {
      node.style.transform = `translateY(${100 - target}%)`;
      if (text) text.textContent = `${Math.round(target)}%`;
      return;
    }
    let level = 0;
    let speed = 0;
    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      const force = (target - level) * 90 - speed * 11;
      speed += force * dt;
      level += speed * dt;
      node.style.transform = `translateY(${100 - level}%)`;
      if (text) text.textContent = `${Math.round(Math.max(0, Math.min(100, level)))}%`;
      if (Math.abs(target - level) > 0.2 || Math.abs(speed) > 0.2) raf = requestAnimationFrame(tick);
      else {
        node.style.transform = `translateY(${100 - target}%)`;
        if (text) text.textContent = `${Math.round(target)}%`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);
  return (
    <div className="gauge" role="meter" aria-readonly="true" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={label}>
      <div className="gauge-liquid" ref={liquid} />
      <b ref={number}>0</b>
      <small>{label}</small>
    </div>
  );
}

export function ThemeButton({ theme, onTheme }: { theme: "light" | "dark"; onTheme: () => void }) {
  const reduce = useReducedMotion();
  const dark = theme === "dark";
  return (
    <button className="icon-btn" type="button" onClick={onTheme} aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={reduce ? false : { opacity: 0, rotate: -28 }}
          animate={{ opacity: 1, rotate: 0 }}
          exit={reduce ? undefined : { opacity: 0, rotate: 20 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        >
          {dark ? <SunMark /> : <MoonMark />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function MoonMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />
    </svg>
  );
}

function SunMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

export function ProfileMenu({ name, role, onLogout }: { name: string; role: string; onLogout: () => void }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const initials = name.split(" ").slice(0, 2).map((part) => part.slice(0, 1)).join("").toUpperCase();
  return (
    <div className="profile" ref={root}>
      <button className="avatar" type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>{initials}</button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="profile-panel"
            role="menu"
            initial={reduce ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={reduce ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }}
          >
            <p>{name}</p>
            <span>{role}</span>
            <button type="button" role="menuitem" onClick={onLogout}>Выйти</button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function PageShift({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        className="workspace-page"
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.22, ease }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
