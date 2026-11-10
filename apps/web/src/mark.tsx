export function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="wordmark">
      <svg className="mark" viewBox="0 0 34 49" aria-hidden="true">
        <path fill="currentColor" d="M0 0H34V5.44H15.35V43.18H18.65V8.89H34V48.36H0V0Z" />
      </svg>
      {compact ? <strong>GELIOS</strong> : <div><strong>GELIOS</strong><small>PARK</small></div>}
    </div>
  );
}
