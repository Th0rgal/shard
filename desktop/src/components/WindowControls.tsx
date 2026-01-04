import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";

export function WindowControls() {
  const [isWindows, setIsWindows] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    setIsWindows(platform() === "windows");
  }, []);

  useEffect(() => {
    if (!isWindows) return;

    const win = getCurrentWindow();

    // Check initial state
    win.isMaximized().then(setIsMaximized);

    // Listen for resize events to update maximized state
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isWindows]);

  if (!isWindows) return null;

  const win = getCurrentWindow();

  return (
    <div className="window-controls" data-tauri-drag-region="false">
      <button
        className="window-control window-control-minimize"
        onClick={() => win.minimize()}
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        className="window-control window-control-maximize"
        onClick={() => (isMaximized ? win.unmaximize() : win.maximize())}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              d="M2.5,0.5 L9.5,0.5 L9.5,7.5 L7.5,7.5 L7.5,9.5 L0.5,9.5 L0.5,2.5 L2.5,2.5 Z M2.5,2.5 L7.5,2.5 L7.5,7.5"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
      <button
        className="window-control window-control-close"
        onClick={() => win.close()}
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            d="M1,1 L9,9 M9,1 L1,9"
          />
        </svg>
      </button>
    </div>
  );
}
