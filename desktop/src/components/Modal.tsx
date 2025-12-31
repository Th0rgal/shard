import ReactDOM from "react-dom";
import clsx from "clsx";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  large?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, large, className, children }: ModalProps) {
  if (!open) return null;
  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={clsx("modal", large && "modal-lg", className)} onClick={(e) => e.stopPropagation()}>
        {title && <h3 className="modal-title">{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  );
}
