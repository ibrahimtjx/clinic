import '@testing-library/jest-dom/vitest';

// jsdom lacks these; Mantine needs them.
Object.defineProperty(window, 'matchMedia', {
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
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (RO as unknown as typeof ResizeObserver);
window.HTMLElement.prototype.scrollIntoView = () => {};
