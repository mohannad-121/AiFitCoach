import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Force navigation even if an overlay intercepts clicks
if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const directAnchor = target?.closest('a[href]') as HTMLAnchorElement | null;
    const anchorFromPoint = directAnchor || (document.elementsFromPoint(event.clientX, event.clientY)
      .find((el) => el instanceof HTMLAnchorElement && (el as HTMLAnchorElement).getAttribute('href')) as HTMLAnchorElement | undefined) || null;

    if (!anchorFromPoint) return;
    const href = anchorFromPoint.getAttribute('href');
    if (!href) return;

    // Respect external targets if explicitly set
    if (anchorFromPoint.target === '_blank') return;

    // Let React Router handle in-app navigation for relative or same-origin links.
    const isRelativePath = href.startsWith('/');
    const isAbsoluteUrl = /^https?:\/\//i.test(href);
    if (isRelativePath) return;

    if (isAbsoluteUrl) {
      try {
        const resolved = new URL(href, window.location.href);
        if (resolved.origin === window.location.origin) {
          return;
        }
      } catch {
        return;
      }
    }

    // Ensure navigation happens even if default is prevented elsewhere
    event.preventDefault();
    window.location.href = href;
  }, true);
}

