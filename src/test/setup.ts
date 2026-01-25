/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from "vitest";

// Mock requestAnimationFrame for tests
globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
  return setTimeout(() => callback(performance.now()), 16) as unknown as number;
});

globalThis.cancelAnimationFrame = vi.fn((id: number) => {
  clearTimeout(id);
});

// Mock performance.now if not available
if (typeof performance === "undefined") {
  (globalThis as Record<string, unknown>).performance = {
    now: () => Date.now(),
  };
}
