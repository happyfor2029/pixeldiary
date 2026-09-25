# PixelDiary — Day in my life 

An on-device daily photo journal generator, built on [Tether's QVAC SDK](https://github.com/tetherto/qvac).

Point it at a folder of photos — your day's camera roll export, say — and it writes you
a short, warm journal entry about your day, based only on what it sees in those photos.
Every step runs locally on your machine: no photo, and no fact derived from it, is ever
sent anywhere.

## QVAC SDK Dependency

- Package: `@qvac/sdk`
- Version used: `^0.19.0`

## What it does / which QVAC functions it calls

1. `loadModel` + `classify()` — tags each photo using QVAC's bundled MobileNetV3-Small
   image classifier (`food` / `report` / `other`).
2. `loadModel` + `completion()` — feeds that day's photo tally to a local LLM
   ([Llama 3.2 1B Instruct](https://github.com/tetherto/qvac)), which writes a short,
   reflective journal entry, streamed live and saved to a markdown file.

Both models run entirely through QVAC's on-device worker — there is no cloud AI call
anywhere in this app. Available as a CLI (`src/index.js`) or a local web UI
(`server.js` + `public/index.html`) — both call the same shared pipeline in
`src/pipeline.js`.

## Why I built this

Journaling apps that read your photos usually mean uploading your camera roll to
someone else's server. I wanted something that gives the same "what did I actually do
today" nudge without your photos, or any description of your day, ever leaving your
laptop.

## Requirements

- [Node.js](https://nodejs.org/) >= 22.17
- npm >= 10.9
- ~5 GB free disk space (for the on-device model download on first run)
- A folder of `.jpg` / `.jpeg` / `.png` photos to point it at

## Install

```bash
git clone https://github.com/happyfor2029/pixeldiary.git
cd pixeldiary
npm install
```

This installs `@qvac/sdk` (`^0.19.0`), declared as a dependency in `package.json`.

## Run — web UI

```bash
npm run web
```

Then open **http://localhost:3000**. Drop in a folder's worth of photos (or click to
browse), hit **Develop journal**, and watch the photos get classified and the journal
entry stream in live, right in the browser. Everything still runs through the same
on-device QVAC pipeline as the CLI — the browser just talks to a small local Express
server (`server.js`) on your own machine; nothing is uploaded anywhere external.

On first run, QVAC downloads the classification and language models it
needs — this can take a few minutes depending on your connection. After that, everything
runs offline.
Press CTRL+C to stop the program.

## Sample Photos
https://github.com/happyfor2029/pixeldiary/releases/tag/sample

## Notes

- The classifier's labels (`food` / `report` / `other`) come from QVAC's bundled
  MobileNetV3-Small model and ship with the SDK — no extra download needed for that step.
- The language model (`LLAMA_3_2_1B_INST_Q4_0`) downloads on first use via QVAC's model
  registry.
- Every photo is downscaled locally (max 512px on the longest side) with `jimp` before
  it's handed to `classify()`. Full-resolution phone photos are often several MB, which
  is large enough to trip a "Maximum call stack size exceeded" error at the RPC layer —
  downscaling first avoids that and is also just faster.
- Nothing about your photos — not the images, not the classification results, not the
  journal text — is sent to any server. Everything happens through QVAC's local worker
  process.

## License

MIT — see [LICENSE](./LICENSE).
