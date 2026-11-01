import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const contextShim = fileURLToPath(new URL('./investigation/mock-async-hooks.mjs', import.meta.url));
export default defineConfig(({ mode }) => {
  const globals = mode !== 'baseline';
  const aliases = mode.startsWith('mock') ? [{find:/^node:async_hooks$/, replacement:contextShim}] : [];
  return {
    base:'./',
    define:{'process.env':'{}', ...(globals ? {'process.platform':'"browser"', 'process.version':'""'} : {})},
    resolve:{alias:aliases},
    worker:{format:'es',plugins:()=>[{name:'diagnostic-async-hooks',resolveId(id){if(id==='node:async_hooks' && aliases.length)return contextShim;}}]},
    build:{rolldownOptions:{input:'investigation.html'},outDir:'dist-investigation/'+mode,minify:false,sourcemap:true,target:'esnext'},
  };
});
