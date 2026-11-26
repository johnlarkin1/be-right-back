/** Pixel ghost path on a 19×21 grid. The logo, CTA, and Casper preview use it. */
const GHOST_PATH =
  "M4 1H15V2H16V3H17V4H18V17H17V16H16V15H15V16H14V17H13V16H12V15H11V16H10V17H9V16H8V15H7V16H6V17H5V16H4V15H3V16H2V17H1V4H2V3H3V2H4V1Z";

interface GhostMarkProps {
  /** Width in px. Height follows the 19:21 grid. */
  size?: number;
  color?: string;
  /** Eye color. Match the surface behind the ghost. */
  eyeColor?: string;
  className?: string;
}

export function GhostMark({
  size = 22,
  color = "var(--crt-text)",
  eyeColor = "var(--crt-bg)",
  className,
}: GhostMarkProps) {
  return (
    <svg
      width={size}
      height={Math.round((size * 21) / 19)}
      viewBox="0 0 19 21"
      aria-hidden="true"
      className={className}
    >
      <path d={GHOST_PATH} fill={color} />
      <rect x="6" y="6" width="2" height="3" fill={eyeColor} />
      <rect x="11" y="6" width="2" height="3" fill={eyeColor} />
    </svg>
  );
}
