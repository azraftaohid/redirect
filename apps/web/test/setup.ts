import "@testing-library/jest-dom/vitest";

// Polyfill window.matchMedia
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Polyfill ResizeObserver
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Polyfill ClipboardItem
if (typeof window !== "undefined" && !window.ClipboardItem) {
  (window as any).ClipboardItem = class ClipboardItem {
    constructor(public data: Record<string, any>) {}
  };
}
