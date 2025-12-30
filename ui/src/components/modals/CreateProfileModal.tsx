import { useState, useEffect, useMemo, useCallback } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../Modal";
import { ModalFooter } from "../ModalFooter";
import { Field } from "../Field";
import { useAppStore } from "../../store";
import type { ManifestVersion, MinecraftVersionsResponse, Template } from "../../types";

interface CreateProfileModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: CreateProfileForm) => Promise<void>;
}

export interface CreateProfileForm {
  id: string;
  mcVersion: string;
  loaderType: string;
  loaderVersion: string;
  java: string;
  memory: string;
  args: string;
  templateId?: string | null;
}

export function CreateProfileModal({ open, onClose, onSubmit }: CreateProfileModalProps) {
  const { mcVersions, mcVersionLoading, loaderVersions, loaderLoading, setMcVersions, setMcVersionLoading, setLoaderVersions, setLoaderLoading, notify } = useAppStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [creationMode, setCreationMode] = useState<"blank" | "template">("blank");

  const [form, setForm] = useState<CreateProfileForm>({
    id: "",
    mcVersion: "",
    loaderType: "",
    loaderVersion: "",
    java: "",
    memory: "",
    args: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showSnapshots, setShowSnapshots] = useState(false);

  const visibleVersions = useMemo(() => {
    return mcVersions.filter((entry) => showSnapshots || entry.type === "release");
  }, [mcVersions, showSnapshots]);

  const latestRelease = useMemo(() => {
    return mcVersions.find((entry) => entry.type === "release")?.id;
  }, [mcVersions]);

  // Load templates
  const loadTemplates = useCallback(async () => {
    try {
      const ids = await invoke<string[]>("list_templates_cmd");
      const loaded: Template[] = [];
      for (const id of ids) {
        try {
          const template = await invoke<Template>("load_template_cmd", { id });
          loaded.push(template);
        } catch {
          // Skip invalid templates
        }
      }
      setTemplates(loaded);
    } catch (err) {
      console.error("Failed to load templates:", err);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadTemplates();
    }
  }, [open, loadTemplates]);

  useEffect(() => {
    if (open && mcVersions.length === 0) {
      fetchMinecraftVersions();
    }
  }, [open, mcVersions.length]);

  useEffect(() => {
    if (open && form.loaderType === "fabric" && loaderVersions.length === 0 && !loaderLoading) {
      fetchLoaderVersions();
    }
  }, [open, form.loaderType, loaderVersions.length, loaderLoading]);

  useEffect(() => {
    if (open) {
      setForm({ id: "", mcVersion: "", loaderType: "", loaderVersion: "", java: "", memory: "", args: "", templateId: null });
      setErrors({});
      setCreationMode("blank");
      setSelectedTemplate(null);
    }
  }, [open]);

  // Apply template values when selected
  const handleSelectTemplate = (template: Template | null) => {
    setSelectedTemplate(template);
    if (template) {
      setForm((prev) => ({
        ...prev,
        mcVersion: template.mc_version,
        loaderType: template.loader?.type ?? "",
        loaderVersion: template.loader?.version ?? "",
        templateId: template.id,
      }));
      // Fetch loader versions if needed
      if (template.loader?.type === "fabric" && loaderVersions.length === 0 && !loaderLoading) {
        fetchLoaderVersions();
      }
    }
  };

  const fetchMinecraftVersions = async () => {
    setMcVersionLoading(true);
    try {
      const data = await invoke<MinecraftVersionsResponse>("fetch_minecraft_versions_cmd");
      setMcVersions(data.versions);
      if (!form.mcVersion && data.latest_release) {
        setForm((prev) => ({ ...prev, mcVersion: data.latest_release! }));
      }
    } catch (err) {
      console.error("Failed to fetch Minecraft versions:", err);
      notify("Failed to fetch Minecraft versions", String(err));
    } finally {
      setMcVersionLoading(false);
    }
  };

  const fetchLoaderVersions = async () => {
    setLoaderLoading(true);
    try {
      const versions = await invoke<string[]>("fetch_fabric_versions_cmd");
      setLoaderVersions(versions);
    } catch (err) {
      console.error("Failed to fetch Fabric versions:", err);
      notify("Failed to fetch Fabric versions", String(err));
    } finally {
      setLoaderLoading(false);
    }
  };

  const handleSubmit = async () => {
    const newErrors: Record<string, string> = {};
    if (!form.id.trim()) newErrors.id = "Required";
    if (!form.mcVersion.trim()) newErrors.mcVersion = "Required";
    if (form.loaderType && !form.loaderVersion.trim()) newErrors.loaderVersion = "Required";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    await onSubmit(form);
  };

  return (
    <Modal open={open} onClose={onClose} title="Create profile">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Creation mode selector */}
        <div className="content-tabs" style={{ marginBottom: 8 }}>
          <button
            className={clsx("content-tab", creationMode === "blank" && "active")}
            onClick={() => {
              setCreationMode("blank");
              setSelectedTemplate(null);
              setForm((prev) => ({ ...prev, templateId: null }));
            }}
          >
            Blank Profile
          </button>
          <button
            className={clsx("content-tab", creationMode === "template" && "active")}
            onClick={() => setCreationMode("template")}
          >
            From Template
            {templates.length > 0 && <span className="count">{templates.length}</span>}
          </button>
        </div>

        {/* Template selector */}
        {creationMode === "template" && (
          <div style={{ marginBottom: 8 }}>
            {templates.length === 0 ? (
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 12,
                  padding: 20,
                  textAlign: "center",
                }}
              >
                <p style={{ color: "var(--text-muted)", margin: 0, fontSize: 13 }}>
                  No templates available. Create templates via CLI using <code style={{ fontSize: 11 }}>shard template</code>.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="content-item"
                    onClick={() => handleSelectTemplate(template)}
                    style={{
                      cursor: "pointer",
                      background: selectedTemplate?.id === template.id ? "rgba(124, 199, 255, 0.1)" : undefined,
                      borderColor: selectedTemplate?.id === template.id ? "rgba(124, 199, 255, 0.2)" : undefined,
                    }}
                  >
                    <div className="content-item-info">
                      <h5 style={{ margin: 0 }}>{template.name}</h5>
                      <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                        {template.description}
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                        MC {template.mc_version}
                        {template.loader && ` • ${template.loader.type}`}
                        {template.mods.length > 0 && ` • ${template.mods.length} mods`}
                        {template.shaderpacks.length > 0 && ` • ${template.shaderpacks.length} shaders`}
                      </p>
                    </div>
                    {selectedTemplate?.id === template.id && (
                      <div style={{ color: "var(--accent-primary)", fontSize: 18 }}>✓</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Field label="Profile ID" error={errors.id}>
          <input
            className={clsx("input", errors.id && "input-error")}
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="my-modpack"
          />
        </Field>
        <Field label="Minecraft version" error={errors.mcVersion}>
          <select
            className={clsx("input", errors.mcVersion && "input-error")}
            value={form.mcVersion}
            onChange={(e) => setForm({ ...form, mcVersion: e.target.value })}
          >
            <option value="">{mcVersionLoading ? "Loading…" : "Select version"}</option>
            {visibleVersions.map((v) => (
              <option key={v.id} value={v.id}>{v.id}{v.type === "snapshot" ? " (snapshot)" : ""}</option>
            ))}
          </select>
          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            <button type="button" className="link" onClick={() => setShowSnapshots(!showSnapshots)}>
              {showSnapshots ? "Hide snapshots" : "Show snapshots"}
            </button>
            {latestRelease && (
              <button type="button" className="link" onClick={() => setForm((p) => ({ ...p, mcVersion: latestRelease }))}>
                Use latest ({latestRelease})
              </button>
            )}
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Loader" error={errors.loaderType}>
            <select
              className="input"
              value={form.loaderType || "none"}
              onChange={(e) => setForm((p) => ({
                ...p,
                loaderType: e.target.value === "none" ? "" : e.target.value,
                loaderVersion: e.target.value === "none" ? "" : p.loaderVersion,
              }))}
            >
              <option value="none">None (Vanilla)</option>
              <option value="fabric">Fabric</option>
            </select>
          </Field>
          <Field label="Loader version" error={errors.loaderVersion}>
            <select
              className={clsx("input", errors.loaderVersion && "input-error")}
              value={form.loaderVersion}
              onChange={(e) => setForm({ ...form, loaderVersion: e.target.value })}
              disabled={!form.loaderType}
            >
              <option value="">{loaderLoading ? "Loading…" : "Select version"}</option>
              {loaderVersions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Java path (optional)">
            <input className="input" value={form.java} onChange={(e) => setForm({ ...form, java: e.target.value })} placeholder="/usr/bin/java" />
          </Field>
          <Field label="Memory (optional)">
            <input className="input" value={form.memory} onChange={(e) => setForm({ ...form, memory: e.target.value })} placeholder="4G" />
          </Field>
        </div>
        <Field label="Extra JVM args (optional)">
          <input className="input" value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="-Dfile.encoding=UTF-8" />
        </Field>
        <ModalFooter onCancel={onClose} onSubmit={handleSubmit} submitLabel="Create" />
      </div>
    </Modal>
  );
}
