import { defineConfig } from 'vite';

// NOTE: this repo is hosted on rivvon.ca
// and as such the base path can remain at the default value "/"
// this differs from other github pages repos where the base path
// needs to be set to "/repository-name/"

export default defineConfig({

    build: {
        target: 'esnext', // Enable top-level await and modern JS features
    },
    optimizeDeps: {
        esbuildOptions: {
            target: 'esnext', // Support top-level await in dependencies
        }
    }
});
