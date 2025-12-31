import type { ConfirmState } from "../types";
import { ModalFooter } from "./ModalFooter";

interface ConfirmDialogProps {
  state: ConfirmState;
  onClose: () => void;
}

export function ConfirmDialog({ state, onClose }: ConfirmDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{state.title}</h3>
        <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{state.message}</p>
        <ModalFooter
          onCancel={onClose}
          onSubmit={state.onConfirm}
          submitLabel={state.confirmLabel ?? "Confirm"}
          tone={state.tone}
        />
      </div>
    </div>
  );
}
