import { useAppStore } from "../store";
import type { Account } from "../types";

interface AccountsViewProps {
  onSetActive: (id: string) => void;
  onRemove: (account: Account) => void;
  onAdd: () => void;
  onViewDetails: (account: Account) => void;
}

export function AccountsView({ onSetActive, onRemove, onAdd, onViewDetails }: AccountsViewProps) {
  const { accounts, getActiveAccount } = useAppStore();
  const activeAccount = getActiveAccount();

  // Get avatar URL from mc-heads.net
  const getAvatarUrl = (uuid: string) => {
    const cleanUuid = uuid.replace(/-/g, "");
    return `https://mc-heads.net/avatar/${cleanUuid}/64`;
  };

  return (
    <div className="view-transition">
      <h1 className="page-title">Accounts</h1>
      <p style={{ margin: "-24px 0 24px", fontSize: 14, color: "var(--text-secondary)" }}>
        Manage your Microsoft accounts for Minecraft. Click on an avatar to customize skin and cape.
      </p>

      {accounts?.accounts.map((account) => (
        <div key={account.uuid} className="setting-row">
          <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1 }}>
            {/* Clickable avatar */}
            <button
              onClick={() => onViewDetails(account)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                borderRadius: 10,
                overflow: "hidden",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.05)";
                e.currentTarget.style.boxShadow = "0 4px 20px rgba(232, 168, 85, 0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.boxShadow = "none";
              }}
              title="View skin & cape"
            >
              <img
                src={getAvatarUrl(account.uuid)}
                alt={account.username}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 10,
                  imageRendering: "pixelated",
                  display: "block",
                }}
              />
            </button>
            <div className="setting-label" style={{ flex: 1 }}>
              <h4>{account.username}</h4>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{account.uuid}</p>
            </div>
          </div>
          <div className="setting-control">
            {accounts.active === account.uuid ? (
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Active</span>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => onSetActive(account.uuid)}>Use</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => onRemove(account)}>Remove</button>
          </div>
        </div>
      ))}

      {(!accounts || accounts.accounts.length === 0) && (
        <div className="empty-state">
          <h3>No accounts</h3>
          <p>Add a Microsoft account to play Minecraft.</p>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <button className="btn btn-primary" onClick={onAdd}>Add account</button>
      </div>
    </div>
  );
}
