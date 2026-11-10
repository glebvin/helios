export function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const paths = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  check: "M9 11l3 3L20 6M4 7h4M4 12h3M4 17h6",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 10.5h.01",
  people: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M17 11a3 3 0 1 0-3-3M9.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  shield: "M12 3 5 6v6c0 4.5 3 6.8 7 8 4-1.2 7-3.5 7-8V6z",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  box: "M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8",
  gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.4-2.2.6a8 8 0 0 0-1.7-1L15.2 6h-4L10.8 8a8 8 0 0 0-1.7 1L7 8.4l-2 3.4L7 13a7.8 7.8 0 0 0 .1 2l-2 1.2 2 3.4 2.2-.6a8 8 0 0 0 1.7 1l.4 2h4l.4-2a8 8 0 0 0 1.7-1l2.2.6 2-3.4z",
  bell: "M6 16V10a6 6 0 1 1 12 0v6l1.5 2h-15zM10 19a2 2 0 0 0 4 0",
  play: "M8 6v12l10-6z",
  cup: "M6 8h10v5a5 5 0 0 1-5 5 5 5 0 0 1-5-5zM16 9h2.5a2.5 2.5 0 0 1 0 5H16",
  alert: "M12 9v4M12 17h.01M10.3 4.8 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.8a2 2 0 0 0-3.4 0z",
  user: "M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  plus: "M12 5v14M5 12h14",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  down: "M12 4v10M8 10l4 4 4-4M5 19h14",
};
