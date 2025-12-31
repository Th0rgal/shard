import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "../Modal";
import { useAppStore } from "../../store";
import type { DeviceCode } from "../../types";

interface DeviceCodeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export function DeviceCodeModal({ open, onClose, onSuccess }: DeviceCodeModalProps) {
  const { config, runAction, notify } = useAppStore();

  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setDeviceCode(null);
      setPending(false);
    }
  }, [open]);

  const handleRequestCode = async () => {
    await runAction(async () => {
      const data = await invoke<DeviceCode>("request_device_code_cmd", {
        client_id: config?.msa_client_id ?? null,
        client_secret: config?.msa_client_secret ?? null,
      });
      setDeviceCode(data);
    });
  };

  const handleFinish = async () => {
    if (!deviceCode) return;
    setPending(true);
    try {
      await invoke("finish_device_code_flow_cmd", {
        client_id: config?.msa_client_id ?? null,
        client_secret: config?.msa_client_secret ?? null,
        device: deviceCode,
      });
      await onSuccess();
      onClose();
    } catch (err) {
      notify("Sign-in failed", String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Microsoft account">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!deviceCode ? (
          <>
            <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>
              Sign in with your Microsoft account to play Minecraft.
            </p>
            <button className="btn btn-primary" onClick={handleRequestCode}>Get sign-in code</button>
          </>
        ) : (
          <>
            <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Your code</div>
              <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: "0.1em", marginTop: 8 }}>{deviceCode.user_code}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 8 }}>{deviceCode.verification_uri}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => openUrl(deviceCode.verification_uri)}>Open browser</button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigator.clipboard.writeText(deviceCode.user_code)}>Copy code</button>
            </div>
            <button className="btn btn-primary" onClick={handleFinish} disabled={pending}>
              {pending ? "Waiting…" : "I've signed in"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
