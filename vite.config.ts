import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

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
      "/adherence": "http://127.0.0.1:8012",
      "/admin": "http://127.0.0.1:8012",
      "/chat": "http://127.0.0.1:8012",
      "/chat-lite": "http://127.0.0.1:8012",
      "/chat-with-attachments": "http://127.0.0.1:8012",
      "/coach": "http://127.0.0.1:8012",
      "/coach-notifications": "http://127.0.0.1:8012",
      "/debug": "http://127.0.0.1:8012",
      "/integrations": "http://127.0.0.1:8012",
      "/plans": "http://127.0.0.1:8012",
      "/reports": "http://127.0.0.1:8012",
      "/static": "http://127.0.0.1:8012",
      "/tts": "http://127.0.0.1:8012",
      "/voice-chat": "http://127.0.0.1:8012",
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
