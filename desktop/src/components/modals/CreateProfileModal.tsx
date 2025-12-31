import { useState, useEffect, useCallback } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../Modal";
import { ModalFooter } from "../ModalFooter";
import { Field } from "../Field";
import { useAppStore } from "../../store";
import type { Template, MinecraftVersionsResponse, ManifestVersion } from "../../types";

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
  const { notify } = useAppStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("default");
  const [profileName, setProfileName] = useState("");
  const [mcVersion, setMcVersion] = useState("");
  const [mcVersions, setMcVersions] = useState<ManifestVersion[]>([]);
  const [mcVersionsLoading, setMcVersionsLoading] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [error, setError] = useState("");

  // Load Minecraft versions
  const loadMcVersions = useCallback(async () => {
    setMcVersionsLoading(true);
    try {
      const response = await invoke<MinecraftVersionsResponse>("fetch_minecraft_versions_cmd");
      setMcVersions(response.versions);
      // Set default to latest release if not already set
      if (!mcVersion && response.latest_release) {
        setMcVersion(response.latest_release);
      }
    } catch (err) {
      console.error("Failed to load MC versions:", err);
    } finally {
      setMcVersionsLoading(false);
    }
  }, [mcVersion]);

  // Load templates when modal opens
  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
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
      // Sort to put "default" first, then "vanilla", then alphabetically
      loaded.sort((a, b) => {
        if (a.id === "default") return -1;
        if (b.id === "default") return 1;
        if (a.id === "vanilla") return -1;
        if (b.id === "vanilla") return 1;
        return a.name.localeCompare(b.name);
      });
      setTemplates(loaded);

      // Auto-select "default" if available and set its MC version
      if (loaded.some(t => t.id === "default")) {
        setSelectedTemplateId("default");
        const defaultTemplate = loaded.find(t => t.id === "default");
        if (defaultTemplate?.mc_version) {
          setMcVersion(defaultTemplate.mc_version);
        }
      } else if (loaded.length > 0) {
        setSelectedTemplateId(loaded[0].id);
        if (loaded[0].mc_version) {
          setMcVersion(loaded[0].mc_version);
        }
      }
    } catch (err) {
      console.error("Failed to load templates:", err);
      notify("Failed to load templates", String(err));
    } finally {
      setTemplatesLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (open) {
      void loadTemplates();
      void loadMcVersions();
      setProfileName("");
      setError("");
    }
  }, [open, loadTemplates, loadMcVersions]);

  // Update MC version when template changes
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find(t => t.id === templateId);
    if (template?.mc_version) {
      setMcVersion(template.mc_version);
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (!profileName.trim()) {
      setError("Profile name is required");
      return;
    }

    if (!mcVersion.trim()) {
      setError("Minecraft version is required");
      return;
    }

    const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
    if (!selectedTemplate) {
      setError("Please select a template");
      return;
    }

    // Build form from template with user-selected MC version
    const form: CreateProfileForm = {
      id: profileName.trim(),
      mcVersion: mcVersion.trim(),
      loaderType: selectedTemplate.loader?.type ?? "",
      loaderVersion: selectedTemplate.loader?.version ?? "",
      java: "",
      memory: selectedTemplate.runtime?.memory ?? "",
      args: selectedTemplate.runtime?.args?.join(" ") ?? "",
      templateId: selectedTemplate.id,
    };

    await onSubmit(form);
  };

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  // Filter versions based on showSnapshots toggle
  const filteredVersions = showSnapshots
    ? mcVersions
    : mcVersions.filter(v => v.type === "release");

  return (
    <Modal open={open} onClose={onClose} title="New profile">
      <div className="create-profile-modal">
        {/* Template list */}
        <div className="template-section">
          <label className="field-label">Template</label>
          {templatesLoading ? (
            <div className="template-loading">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="template-empty">No templates available</div>
          ) : (
            <div className="template-list">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={clsx("template-item", selectedTemplateId === template.id && "selected")}
                  onClick={() => handleTemplateSelect(template.id)}
                >
                  <div className="template-item-radio">
                    <div className="template-item-radio-inner" />
                  </div>
                  <div className="template-item-content">
                    <div className="template-item-header">
                      <span className="template-item-name">{template.name}</span>
                      {template.loader?.type && (
                        <span className="template-item-loader">{template.loader.type}</span>
                      )}
                    </div>
                    {template.description && (
                      <span className="template-item-description">{template.description}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Minecraft version selector */}
        <Field label="Minecraft version">
          <div className="version-row">
            <select
              className="select"
              value={mcVersion}
              onChange={(e) => setMcVersion(e.target.value)}
              disabled={mcVersionsLoading}
            >
              {mcVersionsLoading ? (
                <option>Loading...</option>
              ) : (
                filteredVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                  </option>
                ))
              )}
            </select>
            <label className="snapshots-toggle">
              <input
                type="checkbox"
                checked={showSnapshots}
                onChange={(e) => setShowSnapshots(e.target.checked)}
              />
              <span>Snapshots</span>
            </label>
          </div>
        </Field>

        {/* Profile name */}
        <Field label="Profile name" error={error}>
          <input
            className={clsx("input", error && "input-error")}
            value={profileName}
            onChange={(e) => {
              setProfileName(e.target.value);
              setError("");
            }}
            placeholder="my-world"
            autoFocus
          />
        </Field>

        <ModalFooter onCancel={onClose} onSubmit={handleSubmit} submitLabel="Create" />
      </div>

      <style>{`
        .create-profile-modal {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .template-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .template-list {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          overflow: hidden;
        }

        .template-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 14px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: background 0.15s ease;
          text-align: left;
          width: 100%;
        }

        .template-item:last-child {
          border-bottom: none;
        }

        .template-item:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .template-item.selected {
          background: rgba(232, 168, 85, 0.06);
        }

        .template-item-radio {
          width: 16px;
          height: 16px;
          border: 2px solid var(--border-default);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 1px;
          transition: border-color 0.15s ease;
        }

        .template-item.selected .template-item-radio {
          border-color: var(--accent-primary);
        }

        .template-item-radio-inner {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: transparent;
          transition: background 0.15s ease;
        }

        .template-item.selected .template-item-radio-inner {
          background: var(--accent-primary);
        }

        .template-item-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        .template-item-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .template-item-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .template-item-loader {
          font-size: 11px;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.06);
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: capitalize;
        }

        .template-item-description {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.4;
        }

        .template-loading,
        .template-empty {
          padding: 24px;
          text-align: center;
          font-size: 13px;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
        }

        .version-row {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .version-row .select {
          flex: 1;
        }

        .snapshots-toggle {
          display: flex;
          gap: 6px;
          align-items: center;
          font-size: 12px;
          color: var(--text-muted);
          cursor: pointer;
          white-space: nowrap;
        }

        .snapshots-toggle input {
          cursor: pointer;
        }
      `}</style>
    </Modal>
  );
}
