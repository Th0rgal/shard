#!/bin/bash
# Capture screenshots of the Shard Launcher desktop app for the website
# Usage: ./scripts/capture-screenshots.sh [page]
#
# This script captures the Shard window WITH your actual macOS wallpaper,
# preserving the native liquid glass/vibrancy effect in the sidebar.
#
# IMPORTANT: You must be on the same desktop space as Shard when running this.
# The script captures a screen region, so whatever is behind the window
# (your wallpaper) will be visible with the vibrancy blur effect.
#
# Arguments:
#   page - Which page to capture: overview, library, store, settings, or all
#
# Examples:
#   ./scripts/capture-screenshots.sh overview   # Capture overview page
#   ./scripts/capture-screenshots.sh library    # Capture library page
#   ./scripts/capture-screenshots.sh all        # Capture current view to all files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCREENSHOT_DIR="$PROJECT_ROOT/web/public/screenshots"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Create screenshot directory
mkdir -p "$SCREENSHOT_DIR"

# Get the window ID of the Shard app (works across ALL spaces, not just current)
get_shard_window_id() {
    # Use Swift with CGWindowListCopyWindowInfo WITHOUT optionOnScreenOnly
    # This finds windows on ANY space, not just the current one
    # Prioritizes shard_ui (Tauri app) over browser windows with similar names
    swift -e '
import Cocoa

// Get ALL windows, not just on-screen ones
let options = CGWindowListOption(rawValue: 0)
guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}

// First pass: look for shard_ui app (the actual Tauri desktop app)
// Find the largest shard_ui window (main window, not helpers)
var bestWindow: Int? = nil
var bestSize: Double = 0

for window in windowList {
    if let owner = window[kCGWindowOwnerName as String] as? String,
       owner == "shard_ui",
       let windowID = window[kCGWindowNumber as String] as? Int,
       let layer = window[kCGWindowLayer as String] as? Int,
       layer == 0,
       let bounds = window[kCGWindowBounds as String] as? [String: Any],
       let width = bounds["Width"] as? Double,
       let height = bounds["Height"] as? Double {
        let size = width * height
        if size > bestSize && width > 200 && height > 200 {
            bestSize = size
            bestWindow = windowID
        }
    }
}

if let windowID = bestWindow {
    print(windowID)
    exit(0)
}

// Second pass: fallback to window named "Shard Launcher" if owned by shard app
for window in windowList {
    if let name = window[kCGWindowName as String] as? String,
       let owner = window[kCGWindowOwnerName as String] as? String,
       name == "Shard Launcher",
       owner.lowercased().contains("shard"),
       let windowID = window[kCGWindowNumber as String] as? Int,
       let layer = window[kCGWindowLayer as String] as? Int,
       layer == 0 {
        print(windowID)
        exit(0)
    }
}

exit(1)
' 2>/dev/null
}

# Capture the Shard window with wallpaper (region capture)
# This captures the actual screen, preserving the vibrancy/liquid glass effect
capture_window() {
    local output_file="$1"
    local window_id="$2"
    local margin="${MARGIN:-32}"  # Wallpaper margin around window

    if [ -z "$window_id" ]; then
        log_error "No window ID provided"
        return 1
    fi

    # Get window bounds
    local bounds
    bounds=$(swift -e "
import Cocoa

let windowID = $window_id
let margin = $margin

let options = CGWindowListOption(rawValue: 0)
guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}

for window in windowList {
    if let wid = window[kCGWindowNumber as String] as? Int,
       wid == windowID,
       let bounds = window[kCGWindowBounds as String] as? [String: Any],
       let x = bounds[\"X\"] as? Double,
       let y = bounds[\"Y\"] as? Double,
       let w = bounds[\"Width\"] as? Double,
       let h = bounds[\"Height\"] as? Double {
        let captureX = max(0, Int(x) - margin)
        let captureY = max(0, Int(y) - margin)
        let captureW = Int(w) + margin * 2
        let captureH = Int(h) + margin * 2
        print(\"\(captureX),\(captureY),\(captureW),\(captureH)\")
        exit(0)
    }
}
exit(1)
" 2>/dev/null)

    if [ -z "$bounds" ]; then
        log_error "Could not get window bounds"
        return 1
    fi

    log_info "Capturing region: $bounds (with ${margin}px wallpaper margin)..."

    # Region capture - captures actual screen pixels including wallpaper + vibrancy
    # IMPORTANT: Window must be visible on current space for this to work
    if screencapture -x -R "$bounds" "$output_file" 2>/dev/null; then
        # Verify the capture worked (file exists and has reasonable size)
        local file_size
        file_size=$(wc -c < "$output_file" 2>/dev/null || echo 0)
        if [ -f "$output_file" ] && [ "$file_size" -gt 10000 ]; then
            log_info "Saved: $output_file"
            return 0
        else
            log_error "Capture failed - is the Shard window visible on your current desktop?"
            log_info "Switch to the desktop where Shard is and try again."
            return 1
        fi
    else
        log_error "screencapture failed"
        return 1
    fi
}

# List all Shard-related windows (for debugging)
list_shard_windows() {
    log_info "Searching for Shard windows on all spaces..."
    swift -e '
import Cocoa

let options = CGWindowListOption(rawValue: 0)
guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    print("Failed to get window list")
    exit(1)
}

var found = false
for window in windowList {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    let name = window[kCGWindowName as String] as? String ?? ""
    let windowID = window[kCGWindowNumber as String] as? Int ?? 0
    let layer = window[kCGWindowLayer as String] as? Int ?? -1

    if owner.lowercased().contains("shard") || name.lowercased().contains("shard") || owner == "shard_ui" {
        print("  Window ID: \(windowID)")
        print("    Owner: \(owner)")
        print("    Name: \(name)")
        print("    Layer: \(layer)")
        print("")
        found = true
    }
}

if !found {
    print("  No Shard windows found")
    print("")
    print("  Make sure the Shard Launcher app is running.")
    print("  You can start it with: cargo tauri dev")
}
' 2>&1
}

# Main execution
main() {
    local page="${1:-overview}"
    local capture_name="${CAPTURE_NAME:-$page}"
    local margin="${MARGIN:-32}"

    echo ""
    log_info "Shard Launcher Screenshot Capture"
    log_info "=================================="
    echo ""
    log_info "Page: $capture_name"
    log_info "Mode: Region capture (with wallpaper + vibrancy effect)"
    log_info "Margin: ${margin}px"
    echo ""

    # Find the Shard window
    log_step "Finding Shard window..."
    local window_id
    window_id=$(get_shard_window_id)

    if [ -z "$window_id" ]; then
        log_error "Could not find Shard window!"
        echo ""
        list_shard_windows
        echo ""
        log_info "Tips:"
        log_info "  1. Make sure Shard Launcher is running (cargo tauri dev)"
        log_info "  2. The window can be on any desktop/space"
        log_info "  3. The window must not be minimized to the dock"
        exit 1
    fi

    log_info "Found window ID: $window_id"
    echo ""

    # Function to capture and convert to WebP
    capture_and_convert() {
        local name="$1"
        local temp_png="/tmp/shard_capture_${name}.png"
        local final_webp="$SCREENSHOT_DIR/${name}.webp"

        if capture_window "$temp_png" "$window_id"; then
            # Convert to WebP at 95% quality
            if command -v cwebp &> /dev/null; then
                cwebp -q 95 "$temp_png" -o "$final_webp" 2>/dev/null
                rm -f "$temp_png"
                log_info "Converted to WebP: $final_webp"
            else
                # Fallback: keep PNG
                mv "$temp_png" "$SCREENSHOT_DIR/${name}.png"
                log_warn "cwebp not found, saved as PNG"
            fi
        fi
    }

    # Capture based on page argument
    case "$page" in
        overview|library|store|settings)
            log_step "Capturing $page page..."
            capture_and_convert "$capture_name"
            ;;
        all)
            log_step "Capturing current view as all pages..."
            log_warn "This will save the CURRENT view to all page files!"
            echo ""
            for p in overview library store settings; do
                capture_and_convert "$p"
            done
            ;;
        list)
            list_shard_windows
            exit 0
            ;;
        *)
            log_error "Unknown page: $page"
            log_info "Valid pages: overview, library, store, settings, all, list"
            exit 1
            ;;
    esac

    echo ""
    log_info "Done!"
    echo ""
    log_info "Screenshot location: $SCREENSHOT_DIR"
    ls -la "$SCREENSHOT_DIR"/*.webp 2>/dev/null | tail -5 || ls -la "$SCREENSHOT_DIR"/*.png 2>/dev/null | tail -5
    echo ""

    # Reminder about workflow
    if [ "$page" != "all" ] && [ "$page" != "list" ]; then
        log_info "To capture other pages:"
        log_info "  1. Switch to the desktop where Shard is visible"
        log_info "  2. Navigate to the page in Shard"
        log_info "  3. Run: $0 <page>"
        log_info "  Pages: overview, library, store, settings"
        echo ""
        log_info "Tip: MARGIN=48 $0 overview  # Adjust wallpaper margin"
    fi
}

# Show help
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Shard Launcher Screenshot Capture"
    echo ""
    echo "Captures screenshots with your ACTUAL macOS wallpaper visible,"
    echo "preserving the native liquid glass/vibrancy effect."
    echo ""
    echo "Usage: $0 [page]"
    echo ""
    echo "Pages:"
    echo "  overview   - Profile overview with mods (default)"
    echo "  library    - Content library view"
    echo "  store      - Mod store browser"
    echo "  settings   - Application settings"
    echo "  all        - Save current view to all files"
    echo "  list       - List all Shard windows (debugging)"
    echo ""
    echo "Environment:"
    echo "  MARGIN=32  - Wallpaper margin around window (default: 32)"
    echo ""
    echo "Workflow:"
    echo "  1. Switch to the desktop where Shard is (e.g., Ctrl+Right)"
    echo "  2. Make sure Shard window is visible (not covered by other windows)"
    echo "  3. Run: $0 overview"
    echo "  4. Navigate to Library in Shard, run: $0 library"
    echo "  5. Repeat for store and settings"
    echo "  6. Switch back to your work desktop"
    echo ""
    echo "The screenshot will show the window floating on your actual wallpaper"
    echo "with the vibrancy/blur effect visible in the sidebar."
    exit 0
fi

# Run main function
main "$@"
