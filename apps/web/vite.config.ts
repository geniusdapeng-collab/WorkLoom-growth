import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workloomProductVite } from "../../scripts/vite-product.mjs";

const product = workloomProductVite("B 端工作台");

// A6：vite proxy 转发 /trpc → server（总纲 §2.4 前后端交互）
// W2：preview 同口径代理（桌面发行版以 vite preview 静态服务 dist）
const trpcProxy = {
  target: `http://localhost:${Number(process.env.SERVER_PORT ?? 8787)}`,
  changeOrigin: true,
};
/** 交付物（封面/成片/软字幕轨版）走同一代理：签名 URL 由服务端签发，前端只按 URL 取文件 */
const deliveryProxy = { ...trpcProxy };
export default defineConfig({
  define: product.define,
  plugins: [product.plugin, react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    // /health 同代理：前端「环境守门员」（BackendGate）经此探测后端就绪态，
    // 覆盖第三方工具只起 web 不起 server 的首启场景
    proxy: {
      "/trpc": trpcProxy, "/health": trpcProxy, "/api": trpcProxy,
      "/delivery-artifact": deliveryProxy, "/media": deliveryProxy,
    },
  },
  preview: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/trpc": trpcProxy, "/health": trpcProxy, "/api": trpcProxy,
      "/delivery-artifact": deliveryProxy, "/media": deliveryProxy,
    },
  },
});
