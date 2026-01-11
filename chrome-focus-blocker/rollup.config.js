// rollup.config.js — single-file IIFE builds per entry (no code-splitting)
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import copy from "rollup-plugin-copy";
import path from "path";

const TARGET = process.env.TARGET || "chrome";
const outDir = `dist/${TARGET}`;

// Helper to copy static assets and manifest after bundle
const copyStatic = copy({
  targets: [
    { src: "public/*", dest: outDir },
    {
      src: `manifests/manifest.${TARGET}.json`,
      dest: outDir,
      rename: "manifest.json",
    },
    { src: "public/icons/*", dest: path.join(outDir, "icons") },
  ],
  hook: "writeBundle",
  verbose: true,
});

// Individual configs — one per entry file to avoid multi-chunk/iife conflict
const commonPlugins = [
  resolve({ browser: true }),
  commonjs(),
  typescript({ tsconfig: "./tsconfig.json" }),
  terser(),
];

const backgroundConfig = {
  input: "src/background.ts",
  output: {
    file: path.join(outDir, "background.js"),
    format: "iife",
    name: "Background",
    sourcemap: true,
  },
  plugins: [...commonPlugins, copyStatic],
};

const contentConfig = {
  input: "src/content.ts",
  output: {
    file: path.join(outDir, "content.js"),
    format: "iife",
    name: "Content",
    sourcemap: true,
  },
  plugins: commonPlugins,
};

const popupConfig = {
  input: "src/popup.ts",
  output: {
    file: path.join(outDir, "popup.js"),
    format: "iife",
    name: "Popup",
    sourcemap: true,
  },
  plugins: commonPlugins,
};

export default [backgroundConfig, contentConfig, popupConfig];
