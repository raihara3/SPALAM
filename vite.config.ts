import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SPALAM',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: [
        '@huggingface/transformers',
        'three'
      ],
      output: {
        globals: {
          '@huggingface/transformers': 'Transformers',
          'three': 'THREE'
        }
      }
    },
    sourcemap: true,
    minify: 'terser'
  },
  optimizeDeps: {
    exclude: []
  }
});