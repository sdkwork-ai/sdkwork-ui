import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { createSdkworkCredentialEntryBootstrapVitePlugin } from '@sdkwork/iam-credential-entry/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dts from 'vite-plugin-dts';
import { resolveViteEnvironment } from '../../sdkwork-specs/tools/vite-runtime-profile.mjs';
import { createFrameworkLibEntrySourceMap } from './build/package-contract';

const peerDependencies = ['react', 'react-dom', 'react-hook-form'];
const frameworkLibEntrySourceMap = createFrameworkLibEntrySourceMap();

function isPeerDependency(id: string): boolean {
  return peerDependencies.some((dependency) => id === dependency || id.startsWith(`${dependency}/`));
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const bootstrapAccessToken = env.SDKWORK_ACCESS_TOKEN ?? process.env.SDKWORK_ACCESS_TOKEN;
  return {
          plugins: [
            // The bootstrap credential reaches the renderer only through the shared IAM
            // plugin (dev-server HTML injection as
            // `globalThis.__SDKWORK_CREDENTIAL_ENTRY_BOOTSTRAP_ACCESS_TOKEN__`).
            // `define['process.env.SDKWORK_ACCESS_TOKEN']` is NOT a valid handoff
            // (IAM_CREDENTIAL_ENTRY_SPEC.md section 4/5).
            createSdkworkCredentialEntryBootstrapVitePlugin({
              accessToken: bootstrapAccessToken,
              environment: resolveViteEnvironment(mode, process.env),
            }),
            react(),
            tailwindcss(),
            dts({
              include: ['src/**/*'],
              exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
              outDir: 'dist',
              entryRoot: 'src',
            }),
          ],
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: Object.fromEntries(
        Object.entries(frameworkLibEntrySourceMap).map(([entryName, sourcePath]) => [entryName, resolve(__dirname, sourcePath)]),
      ),
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: 'sdkwork-ui',
    },
    rollupOptions: {
      external: isPeerDependency,
    },
  },
  };
});
