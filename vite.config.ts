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
        '@techstark/opencv-js',
        'three'
      ],
      output: {
        globals: {
          '@huggingface/transformers': 'Transformers',
          '@techstark/opencv-js': 'cv',
          'three': 'THREE'
        }
      }
    },
    sourcemap: true,
    minify: 'terser'
  },
  optimizeDeps: {
    exclude: ['@techstark/opencv-js']
  }
});