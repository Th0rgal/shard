interface ModalFooterProps {
  onCancel: () => void;
  onSubmit: () => void;
  cancelLabel?: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  tone?: "default" | "danger";
}

export function ModalFooter({
  onCancel,
  onSubmit,
  cancelLabel = "Cancel",
  submitLabel = "Submit",
  submitDisabled = false,
  tone = "default",
}: ModalFooterProps) {
  return (
    <div className="modal-footer">
      <button className="btn btn-secondary" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button
        className={tone === "danger" ? "btn btn-danger" : "btn btn-primary"}
        onClick={onSubmit}
        disabled={submitDisabled}
      >
        {submitLabel}
      </button>
    </div>
  );
}
