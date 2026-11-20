import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isReleaseByokOnly =
    mode === 'release' || env.VITE_BYOK_ONLY === 'true';

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'InCarvas - AI 교육용 PPT 스튜디오',
          short_name: 'InCarvas',
          description:
            '초안 레이아웃과 스타일러스 스케치를 바탕으로 AI가 디자인하고 논리 피드백을 제공하는 교육용 PPT 제작 앱',
          theme_color: '#1e3a8a',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          orientation: 'any',
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallbackDenylist: [/^\/oauth\/callback/],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: {
        stream: path.resolve(__dirname, 'src/utils/emptyStreamStub.ts'),
        'node:stream': path.resolve(__dirname, 'src/utils/emptyStreamStub.ts'),
      },
    },
    define: {
      __BYOK_ONLY_BUILD__: JSON.stringify(isReleaseByokOnly),
      ...(isReleaseByokOnly
        ? {
            'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(''),
            'import.meta.env.VITE_OPENAI_API_KEY': JSON.stringify(''),
            'import.meta.env.VITE_ANTHROPIC_API_KEY': JSON.stringify(''),
          }
        : {}),
    },
  };
});
