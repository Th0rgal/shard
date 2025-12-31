import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useAppStore } from "../store";
import type { ProfileFolder } from "../types";

// Draggable profile item component
function DraggableProfileItem({
  id,
  isSelected,
  isFavorite,
  inFolder,
  onSelect,
  onContextMenu,
}: {
  id: string;
  isSelected: boolean;
  isFavorite: boolean;
  inFolder: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `profile-${id}`,
    data: { type: "profile", profileId: id },
  });

  return (
    <button
      ref={setNodeRef}
      className={clsx(
        "profile-dropdown-item",
        isSelected && "active",
        inFolder && "indented",
        isDragging && "dragging"
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      data-tauri-drag-region="false"
      {...attributes}
      {...listeners}
    >
      {isFavorite && (
        <svg className="profile-dropdown-star" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 1l1.545 3.13 3.455.502-2.5 2.436.59 3.441L6 8.885 2.91 10.51l.59-3.441L1 4.632l3.455-.502L6 1z" />
        </svg>
      )}
      <span className="profile-dropdown-name">{id}</span>
      {isSelected && (
        <svg className="profile-dropdown-check" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

// Droppable folder component
function DroppableFolder({
  folder,
  isEditing,
  editingName,
  onEditChange,
  onFinishRename,
  onCancelRename,
  onToggleCollapse,
  onContextMenu,
  onStartEdit,
  children,
}: {
  folder: ProfileFolder;
  isEditing: boolean;
  editingName: string;
  onEditChange: (name: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onToggleCollapse: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onStartEdit: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-${folder.id}`,
    data: { type: "folder", folderId: folder.id },
  });
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && folderInputRef.current) {
      folderInputRef.current.focus();
      folderInputRef.current.select();
    }
  }, [isEditing]);

  return (
    <div
      ref={setNodeRef}
      className={clsx("profile-dropdown-folder", isOver && "drop-target")}
    >
      <button
        className="profile-dropdown-folder-header"
        onClick={onToggleCollapse}
        onContextMenu={onContextMenu}
        onDoubleClick={onStartEdit}
        data-tauri-drag-region="false"
      >
        <svg className={clsx("profile-dropdown-chevron", !folder.collapsed && "expanded")} width="10" height="10" viewBox="0 0 10 10">
          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
        {isEditing ? (
          <input
            ref={folderInputRef}
            className="profile-dropdown-folder-input"
            value={editingName}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onFinishRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onFinishRename();
              if (e.key === "Escape") onCancelRename();
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            placeholder="Folder name"
            autoFocus
          />
        ) : (
          <span className="profile-dropdown-folder-name">{folder.name || "New Folder"}</span>
        )}
        <span className="profile-dropdown-folder-count">{folder.profiles.length}</span>
      </button>
      {!folder.collapsed && (
        <div className="profile-dropdown-folder-contents">
          {children}
        </div>
      )}
    </div>
  );
}

// Droppable zone for ungrouped items
function DroppableUngrouped({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "ungrouped",
    data: { type: "ungrouped" },
  });

  return (
    <div ref={setNodeRef} className={clsx("profile-dropdown-ungrouped", isOver && "drop-target")}>
      {children}
    </div>
  );
}

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
    setFavoriteProfile,
    loadProfileOrganization,
    syncProfileOrganization,
  } = useAppStore();

  const activeAccount = getActiveAccount();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Configure drag sensors with activation constraint to distinguish from clicks
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    })
  );

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
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
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
        deleteFolder(editingFolderId);
      }
    }
    setEditingFolderId(null);
    setEditingName("");
  };

  const handleSelectProfile = (id: string) => {
    setSelectedProfileId(id);
    setSidebarView("profiles");
    setShowProfileMenu(false);
    setProfileFilter("");
  };

  const isFavorite = (profileId: string) => profileOrg.favoriteProfile === profileId;

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === "profile") {
      setDraggedProfileId(active.data.current.profileId);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedProfileId(null);

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeData?.type !== "profile") return;

    const profileId = activeData.profileId;

    if (overData?.type === "folder") {
      moveProfileToFolder(profileId, overData.folderId);
    } else if (overData?.type === "ungrouped" || over.id === "ungrouped") {
      moveProfileToFolder(profileId, null);
    }
  };

  // Get profile info for display
  const getProfileInfo = () => {
    if (!profile) return null;
    const version = profile.mcVersion || "Unknown";
    const loader = profile.loader?.type || "Vanilla";
    return { version, loader };
  };

  const profileInfo = getProfileInfo();

  // Render draggable profile item in dropdown
  const renderDropdownProfile = (id: string, inFolder = false) => {
    const isSelected = selectedProfileId === id;
    const matchesFilter = filteredProfiles.includes(id);
    if (!matchesFilter && profileFilter) return null;

    return (
      <DraggableProfileItem
        key={id}
        id={id}
        isSelected={isSelected}
        isFavorite={isFavorite(id)}
        inFolder={inFolder}
        onSelect={() => handleSelectProfile(id)}
        onContextMenu={(e) => handleContextMenu(e, "profile", id)}
      />
    );
  };

  // Render droppable folder in dropdown
  const renderDropdownFolder = (folder: ProfileFolder) => {
    const matchingProfiles = folder.profiles.filter((id) => filteredProfiles.includes(id));
    const hasMatches = matchingProfiles.length > 0 || !profileFilter;
    if (!hasMatches && profileFilter) return null;

    const isEditing = editingFolderId === folder.id;

    return (
      <DroppableFolder
        key={folder.id}
        folder={folder}
        isEditing={isEditing}
        editingName={editingName}
        onEditChange={setEditingName}
        onFinishRename={handleFinishRename}
        onCancelRename={() => {
          if (!folder.name) deleteFolder(folder.id);
          setEditingFolderId(null);
          setEditingName("");
        }}
        onToggleCollapse={() => toggleFolderCollapsed(folder.id)}
        onContextMenu={(e) => handleContextMenu(e, "folder", folder.id)}
        onStartEdit={() => handleStartRename(folder)}
      >
        {folder.profiles.map((id) => renderDropdownProfile(id, true))}
      </DroppableFolder>
    );
  };

  return (
    <aside className="sidebar">
      {/* Profile Context Selector */}
      <div className="profile-context" ref={profileMenuRef}>
        <button
          className={clsx("profile-context-button", showProfileMenu && "open")}
          onClick={() => setShowProfileMenu(!showProfileMenu)}
          data-tauri-drag-region="false"
        >
          <div className="profile-context-icon">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M3 7l7-4 7 4v6l-7 4-7-4V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M10 11V3M10 11l7-4M10 11l-7-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>
          {selectedProfileId ? (
            <>
              <div className="profile-context-info">
                <span className="profile-context-name">{selectedProfileId}</span>
                {profileInfo && (
                  <span className="profile-context-meta">
                    {profileInfo.version} · {profileInfo.loader}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="profile-context-info">
              <span className="profile-context-placeholder">Select a profile</span>
            </div>
          )}
          <svg className={clsx("profile-context-chevron", showProfileMenu && "open")} width="12" height="12" viewBox="0 0 12 12">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </button>

        {/* Profile Dropdown Menu */}
        {showProfileMenu && (
          <div className="profile-dropdown">
            {/* Search */}
            {profiles.length > 3 && (
              <div className="profile-dropdown-search">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  placeholder="Search profiles..."
                  value={profileFilter}
                  onChange={(e) => setProfileFilter(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            {/* Profile list with drag and drop */}
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="profile-dropdown-list">
                {profileOrg.folders.map(renderDropdownFolder)}
                <DroppableUngrouped>
                  {profileOrg.ungrouped.map((id) => renderDropdownProfile(id))}
                </DroppableUngrouped>

                {profiles.length === 0 && (
                  <div className="profile-dropdown-empty">No profiles yet</div>
                )}
              </div>

              {/* Drag overlay for visual feedback */}
              <DragOverlay dropAnimation={null}>
                {draggedProfileId && (
                  <div className="profile-dropdown-item dragging-overlay">
                    {isFavorite(draggedProfileId) && (
                      <svg className="profile-dropdown-star" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 1l1.545 3.13 3.455.502-2.5 2.436.59 3.441L6 8.885 2.91 10.51l.59-3.441L1 4.632l3.455-.502L6 1z" />
                      </svg>
                    )}
                    <span className="profile-dropdown-name">{draggedProfileId}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>

            {/* Actions */}
            <div className="profile-dropdown-actions">
              <button onClick={() => { onCreateProfile(); setShowProfileMenu(false); }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Profile
              </button>
              <button onClick={() => { handleCreateFolder(); setShowProfileMenu(false); }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 3h4.5l1 1.5H13v7.5H1V3z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Folder
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Profile-specific navigation (only show when profile selected) */}
      {selectedProfileId && (
        <div className="sidebar-nav sidebar-nav-profile">
          <button
            className={clsx("sidebar-nav-item", sidebarView === "profiles" && "active")}
            onClick={() => setSidebarView("profiles")}
            data-tauri-drag-region="false"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 6h6M5 8.5h4M5 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Overview
          </button>
        </div>
      )}

      {/* Global navigation */}
      <div className="sidebar-nav sidebar-nav-global">
        <button
          className={clsx("sidebar-nav-item", sidebarView === "library" && "active")}
          onClick={() => setSidebarView("library")}
          data-tauri-drag-region="false"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 3h12M2 8h12M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Library
        </button>
        <button
          className={clsx("sidebar-nav-item", sidebarView === "store" && "active")}
          onClick={() => setSidebarView("store")}
          data-tauri-drag-region="false"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2L14 5v6l-6 3-6-3V5l6-3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 8v6M8 8l6-3M8 8L2 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Store
        </button>
        <button
          className={clsx("sidebar-nav-item", sidebarView === "logs" && "active")}
          onClick={() => setSidebarView("logs")}
          data-tauri-drag-region="false"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 4h10M3 8h7M3 12h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Logs
        </button>
        <button
          className={clsx("sidebar-nav-item", sidebarView === "settings" && "active")}
          onClick={() => setSidebarView("settings")}
          data-tauri-drag-region="false"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Settings
        </button>
      </div>

      {/* Account footer */}
      <div className="sidebar-footer">
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

      {/* Context menu - rendered in portal to escape stacking context */}
      {contextMenuTarget && createPortal(
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenuTarget.x, top: contextMenuTarget.y }}
        >
          {contextMenuTarget.type === "profile" && (
            <>
              <button
                onClick={() => {
                  handleSelectProfile(contextMenuTarget.id);
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
        </div>,
        document.body
      )}
    </aside>
  );
}
