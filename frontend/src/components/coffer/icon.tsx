import type { CSSProperties } from "react";

const paths = {
  arrow: "M5 12h14M13 6l6 6-6 6",
  northeast: "M6 18 18 6M6 6h12v12",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  treasury: "M3 9h18L12 3 3 9ZM5 12v6M10 12v6M14 12v6M19 12v6M3 21h18",
  invoice: "M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM8 8h8M8 12h8M8 16h4",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
  agents:
    "M8 8h8v8H8zM12 2v6M12 16v6M2 12h6M16 12h6M4 4l4 4M16 16l4 4M4 20l4-4M16 8l4-4",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4",
  activity: "M2 12h4l3-8 6 16 3-8h4",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  lock: "M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4M12 14v3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2",
  menu: "M4 6h16M4 12h16M4 18h16",
  pause: "M8 5v14M16 5v14",
  play: "m7 3 14 9-14 9V3Z",
  logout: "M9 3H3v18h6M9 12h12m-5-5 5 5-5 5",
  refresh: "M20 11a8 8 0 1 0-2 5M20 4v7h-7",
} as const;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
