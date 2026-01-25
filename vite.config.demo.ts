import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [basicSsl()],
  base: "/SPALAM/",
  server: {
    host: true,
    https: {},
  },
  build: {
    outDir: "dist-demo",
    sourcemap: true,
    minify: "terser",
  },
  optimizeDeps: {
    exclude: [],
  },
});
