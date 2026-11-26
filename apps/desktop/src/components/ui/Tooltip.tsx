/**
 * Tooltip - Mode-aware tooltip component
 * Shows explanatory text on hover with dual-mode styling
 * Uses Framer Motion for smooth animations
 */
import { useState, useRef, useId, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  /** The tooltip content - displayed on hover */
  content: string;
  /** The element(s) that trigger the tooltip */
  children: React.ReactNode;
  /** Override automatic positioning (default: "bottom") */
  position?: TooltipPosition;
  /** Delay before showing tooltip in ms (default: 0 = instant) */
  delayMs?: number;
  /** Additional className for wrapper */
  className?: string;
}

export function Tooltip({
  content,
  children,
  position = "bottom",
  delayMs = 0,
  className = "",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [computedPosition, setComputedPosition] =
    useState<TooltipPosition>(position);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  // Handle mouse enter with delay
  const handleMouseEnter = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delayMs);
  }, [delayMs]);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  }, []);

  // Compute position to avoid viewport edges
  useEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newPosition = position;

      // Check if tooltip would overflow viewport
      if (position === "top" && triggerRect.top < tooltipRect.height + 10) {
        newPosition = "bottom";
      } else if (
        position === "bottom" &&
        triggerRect.bottom + tooltipRect.height + 10 > viewportHeight
      ) {
        newPosition = "top";
      } else if (
        position === "left" &&
        triggerRect.left < tooltipRect.width + 10
      ) {
        newPosition = "right";
      } else if (
        position === "right" &&
        triggerRect.right + tooltipRect.width + 10 > viewportWidth
      ) {
        newPosition = "left";
      }

      setComputedPosition(newPosition);
    }
  }, [isVisible, position]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Animation variants with centering offset
  // Use Framer Motion x/y instead of CSS transform (which gets overwritten by scale)
  const getTooltipVariants = (pos: TooltipPosition) => {
    const isHorizontal = pos === "top" || pos === "bottom";
    return {
      hidden: {
        opacity: 0,
        scale: 0.95,
        x: isHorizontal ? "-50%" : 0,
        y: isHorizontal ? 0 : "-50%",
      },
      visible: {
        opacity: 1,
        scale: 1,
        x: isHorizontal ? "-50%" : 0,
        y: isHorizontal ? 0 : "-50%",
      },
    };
  };

  // Position styles (no transform - handled by Framer Motion)
  // calc(50% + 20px) shifts tooltip 20px right to better align with trigger visually
  const positionStyles: Record<TooltipPosition, React.CSSProperties> = {
    top: {
      bottom: "100%",
      left: "calc(50% + 20px)",
      marginBottom: 8,
    },
    bottom: {
      top: "100%",
      left: "calc(50% + 20px)",
      marginTop: 8,
    },
    left: {
      right: "100%",
      top: "50%",
      marginRight: 8,
    },
    right: {
      left: "100%",
      top: "50%",
      marginLeft: 8,
    },
  };

  // Arrow class for each position
  const arrowClassMap: Record<TooltipPosition, string> = {
    top: "tooltip-arrow-top",
    bottom: "tooltip-arrow-bottom",
    left: "tooltip-arrow-left",
    right: "tooltip-arrow-right",
  };

  return (
    <span
      ref={triggerRef}
      className={`tooltip-wrapper ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      aria-describedby={isVisible ? tooltipId : undefined}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className="tooltip"
            style={positionStyles[computedPosition]}
            variants={getTooltipVariants(computedPosition)}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {content}
            <div
              className={`tooltip-arrow ${arrowClassMap[computedPosition]}`}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

export default Tooltip;
