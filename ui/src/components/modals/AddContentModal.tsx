import { useState, useEffect } from "react";
import clsx from "clsx";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { Modal } from "../Modal";
import { Field } from "../Field";
import type { ContentTab } from "../../types";
import { getContentTypeLabel } from "../../utils";

interface AddContentModalProps {
  open: boolean;
  kind: ContentTab;
  onClose: () => void;
  onSubmit: (input: string, name: string | null, version: string | null) => Promise<void>;
}

export function AddContentModal({ open, kind, onClose, onSubmit }: AddContentModalProps) {
  const [form, setForm] = useState({ input: "", url: "", name: "", version: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setForm({ input: "", url: "", name: "", version: "" });
      setErrors({});
    }
  }, [open]);

  const handleFilePick = async () => {
    const selected = await dialogOpen({ multiple: false, directory: false });
    if (typeof selected === "string") {
      setForm((prev) => ({ ...prev, input: selected }));
    }
  };

  const handleSubmit = async () => {
    const inputValue = form.input || form.url;
    const newErrors: Record<string, string> = {};
    if (!inputValue) newErrors.input = "Pick a file or paste a URL";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    await onSubmit(
      inputValue,
      form.name.trim() || null,
      form.version.trim() || null
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={`Add ${getContentTypeLabel(kind)}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <button className="btn-secondary" onClick={handleFilePick}>Choose file…</button>
        {form.input && <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.6)", wordBreak: "break-all" }}>{form.input}</div>}
        <Field label="Or paste a URL" error={errors.input}>
          <input className={clsx("input", errors.input && "input-error")} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://modrinth.com/…" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Name (optional)">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Version (optional)">
            <input className="input" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
          </Field>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit}>Add</button>
        </div>
      </div>
    </Modal>
  );
}
