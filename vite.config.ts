import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const backendUrl = "http://127.0.0.1:8012";

const spaRouteProxy = {
  target: backendUrl,
  bypass(req: { method?: string; headers: { accept?: string | string[] | undefined } }) {
    const accept = Array.isArray(req.headers.accept) ? req.headers.accept.join(",") : req.headers.accept;
    return req.method === "GET" && accept?.includes("text/html") ? "/index.html" : undefined;
  },
};

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/adherence": backendUrl,
      "/admin": spaRouteProxy,
      "/chat": backendUrl,
      "/chat-lite": backendUrl,
      "/chat-with-attachments": backendUrl,
      "/coach/": backendUrl,
      "/coach-notifications": spaRouteProxy,
      "/debug": backendUrl,
      "/integrations": backendUrl,
      "/plans": backendUrl,
      "/reports": spaRouteProxy,
      "/static": backendUrl,
      "/tts": backendUrl,
      "/voice-chat": backendUrl,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "src/test/setup.ts",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
