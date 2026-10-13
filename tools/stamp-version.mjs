#!/usr/bin/env node
/**
 * stamp-version.mjs
 * 给 HTML 中引用的本地脚本/样式追加缓存版本参数 ?v=<version>。
 * 用法: node tools/stamp-version.mjs <html-file> [version]
 * 只改写没有查询串的 .js / .css 引用；已带 ?v= 的引用会被跳过（幂等）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [file, version = 'dev'] = process.argv.slice(2);
if (!file) {
  console.error('usage: node tools/stamp-version.mjs <html-file> [version]');
  process.exit(1);
}

const ASSET_RE = /(href|src)="([^"?]+\.(?:js|css))"/g;
const html = readFileSync(file, 'utf8');
const stamped = [];
const out = html.replace(ASSET_RE, (_m, attr, url) => {
  stamped.push(url);
  return `${attr}="${url}?v=${version}"`;
});

if (out === html) {
  console.warn('stamp-version: 未找到可改写的 .js/.css 引用（可能已注入），跳过。');
  process.exit(0);
}

writeFileSync(file, out);
console.log(`stamp-version: v=${version} 已注入 ${stamped.length} 个资源 -> ${stamped.join(', ')}`);
