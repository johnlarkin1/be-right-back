import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react";

type Direction = "down" | "up";

/**
 * Measures available space above/below a trigger element and returns
 * the preferred dropdown direction. Defaults to "down"; flips to "up"
 * only when the dropdown would overflow the viewport bottom and there's
 * more space above.
 *
 * Pass the returned `dropdownRef` to the dropdown element so the hook
 * can measure its actual rendered height instead of guessing.
 */
export function useDropdownDirection(
  triggerRef: RefObject<HTMLElement | null>,
  isOpen: boolean = false,
): { direction: Direction; dropdownRef: RefObject<HTMLDivElement | null> } {
  const [direction, setDirection] = useState<Direction>("down");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    // Use actual dropdown height if available, otherwise estimate
    const dropdownHeight = dropdownRef.current?.scrollHeight ?? 300;

    setDirection(
      spaceBelow < dropdownHeight && spaceAbove > spaceBelow ? "up" : "down",
    );
  }, [triggerRef]);

  useEffect(() => {
    if (!isOpen) return;
    // Measure on next frame so the dropdown has rendered
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [isOpen, measure]);

  return { direction, dropdownRef };
}
