import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    build: {
        reportCompressedSize: false,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) {
                        return undefined;
                    }
                    if (id.includes("react/") ||
                        id.includes("react-dom/") ||
                        id.includes("scheduler/") ||
                        id.includes("react-router/") ||
                        id.includes("react-router-dom/")) {
                        return "react-vendor";
                    }
                    if (id.includes("react-markdown") ||
                        id.includes("remark-") ||
                        id.includes("rehype-") ||
                        id.includes("mdast-util-") ||
                        id.includes("micromark") ||
                        id.includes("unist-") ||
                        id.includes("hast-") ||
                        id.includes("katex") ||
                        id.includes("property-information") ||
                        id.includes("highlight.js")) {
                        return "markdown-vendor";
                    }
                    if (id.includes("js-yaml") || id.includes("turndown")) {
                        return "admin-vendor";
                    }
                    return undefined;
                },
            },
        },
    },
    server: {
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:8080",
                changeOrigin: true,
            },
            "/media": {
                target: "http://localhost:8080",
                changeOrigin: true,
            },
            "^/posts/[^/]+/pdf$": {
                target: "http://localhost:8080",
                changeOrigin: true,
                rewrite: (path) => `/api${path}`,
            },
        },
    },
    preview: {
        host: "0.0.0.0",
        port: 4173,
    },
});
