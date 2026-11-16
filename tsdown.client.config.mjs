import { fileURLToPath } from 'node:url'

const external = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@dsh-plugin/dsh-loader/client']

export default {
  entry: { client: fileURLToPath(new URL('./src/client/index.ts', import.meta.url)) },
  outDir: fileURLToPath(new URL('./lib', import.meta.url)),
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external,
  noExternal: id => external.includes(id) ? undefined : true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@dsh-plugin/dsh-dynamic-tools", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
    codeSplitting: false,
  },
}
