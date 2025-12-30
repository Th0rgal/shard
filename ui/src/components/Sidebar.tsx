import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useAppStore } from "../store";
import type { ProfileFolder } from "../types";

interface SidebarProps {
  onCreateProfile: () => void;
  onCloneProfile: () => void;
  onDiffProfiles: () => void;
  onAddAccount: () => void;
  onDeleteProfile: (id: string) => void;
}

export function Sidebar({
  onCreateProfile,
  onCloneProfile,
  onDiffProfiles,
  onAddAccount,
  onDeleteProfile,
}: SidebarProps) {
  const {
    profiles,
    profile,
    selectedProfileId,
    setSelectedProfileId,
    profileFilter,
    setProfileFilter,
    sidebarView,
    setSidebarView,
    getActiveAccount,
    profileOrg,
    contextMenuTarget,
    setContextMenuTarget,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolderCollapsed,
    moveProfileToFolder,
    reorderProfileInFolder,
    setFavoriteProfile,
    loadProfileOrganization,
    syncProfileOrganization,
  } = useAppStore();

  const activeAccount = getActiveAccount();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const addMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Drag and drop state
  const [draggedProfile, setDraggedProfile] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ type: "folder" | "profile" | "ungrouped"; id: string; position?: "before" | "after" } | null>(null);

  // Load organization on mount and sync when profiles change
  useEffect(() => {
    loadProfileOrganization();
  }, [loadProfileOrganization]);

  useEffect(() => {
    syncProfileOrganization();
  }, [profiles, syncProfileOrganization]);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuTarget(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [setContextMenuTarget]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingFolderId && folderInputRef.current) {
      folderInputRef.current.focus();
      folderInputRef.current.select();
    }
  }, [editingFolderId]);

  const filteredProfiles = (() => {
    const query = profileFilter.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter((id) => id.toLowerCase().includes(query));
  })();

  const handleContextMenu = (e: React.MouseEvent, type: "profile" | "folder", id: string) => {
    e.preventDefault();
    setContextMenuTarget({ type, id, x: e.clientX, y: e.clientY });
  };

  const handleCreateFolder = () => {
    setShowAddMenu(false);
    // Use setTimeout to ensure the menu closes first and DOM updates
    setTimeout(() => {
      const folderId = createFolder("");
      setEditingFolderId(folderId);
      setEditingName("");
    }, 0);
  };

  const handleStartRename = (folder: ProfileFolder) => {
    setEditingFolderId(folder.id);
    setEditingName(folder.name);
    setContextMenuTarget(null);
  };

  const handleFinishRename = () => {
    if (editingFolderId) {
      if (editingName.trim()) {
        renameFolder(editingFolderId, editingName.trim());
      } else {
        // If name is empty, delete the folder (it was probably just created)
        deleteFolder(editingFolderId);
      }
    }
    setEditingFolderId(null);
    setEditingName("");
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, profileId: string) => {
    setDraggedProfile(profileId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", profileId);
    // Add a slight delay to set drag image
    const target = e.currentTarget as HTMLElement;
    setTimeout(() => {
      target.style.opacity = "0.5";
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = "1";
    setDraggedProfile(null);
    setDragOverTarget(null);
  };

  const handleDragOver = (e: React.DragEvent, targetType: "folder" | "profile" | "ungrouped", targetId: string, position?: "before" | "after") => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (draggedProfile && draggedProfile !== targetId) {
      setDragOverTarget({ type: targetType, id: targetId, position });
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're actually leaving the element (not entering a child)
    const relatedTarget = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverTarget(null);
    }
  };

  const handleDropOnFolder = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const profileToMove = draggedProfile;
    // Clear state first
    setDraggedProfile(null);
    setDragOverTarget(null);
    // Then perform the move
    if (profileToMove) {
      moveProfileToFolder(profileToMove, folderId);
    }
  };

  const handleDropOnProfile = (e: React.DragEvent, targetProfileId: string, folderId: string | null, currentIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const profileToMove = draggedProfile;
    const position = dragOverTarget?.position || "after";
    // Clear state first
    setDraggedProfile(null);
    setDragOverTarget(null);
    // Then perform the reorder
    if (profileToMove && profileToMove !== targetProfileId) {
      const targetIndex = position === "before" ? currentIndex : currentIndex + 1;
      reorderProfileInFolder(profileToMove, folderId, targetIndex);
    }
  };

  const handleDropOnUngrouped = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const profileToMove = draggedProfile;
    const targetType = dragOverTarget?.type;
    // Clear state first
    setDraggedProfile(null);
    setDragOverTarget(null);
    // Only move to ungrouped if not dropping on a specific profile or folder
    if (profileToMove && (targetType === "ungrouped" || !targetType)) {
      moveProfileToFolder(profileToMove, null);
    }
  };

  const isFavorite = (profileId: string) => profileOrg.favoriteProfile === profileId;

  const renderProfile = (id: string, indent = false, folderId: string | null = null, index: number = 0) => {
    const isSelected = selectedProfileId === id;
    const matchesFilter = filteredProfiles.includes(id);
    if (!matchesFilter && profileFilter) return null;

    const isDragging = draggedProfile === id;
    const isDropTarget = dragOverTarget?.type === "profile" && dragOverTarget.id === id;
    const dropPosition = isDropTarget ? dragOverTarget.position : null;

    return (
      <button
        key={id}
        className={clsx(
          "tree-item",
          isSelected && "active",
          indent && "tree-item-indent",
          isFavorite(id) && "tree-item-favorite",
          isDragging && "tree-item-dragging",
          dropPosition === "before" && "tree-item-drop-before",
          dropPosition === "after" && "tree-item-drop-after"
        )}
        onClick={() => {
          setSelectedProfileId(id);
          setSidebarView("profiles");
        }}
        onContextMenu={(e) => handleContextMenu(e, "profile", id)}
        draggable
        onDragStart={(e) => handleDragStart(e, id)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const position = e.clientY < midY ? "before" : "after";
          handleDragOver(e, "profile", id, position);
        }}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDropOnProfile(e, id, folderId, index)}
        data-tauri-drag-region="false"
      >
        {isFavorite(id) && (
          <span className="tree-item-star" title="Favorite profile">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 1l1.545 3.13 3.455.502-2.5 2.436.59 3.441L6 8.885 2.91 10.51l.59-3.441L1 4.632l3.455-.502L6 1z" />
            </svg>
          </span>
        )}
        <span className="tree-item-label">{id}</span>
      </button>
    );
  };

  const renderFolder = (folder: ProfileFolder) => {
    const matchingProfiles = folder.profiles.filter((id) => filteredProfiles.includes(id));
    const hasMatches = matchingProfiles.length > 0 || !profileFilter;
    if (!hasMatches && profileFilter) return null;

    const isEditing = editingFolderId === folder.id;
    const isDropTarget = dragOverTarget?.type === "folder" && dragOverTarget.id === folder.id;

    return (
      <div key={folder.id} className={clsx("tree-folder", isDropTarget && "tree-folder-drop-target")}>
        <button
          className="tree-folder-header"
          onClick={() => toggleFolderCollapsed(folder.id)}
          onContextMenu={(e) => handleContextMenu(e, "folder", folder.id)}
          onDragOver={(e) => handleDragOver(e, "folder", folder.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDropOnFolder(e, folder.id)}
          data-tauri-drag-region="false"
        >
          <span className={clsx("tree-chevron", !folder.collapsed && "expanded")}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </span>
          {isEditing ? (
            <input
              ref={folderInputRef}
              className="tree-folder-input"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={handleFinishRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFinishRename();
                if (e.key === "Escape") {
                  // If escaping from a new folder (empty name), delete it
                  if (!folder.name) {
                    deleteFolder(folder.id);
                  }
                  setEditingFolderId(null);
                  setEditingName("");
                }
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Folder name"
            />
          ) : (
            <span
              className="tree-folder-name"
              onDoubleClick={(e) => {
                e.stopPropagation();
                handleStartRename(folder);
              }}
            >
              {folder.name || "New Folder"}
            </span>
          )}
          <span className="tree-folder-count">{folder.profiles.length}</span>
        </button>
        {!folder.collapsed && (
          <div
            className="tree-folder-contents"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleDragOver(e, "folder", folder.id);
            }}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDropOnFolder(e, folder.id)}
          >
            {folder.profiles.map((id, index) => renderProfile(id, true, folder.id, index))}
            {folder.profiles.length === 0 && (
              <div
                className={clsx("tree-empty", isDropTarget && "tree-empty-drop-target")}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDragOver(e, "folder", folder.id);
                }}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDropOnFolder(e, folder.id)}
              >
                Drop profiles here
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      {/* Header with add button */}
      <div className="sidebar-section">
        <div className="sidebar-header">
          <span>Profiles</span>
          <div className="sidebar-add-wrapper" ref={addMenuRef}>
            <button
              className="sidebar-add-btn"
              onClick={() => setShowAddMenu(!showAddMenu)}
              data-tauri-drag-region="false"
              title="Add profile or folder"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            {showAddMenu && (
              <div className="sidebar-add-menu">
                <button onClick={() => { onCreateProfile(); setShowAddMenu(false); }}>
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M7.5 1v13M1 7.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  New Profile
                </button>
                <button onClick={handleCreateFolder}>
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M1.5 3.5h5l1 1.5h5.5a1 1 0 011 1v6a1 1 0 01-1 1h-11a1 1 0 01-1-1v-7.5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  New Folder
                </button>
                <div className="menu-divider" />
                <button onClick={() => { onCloneProfile(); setShowAddMenu(false); }} disabled={!profile}>
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <rect x="4" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M11 4V2.5A1.5 1.5 0 009.5 1h-7A1.5 1.5 0 001 2.5v7A1.5 1.5 0 002.5 11H4" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                  Clone Profile
                </button>
                <button onClick={() => { onDiffProfiles(); setShowAddMenu(false); }}>
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M1 4h6M1 7.5h4M1 11h6M9 4h5M11 7.5h3M9 11h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  Compare Profiles
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search - only show if more than 5 profiles */}
      {profiles.length > 5 && (
        <div className="sidebar-search">
          <input
            value={profileFilter}
            onChange={(e) => setProfileFilter(e.target.value)}
            placeholder="Search…"
            data-tauri-drag-region="false"
          />
        </div>
      )}

      {/* Profile tree */}
      <div
        className="profile-tree"
        onDragOver={(e) => {
          e.preventDefault();
          if (draggedProfile) {
            handleDragOver(e, "ungrouped", "root");
          }
        }}
        onDrop={handleDropOnUngrouped}
      >
        {/* Folders */}
        {profileOrg.folders.map(renderFolder)}

        {/* Ungrouped profiles */}
        {profileOrg.ungrouped.map((id, index) => renderProfile(id, false, null, index))}

        {/* Empty state */}
        {profiles.length === 0 && (
          <div className="tree-empty-state">
            <p>No profiles yet</p>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onCreateProfile}
              data-tauri-drag-region="false"
            >
              Create profile
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section" style={{ marginBottom: 16 }}>
        <button
          className={clsx("sidebar-item", sidebarView === "library" && "active")}
          onClick={() => setSidebarView("library")}
          data-tauri-drag-region="false"
        >
          Library
        </button>
        <button
          className={clsx("sidebar-item", sidebarView === "store" && "active")}
          onClick={() => setSidebarView("store")}
          data-tauri-drag-region="false"
        >
          Store
        </button>
        <button
          className={clsx("sidebar-item", sidebarView === "logs" && "active")}
          onClick={() => setSidebarView("logs")}
          data-tauri-drag-region="false"
        >
          Logs
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-header" style={{ padding: "0 0 8px" }}>Account</div>
        {activeAccount ? (
          <button
            className={clsx("account-badge", sidebarView === "accounts" && "active")}
            onClick={() => setSidebarView("accounts")}
            data-tauri-drag-region="false"
          >
            <img
              className="account-badge-avatar"
              src={`https://mc-heads.net/avatar/${activeAccount.uuid.replace(/-/g, "")}/64`}
              alt={activeAccount.username}
              onError={(e) => {
                // Fallback to initial if Crafatar fails
                const target = e.currentTarget;
                target.style.display = "none";
                const fallback = target.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = "flex";
              }}
            />
            <div className="account-badge-avatar-fallback" style={{ display: "none" }}>
              {activeAccount.username.charAt(0).toUpperCase()}
            </div>
            <div className="account-badge-info">
              <div className="account-badge-name">{activeAccount.username}</div>
              <div className="account-badge-uuid">{activeAccount.uuid.slice(0, 8)}…</div>
            </div>
            <svg className="account-badge-chevron" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
        ) : (
          <button className="btn btn-secondary btn-sm w-full" onClick={onAddAccount} data-tauri-drag-region="false">
            Add account
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenuTarget && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenuTarget.x, top: contextMenuTarget.y }}
        >
          {contextMenuTarget.type === "profile" && (
            <>
              <button
                onClick={() => {
                  setSelectedProfileId(contextMenuTarget.id);
                  setSidebarView("profiles");
                  setContextMenuTarget(null);
                }}
              >
                Open
              </button>
              <button
                onClick={() => {
                  onCloneProfile();
                  setContextMenuTarget(null);
                }}
              >
                Clone
              </button>
              <div className="menu-divider" />
              <button
                onClick={() => {
                  const currentFavorite = profileOrg.favoriteProfile;
                  setFavoriteProfile(currentFavorite === contextMenuTarget.id ? null : contextMenuTarget.id);
                  setContextMenuTarget(null);
                }}
              >
                {isFavorite(contextMenuTarget.id) ? "Remove from favorites" : "Set as favorite"}
              </button>
              {profileOrg.folders.length > 0 && (
                <>
                  <div className="menu-divider" />
                  <div className="menu-label">Move to folder</div>
                  {profileOrg.folders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        moveProfileToFolder(contextMenuTarget.id, f.id);
                        setContextMenuTarget(null);
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      moveProfileToFolder(contextMenuTarget.id, null);
                      setContextMenuTarget(null);
                    }}
                  >
                    (No folder)
                  </button>
                </>
              )}
              <div className="menu-divider" />
              <button
                className="menu-danger"
                onClick={() => {
                  onDeleteProfile(contextMenuTarget.id);
                  setContextMenuTarget(null);
                }}
              >
                Delete
              </button>
            </>
          )}
          {contextMenuTarget.type === "folder" && (
            <>
              <button
                onClick={() => {
                  const folder = profileOrg.folders.find((f) => f.id === contextMenuTarget.id);
                  if (folder) handleStartRename(folder);
                }}
              >
                Rename
              </button>
              <button
                className="menu-danger"
                onClick={() => {
                  deleteFolder(contextMenuTarget.id);
                  setContextMenuTarget(null);
                }}
              >
                Delete Folder
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
