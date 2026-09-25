/**
 * PixelDiary (web UI) — a local Express server that runs the same
 * on-device classify + completion pipeline as the CLI, but from a browser
 * at http://localhost:3000 instead of a terminal.
 *
 * Uploaded photos are held in memory only for the duration of the request
 * (multer memoryStorage) and are never written to disk or sent anywhere
 * except to the QVAC worker running on this machine.
 */

import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyPhotos, writeJournalEntry, buildJournalMarkdown } from "./src/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 100 },
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/generate", upload.array("photos", 100), async (req, res) => {
  const files = req.files ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "No photos were uploaded." });
    return;
  }

  // Streamed as newline-delimited JSON so the browser can render progress
  // live instead of waiting for the whole pipeline to finish.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  const send = (event) => res.write(JSON.stringify(event) + "\n");

  try {
    const photos = files.map((f) => ({ name: f.originalname, buffer: f.buffer }));
    send({ type: "status", message: `Classifying ${photos.length} photo(s)...` });

    const { tally, perPhoto } = await classifyPhotos(photos, send);

    const dateLabel = new Date().toISOString().slice(0, 10);
    send({ type: "status", message: "Writing journal entry..." });

    const entry = await writeJournalEntry(tally, photos.length, dateLabel, send);

    const outDir = path.join(__dirname, "journal-output");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = `${dateLabel}-${Date.now()}.md`;
    fs.writeFileSync(
      path.join(outDir, outFile),
      buildJournalMarkdown(dateLabel, entry, tally, photos.length, perPhoto),
      "utf-8"
    );

    send({ type: "done", entry, tally, totalPhotos: photos.length, perPhoto, savedAs: outFile });
  } catch (err) {
    send({ type: "error", message: err.message ?? String(err) });
  } finally {
    res.end();
  }
});

// Lets the browser download the saved markdown file after generation.
app.get("/journal/:file", (req, res) => {
  const safeName = path.basename(req.params.file); // guards against path traversal
  const filePath = path.join(__dirname, "journal-output", safeName);
  if (!fs.existsSync(filePath)) {
    res.status(404).send("Not found");
    return;
  }
  res.download(filePath);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PixelDiary is running at http://localhost:${PORT}`);
});
