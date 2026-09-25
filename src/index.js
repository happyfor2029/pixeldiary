#!/usr/bin/env node
/**
 * PixelDiary (CLI) — an on-device daily photo journal generator.
 *
 * Points at a folder of photos and:
 *   1. loadModel + classify()   — tags each photo (food / report / other)
 *      using QVAC's bundled MobileNetV3-Small image classifier.
 *   2. loadModel + completion() — turns the day's photo mix into a short,
 *      warm journal entry using a local LLM.
 *
 * No photo and no fact about your day ever leaves the device: every call
 * runs through the QVAC SDK's on-device worker, not a cloud API.
 *
 * Usage:
 *   node src/index.js <path-to-photo-folder> [--out <output-folder>]
 *
 * For a local web UI instead of the terminal, run `npm run web`.
 */

import fs from "node:fs";
import path from "node:path";
import { classifyPhotos, writeJournalEntry, buildJournalMarkdown } from "./pipeline.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(
      "Usage: node src/index.js <path-to-photo-folder> [--out <output-folder>]"
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  const folder = args[0];
  let outDir = path.join(process.cwd(), "journal-output");
  const outFlagIndex = args.indexOf("--out");
  if (outFlagIndex !== -1 && args[outFlagIndex + 1]) {
    outDir = args[outFlagIndex + 1];
  }

  return { folder, outDir };
}

function listImages(folder) {
  return fs
    .readdirSync(folder)
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(folder, name));
}

function onCliEvent(event) {
  switch (event.type) {
    case "photo":
      console.log(`  ${event.file} -> ${event.label} (${(event.confidence * 100).toFixed(0)}%)`);
      break;
    case "photo-skipped":
      console.warn(`  ${event.file} -> skipped (${event.reason})`);
      break;
    case "model-loading":
      console.log(`\nLoading the on-device language model...`);
      break;
    case "model-download":
      process.stderr.write(`\r  Downloading model: ${event.percentage.toFixed(0)}%`);
      break;
    case "model-ready":
      process.stderr.write("\n");
      break;
    case "token":
      process.stdout.write(event.text);
      break;
  }
}

async function main() {
  const { folder, outDir } = parseArgs(process.argv);

  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Error: "${folder}" is not a folder that exists.`);
    process.exit(1);
  }

  const imagePaths = listImages(folder);
  if (imagePaths.length === 0) {
    console.error(`No .jpg/.jpeg/.png files found in "${folder}".`);
    process.exit(1);
  }

  console.log(`Found ${imagePaths.length} photo(s) in ${folder}.`);
  console.log(`\nLoading the on-device image classifier...`);

  const photos = imagePaths.map((p) => ({ name: path.basename(p), buffer: fs.readFileSync(p) }));
  const { tally, perPhoto } = await classifyPhotos(photos, onCliEvent);

  const dateLabel = new Date().toISOString().slice(0, 10);
  console.log("\n--- Journal entry ---\n");
  const entry = await writeJournalEntry(tally, imagePaths.length, dateLabel, onCliEvent);
  console.log("\n");

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${dateLabel}.md`);
  fs.writeFileSync(outPath, buildJournalMarkdown(dateLabel, entry, tally, imagePaths.length, perPhoto), "utf-8");
  console.log(`Saved journal entry to ${outPath}`);
}

main().catch((err) => {
  console.error("\nSomething went wrong:", err.message ?? err);
  process.exit(1);
});
