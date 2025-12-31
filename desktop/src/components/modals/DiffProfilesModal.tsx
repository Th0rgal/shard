import { useState, useEffect } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../Modal";
import { Field } from "../Field";
import { useAppStore } from "../../store";
import type { DiffResult } from "../../types";

interface DiffProfilesModalProps {
  open: boolean;
  onClose: () => void;
}

export function DiffProfilesModal({ open, onClose }: DiffProfilesModalProps) {
  const { profiles, selectedProfileId, runAction } = useAppStore();

  const [form, setForm] = useState({ a: "", b: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DiffResult | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ a: selectedProfileId ?? "", b: "" });
      setResult(null);
      setErrors({});
    }
  }, [open, selectedProfileId]);

  const handleCompare = async () => {
    const newErrors: Record<string, string> = {};
    if (!form.a) newErrors.a = "Required";
    if (!form.b) newErrors.b = "Required";
    if (form.a && form.b && form.a === form.b) newErrors.b = "Pick different profile";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    await runAction(async () => {
      const diffResult = await invoke<DiffResult>("diff_profiles_cmd", { a: form.a, b: form.b });
      setResult(diffResult);
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Compare profiles" large>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Profile A" error={errors.a}>
            <select className={clsx("input", errors.a && "input-error")} value={form.a} onChange={(e) => setForm({ ...form, a: e.target.value })}>
              <option value="">Select</option>
              {profiles.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </Field>
          <Field label="Profile B" error={errors.b}>
            <select className={clsx("input", errors.b && "input-error")} value={form.b} onChange={(e) => setForm({ ...form, b: e.target.value })}>
              <option value="">Select</option>
              {profiles.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </Field>
        </div>
        <button className="btn btn-primary" onClick={handleCompare}>Compare</button>
        {result && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 8 }}>
            <div>
              <div className="field-label">Only in A</div>
              {result.only_a.length === 0 ? <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>—</div> : result.only_a.map((n) => <div key={n} style={{ fontSize: 13 }}>{n}</div>)}
            </div>
            <div>
              <div className="field-label">Only in B</div>
              {result.only_b.length === 0 ? <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>—</div> : result.only_b.map((n) => <div key={n} style={{ fontSize: 13 }}>{n}</div>)}
            </div>
            <div>
              <div className="field-label">In both</div>
              {result.both.length === 0 ? <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>—</div> : result.both.map((n) => <div key={n} style={{ fontSize: 13 }}>{n}</div>)}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
