/**
 * CRT Effect - Overlays scanlines, vignette, and phosphor glow
 * Creates the retro terminal aesthetic
 * Only rendered in retro mode via VisualEffects wrapper
 */

interface CRTEffectProps {
  showScanlines?: boolean;
  showVignette?: boolean;
  showGlow?: boolean;
}

export function CRTEffect({
  showScanlines = true,
  showVignette = true,
  showGlow = true,
}: CRTEffectProps) {
  return (
    <>
      {showGlow && <div className="crt-glow" aria-hidden="true" />}
      {showVignette && <div className="crt-vignette" aria-hidden="true" />}
      {showScanlines && <div className="crt-scanlines" aria-hidden="true" />}
    </>
  );
}

export default CRTEffect;
