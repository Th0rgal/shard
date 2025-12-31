import { Modal } from "../Modal";
import type { LaunchPlan } from "../../types";

interface LaunchPlanModalProps {
  open: boolean;
  plan: LaunchPlan | null;
  onClose: () => void;
}

export function LaunchPlanModal({ open, plan, onClose }: LaunchPlanModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Launch plan" large>
      {plan && (
        <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div><span style={{ color: "rgba(255,255,255,0.5)" }}>instance:</span> {plan.instance_dir}</div>
          <div><span style={{ color: "rgba(255,255,255,0.5)" }}>java:</span> {plan.java_exec}</div>
          <div><span style={{ color: "rgba(255,255,255,0.5)" }}>main class:</span> {plan.main_class}</div>
          <div><span style={{ color: "rgba(255,255,255,0.5)" }}>jvm args:</span> {plan.jvm_args.join(" ")}</div>
          <div><span style={{ color: "rgba(255,255,255,0.5)" }}>game args:</span> {plan.game_args.join(" ")}</div>
        </div>
      )}
    </Modal>
  );
}
