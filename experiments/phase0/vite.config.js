import { defineConfig } from 'vite';
export default defineConfig({base:'./',define:{'process.env': '{}'},worker:{format:'es'},build:{target:'esnext'}});
