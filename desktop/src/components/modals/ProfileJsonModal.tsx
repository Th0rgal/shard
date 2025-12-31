import { Modal } from "../Modal";
import type { Profile } from "../../types";

interface ProfileJsonModalProps {
  open: boolean;
  profile: Profile | null;
  onClose: () => void;
}

export function ProfileJsonModal({ open, profile, onClose }: ProfileJsonModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Profile JSON" large>
      <pre style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 16, fontSize: 12, fontFamily: "var(--font-mono)", overflow: "auto", maxHeight: 400 }}>
        {profile ? JSON.stringify(profile, null, 2) : "No profile"}
      </pre>
    </Modal>
  );
}
