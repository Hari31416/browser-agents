import { defineConfig } from 'vite';
import { browserAliases, browserUtilities } from './browser-compat/vite.mjs';
export default defineConfig({
  base:'./', resolve:{alias:browserAliases},
  worker:{format:'es',plugins:()=>[browserUtilities()]},
  build:{target:'esnext',outDir:'dist-fixed',rolldownOptions:{input:'fixed.html'}},
});
