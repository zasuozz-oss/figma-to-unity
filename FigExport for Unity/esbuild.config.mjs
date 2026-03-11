import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

// Build main.ts → dist/main.js (Figma sandbox, no DOM)
const mainBuildOptions = {
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: 'dist/main.js',
    target: 'es2017',
    format: 'iife',
    sourcemap: false,
    minify: !isWatch,
};

// Build ui.ts → temp file, then inline into dist/ui.html
const uiBuildOptions = {
    entryPoints: ['src/ui.ts'],
    bundle: true,
    outfile: 'dist/ui.js',
    target: 'es2017',
    format: 'iife',
    sourcemap: false,
    minify: !isWatch,
};

/**
 * Read src/ui.html template and inline the compiled JS into it.
 * Replaces <!-- SCRIPT_PLACEHOLDER --> with <script>...</script>.
 */
function inlineUiScript() {
    const htmlTemplate = fs.readFileSync('src/ui.html', 'utf8');
    const jsContent = fs.readFileSync('dist/ui.js', 'utf8');

    // Use function replacement to avoid $& special pattern in JS replace()
    // (minified JS may contain $& which replace() interprets as "matched text")
    const finalHtml = htmlTemplate.replace(
        '<!-- SCRIPT_PLACEHOLDER -->',
        function () { return '<script>' + jsContent + '<\/script>'; }
    );

    fs.writeFileSync('dist/ui.html', finalHtml, 'utf8');
    // Clean up temp JS file
    fs.unlinkSync('dist/ui.js');
    console.log('[esbuild] ui.html built with inlined script');
}

async function build() {
    if (isWatch) {
        // Watch mode
        const mainCtx = await esbuild.context(mainBuildOptions);
        const uiCtx = await esbuild.context({
            ...uiBuildOptions,
            plugins: [{
                name: 'inline-ui',
                setup(build) {
                    build.onEnd(() => {
                        try {
                            inlineUiScript();
                        } catch (e) {
                            console.error('[esbuild] Failed to inline UI:', e.message);
                        }
                    });
                },
            }],
        });

        await mainCtx.watch();
        await uiCtx.watch();
        console.log('[esbuild] Watching for changes...');
    } else {
        // One-shot build
        await esbuild.build(mainBuildOptions);
        await esbuild.build(uiBuildOptions);
        inlineUiScript();
        console.log('[esbuild] Build complete');
    }
}

build().catch((e) => {
    console.error(e);
    process.exit(1);
});
