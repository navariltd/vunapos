#!/usr/bin/env node
// CI import-rule gate (spec §4.4). Presentation/Sales UI code must never reach past
// its repositories: no raw fetch, no Dexie/db.ts, no the low-level API client
// (lib/apiClient.ts, used only by the Cache/Sync Engines outside React's lifecycle).
//
// Scope: app/, components/, pages/, features (UI + hooks) - hooks may call repository/engine
// functions but not touch storage or network directly. lib/ and services/vunaApi.ts (hook-bound
// API layer for online-required actions not yet cut over - holds, customer creation) are exempt.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(rootDir, "src");

const SCOPED_DIRS = ["app", "components", "pages", "features"];
const EXEMPT_PATH_PARTS = ["src/lib", "src/services"];

const FORBIDDEN_PATTERNS = [
  {
    name: "raw fetch()",
    regex: /\bfetch\s*\(/,
    allowSubstring: null,
  },
  {
    name: 'import from "dexie"',
    regex: /from\s+["']dexie["']/,
  },
  {
    name: "direct Dexie db import (lib/db)",
    regex: /from\s+["'][^"']*\/lib\/db["']/,
  },
  {
    name: "low-level API client import (lib/apiClient)",
    regex: /from\s+["'][^"']*\/lib\/apiClient["']/,
  },
];

function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectFiles(fullPath, files);
    } else if (
      [".ts", ".tsx"].includes(extname(fullPath)) &&
      !fullPath.endsWith(".test.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function isExempt(relPath) {
  return EXEMPT_PATH_PARTS.some((part) => relPath.startsWith(part));
}

const violations = [];

for (const dirName of SCOPED_DIRS) {
  const dirPath = join(srcDir, dirName);
  let files;
  try {
    files = collectFiles(dirPath);
  } catch {
    continue;
  }

  for (const filePath of files) {
    const relPath = relative(rootDir, filePath);
    if (isExempt(relPath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(content)) {
        violations.push({ file: relPath, rule: pattern.name });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    "Import-rule gate failed (spec §4.4) - Presentation/Sales UI code must go through repositories:\n"
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}: ${violation.rule}`);
  }
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log(
  "Import-rule gate passed: no fetch/dexie/apiClient imports in Presentation or Sales UI code."
);
