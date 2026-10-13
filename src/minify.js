/*
    website-media-downloader - A versatile tool to detect and download videos, music, and streams from almost any website.
    Copyright (C) 2026 anpa26

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const { minify: minifyHtml } = require('html-minifier-terser');
const CleanCSS = require('clean-css');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const cleanCss = new CleanCSS({ level: 1 });

function extractAndPreserveHeader(content, isHtml) {
    let header = '';
    let body = content;
    
    if (isHtml) {
        const match = content.match(/^([\s\S]*?<!--[\s\S]*?Copyright[\s\S]*?-->)/i);
        if (match) {
            header = match[1] + '\n';
            body = content.substring(match[1].length);
        }
    } else {
        const match = content.match(/^(\s*\/\*[\s\S]*?Copyright[\s\S]*?\*\/)/i);
        if (match) {
            header = match[1] + '\n\n';
            body = content.substring(match[1].length);
        }
    }
    return { header, body };
}

async function minifyFile(filePath) {
    try {
        const code = fs.readFileSync(filePath, 'utf8');
        const { header, body } = extractAndPreserveHeader(code, false);
        
        const result = await minify(body, {
            format: {
                comments: false
            },
            compress: true,
            mangle: true
        });
        
        if (result.code !== undefined) {
            fs.writeFileSync(filePath, header + result.code, 'utf8');
            console.log(`[Minified JS] ${path.relative(BUILD_DIR, filePath)}`);
        }
    } catch (e) {
        console.error(`[Error minifying JS] ${filePath}:`, e);
    }
}

async function minifyHtmlFile(filePath) {
    try {
        const html = fs.readFileSync(filePath, 'utf8');
        const { header, body } = extractAndPreserveHeader(html, true);
        
        const result = await minifyHtml(body, {
            collapseWhitespace: true,
            removeComments: true,
            minifyJS: true,
            minifyCSS: true
        });
        
        fs.writeFileSync(filePath, header + result, 'utf8');
        console.log(`[Minified HTML] ${path.relative(BUILD_DIR, filePath)}`);
    } catch (e) {
        console.error(`[Error minifying HTML] ${filePath}:`, e);
    }
}

async function minifyCssFile(filePath) {
    try {
        const css = fs.readFileSync(filePath, 'utf8');
        const { header, body } = extractAndPreserveHeader(css, false);
        
        const minified = cleanCss.minify(body);
        if (minified.styles !== undefined) {
            fs.writeFileSync(filePath, header + minified.styles, 'utf8');
            console.log(`[Minified CSS] ${path.relative(BUILD_DIR, filePath)}`);
        }
    } catch (e) {
        console.error(`[Error minifying CSS] ${filePath}:`, e);
    }
}

async function minifyJsonFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const minified = JSON.stringify(JSON.parse(content));
        fs.writeFileSync(filePath, minified, 'utf8');
        console.log(`[Minified JSON] ${path.relative(BUILD_DIR, filePath)}`);
    } catch (e) {
        console.error(`[Error minifying JSON] ${filePath}:`, e);
    }
}

async function walkDirAndMinify(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (file === 'libraries') continue;
            await walkDirAndMinify(fullPath);
        } else if (file.endsWith('.js')) {
            await minifyFile(fullPath);
        } else if (file.endsWith('.html')) {
            await minifyHtmlFile(fullPath);
        } else if (file.endsWith('.css')) {
            await minifyCssFile(fullPath);
        } else if (file.endsWith('.json')) {
            await minifyJsonFile(fullPath);
        }
    }
}

async function main() {
    console.log("Starting minification of build outputs...");
    const targets = ['chrome', 'chrome-yt', 'firefox', 'chrome-light', 'chrome-yt-light', 'firefox-light'];
    for (const target of targets) {
        const targetPath = path.join(BUILD_DIR, target);
        if (fs.existsSync(targetPath)) {
            console.log(`Minifying target: ${target}`);
            await walkDirAndMinify(targetPath);
        }
    }
    console.log("Minification complete.");
}

main().catch(console.error);
