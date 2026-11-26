/**
 * ModernEffect - Subtle ambient visual effect for modern mode
 * Provides a refined, professional aesthetic without the retro CRT effects
 */

export function ModernEffect() {
  return (
    <>
      {/* Subtle top ambient gradient - emerald glow from top */}
      <div
        className="fixed inset-0 pointer-events-none z-[-1]"
        style={{
          background: `
            radial-gradient(
              ellipse 100% 40% at 50% -10%,
              rgba(16, 185, 129, 0.04),
              transparent 60%
            )
          `,
        }}
        aria-hidden="true"
      />

      {/* Very subtle noise texture for depth */}
      <div
        className="fixed inset-0 pointer-events-none z-[-1] opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
        aria-hidden="true"
      />
    </>
  );
}

export default ModernEffect;
