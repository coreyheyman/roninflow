// Lets Node load the app's browser modules, which import without file extensions (Vite style).
import { register } from 'node:module';
register('./resolver.mjs', import.meta.url);
