import { GHOST_VARIANTS, GHOST_VARIANT_SCALES } from "../constants";
import { GhostSprite } from "../ghost-sprite";
import { mulberry32 } from "./rng";

/** Still ghosts for visitors with reduced motion or without WebGL2. */
export function StaticGhosts({ count }: { count: number }) {
  const random = mulberry32(2025);
  const ghosts = Array.from({ length: count }, (_, i) => {
    const variant = GHOST_VARIANTS[Math.floor(random() * GHOST_VARIANTS.length)];
    return {
      key: i,
      variant,
      left: 4 + random() * 88,
      top: 4 + random() * 88,
      opacity: 0.35 + random() * 0.25,
      scale: GHOST_VARIANT_SCALES[variant] ?? 1,
    };
  });

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true" data-testid="ghost-field-static">
      {ghosts.map((g) => (
        <div
          key={g.key}
          className="absolute"
          style={{
            left: `${g.left}%`,
            top: `${g.top}%`,
            opacity: g.opacity,
            transform: `scale(${g.scale})`,
          }}
        >
          <GhostSprite variant={g.variant} />
        </div>
      ))}
    </div>
  );
}
