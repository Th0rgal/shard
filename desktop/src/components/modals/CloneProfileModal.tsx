import { useState, useEffect } from "react";
import clsx from "clsx";
import { Modal } from "../Modal";
import { ModalFooter } from "../ModalFooter";
import { Field } from "../Field";
import { useAppStore } from "../../store";

interface CloneProfileModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (src: string, dst: string) => Promise<void>;
}

export function CloneProfileModal({ open, onClose, onSubmit }: CloneProfileModalProps) {
  const { profiles, selectedProfileId } = useAppStore();

  const [form, setForm] = useState({ src: "", dst: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setForm({ src: selectedProfileId ?? "", dst: "" });
      setErrors({});
    }
  }, [open, selectedProfileId]);

  const handleSubmit = async () => {
    const newErrors: Record<string, string> = {};
    if (!form.src.trim()) newErrors.src = "Required";
    if (!form.dst.trim()) newErrors.dst = "Required";
    if (form.src === form.dst) newErrors.dst = "Must be different";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    await onSubmit(form.src, form.dst);
  };

  return (
    <Modal open={open} onClose={onClose} title="Clone profile">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Source profile" error={errors.src}>
          <select className={clsx("input", errors.src && "input-error")} value={form.src} onChange={(e) => setForm({ ...form, src: e.target.value })}>
            <option value="">Select profile</option>
            {profiles.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </Field>
        <Field label="New profile ID" error={errors.dst}>
          <input className={clsx("input", errors.dst && "input-error")} value={form.dst} onChange={(e) => setForm({ ...form, dst: e.target.value })} placeholder="my-modpack-copy" />
        </Field>
        <ModalFooter onCancel={onClose} onSubmit={handleSubmit} submitLabel="Clone" />
      </div>
    </Modal>
  );
}
