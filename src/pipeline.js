/**
 * Shared on-device pipeline: classify photos, then write a journal entry.
 * Used by both the CLI (src/index.js) and the local web UI (server.js).
 *
 * Every function here reports progress through an `onEvent` callback instead
 * of calling console.log directly, so the same logic can drive a terminal
 * or stream NDJSON events to a browser.
 */

import { Jimp } from "jimp";
import {
  loadModel,
  classify,
  completion,
  unloadModel,
  LLAMA_3_2_1B_INST_Q4_0,
} from "@qvac/sdk";

// Full-resolution phone photos (often several MB) can be large enough that
// passing their raw bytes through the RPC layer trips a "Maximum call stack
// size exceeded" error. The classifier only needs a small image anyway, so
// every photo is downscaled locally before it reaches classify().
const MAX_CLASSIFY_DIMENSION = 512;

/**
 * Classifies a list of { name, buffer } photos with QVAC's bundled
 * image classifier.
 *
 * Emits onEvent({ type: "photo", file, label, confidence }) per success,
 * or onEvent({ type: "photo-skipped", file, reason }) on failure.
 *
 * Returns { tally: { food, report, other }, perPhoto: [...] }.
 */
export async function classifyPhotos(photos, onEvent = () => {}) {
  const classifierId = await loadModel({ modelType: "ggml-classification" });

  const tally = { food: 0, report: 0, other: 0 };
  const perPhoto = [];

  for (const { name, buffer } of photos) {
    try {
      const image = await Jimp.read(buffer);
      image.scaleToFit({ w: MAX_CLASSIFY_DIMENSION, h: MAX_CLASSIFY_DIMENSION });
      const smallBytes = await image.getBuffer("image/jpeg");

      const results = await classify({ modelId: classifierId, image: smallBytes });
      if (!results || results.length === 0) {
        onEvent({ type: "photo-skipped", file: name, reason: "no classification returned" });
        continue;
      }
      const top = results[0]; // highest-confidence label first
      tally[top.label] = (tally[top.label] ?? 0) + 1;
      perPhoto.push({ file: name, label: top.label, confidence: top.confidence });
      onEvent({ type: "photo", file: name, label: top.label, confidence: top.confidence });
    } catch (err) {
      onEvent({ type: "photo-skipped", file: name, reason: err.message ?? String(err) });
    }
  }

  await unloadModel({ modelId: classifierId });
  return { tally, perPhoto };
}

/**
 * Feeds a day's photo tally to a local LLM and streams back a short
 * journal entry.
 *
 * Emits onEvent({ type: "model-loading" }), optional
 * onEvent({ type: "model-download", percentage }) during first-run download,
 * onEvent({ type: "model-ready" }), then onEvent({ type: "token", text })
 * per streamed token.
 *
 * Returns the full journal text.
 */
export async function writeJournalEntry(tally, totalPhotos, dateLabel, onEvent = () => {}) {
  onEvent({ type: "model-loading" });
  const modelId = await loadModel({
    modelSrc: LLAMA_3_2_1B_INST_Q4_0,
    onProgress: (p) => onEvent({ type: "model-download", percentage: p.percentage }),
  });
  onEvent({ type: "model-ready" });

  const prompt = [
    `You are helping someone write a short, warm personal journal entry for ${dateLabel}.`,
    `Here is what their phone photos from today look like, based on on-device image classification (do not mention the classifier, the AI, or QVAC in your reply):`,
    `- ${totalPhotos} photos total`,
    `- ${tally.food} photo(s) that look like food or meals`,
    `- ${tally.report} photo(s) that look like documents, receipts, or text captured on paper/screen`,
    `- ${tally.other} photo(s) of everyday moments`,
    ``,
    `Write 3-5 sentences, first person, reflective and human, as if the person is journaling about their day based on what they photographed. Do not invent specific events you weren't told about. It is fine to acknowledge some categories had zero photos.`,
  ].join("\n");

  const history = [{ role: "user", content: prompt }];
  const result = completion({ modelId, history, stream: true });

  let fullText = "";
  for await (const token of result.tokenStream) {
    fullText += token;
    onEvent({ type: "token", text: token });
  }

  await unloadModel({ modelId });
  return fullText.trim();
}

/** Builds the saved markdown file's contents. */
export function buildJournalMarkdown(dateLabel, entry, tally, totalPhotos, perPhoto) {
  return [
    `# ${dateLabel}`,
    ``,
    entry,
    ``,
    `---`,
    `*Generated on-device with QVAC. Photo breakdown: ${tally.food} food, ${tally.report} document/report, ${tally.other} other, out of ${totalPhotos} total.*`,
    ``,
    `<details><summary>Per-photo classification</summary>`,
    ``,
    ...perPhoto.map((p) => `- ${p.file}: ${p.label} (${(p.confidence * 100).toFixed(0)}%)`),
    `</details>`,
    ``,
  ].join("\n");
}
