import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // GitHub Pages のプロジェクトサイト（/<repo>/）でも相対パスで動く
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node', // UI テストのファイルだけ先頭に // @vitest-environment jsdom
    include: ['tests/**/*.test.js'],
  },
});
