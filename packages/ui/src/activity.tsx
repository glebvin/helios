/**
 * Кольца сводки. Рисование круга и второй виток взяты из MIT-компонента
 * kokonut apple-activity-card и посажены на токены HELIOS.
 */
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, type CSSProperties } from "react";

export type ActivityRing = {
  label: string;
  current: number;
  target: number;
  unit: string;
  color: string;
};

const stroke = 14;

function paint(circle: SVGCircleElement | null, ratio: number, radius: number) {
  if (!circle) return;
  const length = radius * 2 * Math.PI;
  circle.style.strokeDasharray = `${length}`;
  circle.style.strokeDashoffset = `${(1 - Math.min(Math.max(ratio, 0), 1)) * length}`;
}

export function ActivityRings({ rings, title }: { rings: ActivityRing[]; title: string }) {
  const reduce = useReducedMotion() ?? false;
  const refs = useRef<(SVGCircleElement | null)[]>([]);
  const labelId = useId();
  const signature = rings.map((ring) => `${ring.label}:${ring.current}:${ring.target}`).join("|");

  useEffect(() => {
    const stops: Array<() => void> = [];
    rings.forEach((ring, index) => {
      const ratio = ring.target > 0 ? ring.current / ring.target : 0;
      const radius = 78 - index * 22;
      if (reduce) {
        paint(refs.current[index] ?? null, ratio, radius);
        return;
      }
      const controls = animate(0, ratio, {
        duration: 0.9,
        delay: index * 0.12,
        ease: [0.23, 1, 0.32, 1],
        onUpdate: (value) => paint(refs.current[index] ?? null, value, radius),
      });
      stops.push(() => controls.stop());
    });
    return () => stops.forEach((stop) => stop());
  }, [reduce, signature, rings]);

  return (
    <figure aria-labelledby={labelId} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 18, alignItems: "center", margin: 0 }}>
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={title}>
        {rings.map((ring, index) => {
          const radius = 78 - index * 22;
          return (
            <g key={ring.label}>
              <circle cx="90" cy="90" r={radius} fill="none" stroke="#eceae4" strokeWidth={stroke} />
              <circle
                ref={(node) => {
                  refs.current[index] = node;
                }}
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                transform="rotate(-90 90 90)"
              />
            </g>
          );
        })}
      </svg>
      <figcaption id={labelId}>
        <div className="badge" style={{ marginBottom: 12 }}>
          <i />
          Учебные цифры
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {rings.map((ring) => (
            <li key={ring.label} className="stat">
              <span>{ring.label}</span>
              <strong style={{ color: ring.color, fontSize: 22 } as CSSProperties}>
                {ring.current}
                <span style={{ color: "var(--muted)", fontSize: 14 }}> / {ring.target} {ring.unit}</span>
              </strong>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
