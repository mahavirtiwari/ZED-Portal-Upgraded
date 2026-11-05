// Imported first by index.js (before any @zed/shared module loads): what ZED MSME's current app shows differently
// from the legacy theme. The status bar is white there (the header keeps the legacy gradient).
(globalThis as { __ZED_PALETTE__?: Record<string, string> }).__ZED_PALETTE__ = {
  statusBar: '#FFFFFF',
};

export {};
