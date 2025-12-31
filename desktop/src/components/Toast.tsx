import type { Toast as ToastType } from "../types";

interface ToastProps {
  toast: ToastType;
}

export function Toast({ toast }: ToastProps) {
  return (
    <div className="toast">
      <div className="toast-title">{toast.title}</div>
      {toast.detail && <div className="toast-detail">{toast.detail}</div>}
    </div>
  );
}
