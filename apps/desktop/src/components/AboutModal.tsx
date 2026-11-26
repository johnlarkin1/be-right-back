/**
 * AboutModal - Terminal-style about dialog
 */
import { motion, AnimatePresence } from "framer-motion";
import { Ghost } from "@/components/Ghost";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="about-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="about-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Close button */}
            <button className="about-modal-close" onClick={onClose}>
              ×
            </button>

            {/* Ghost mascot */}
            <div className="about-modal-ghost">
              <Ghost size={64} variant="happy" animate={true} />
            </div>

            {/* Title */}
            <h2 className="about-modal-title">be right back</h2>
            <p className="about-modal-tagline">your digital self, offline</p>

            {/* Version info */}
            <div className="about-modal-info">
              <div className="about-modal-row">
                <span className="about-modal-label">version</span>
                <span className="about-modal-value">0.1.0</span>
              </div>
              <div className="about-modal-row">
                <span className="about-modal-label">runtime</span>
                <span className="about-modal-value">tauri + mlx</span>
              </div>
              <div className="about-modal-row">
                <span className="about-modal-label">platform</span>
                <span className="about-modal-value">apple silicon</span>
              </div>
            </div>

            {/* Description */}
            <p className="about-modal-description">
              Train a personal AI on your iMessage history. Everything runs
              locally on your Mac—your data never leaves your device.
            </p>

            {/* Footer */}
            <div className="about-modal-footer">
              <span className="about-modal-copyright">
                © {new Date().getFullYear()} • privacy first
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default AboutModal;
