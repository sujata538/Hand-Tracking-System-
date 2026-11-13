# 🌸 Living Garden — Grow Flowers With Your Hands

A real-time webcam experience where you plant, grow, and tend a generative
flower garden using nothing but hand gestures. No backend, no build step —
MediaPipe Hands + Canvas 2D, running entirely in the browser.

Unlike a typical "control a shape with your hand" demo, nothing here is
directly puppeted. You plant seeds; the garden grows on its own, keeps
living while your hands are out of frame, and responds to how you tend it.

## Controls

| Gesture | Effect |
|---|---|
| Pinch fingers together, then flick them open fast | Plants a seed at that hand's position — it sprouts and grows autonomously over the next several seconds |
| Hold an open palm near a grown flower | That specific flower blooms open (bloom is per-flower and proximity-based) |
| Bring both hands together fast (clap) | Fertilizer burst — every flower gets a growth/bloom boost, plus a particle explosion and a wind gust |
| Sway either hand side to side | Generates wind that bends every stem in the garden |
| Do nothing | Mature flowers keep gently swaying and pulsing on their own — the garden persists |

The garden holds up to 10 flowers; planting an 11th retires the oldest.

## Why this design

The original build (a single flower you puppet with two static pinches)
is a nice demo but a shallow interaction — the moment your hands stop
moving, the whole thing goes inert. This version is built around a
different idea: **the garden should feel alive independent of you.**
Growth runs on its own clock. Bloom depends on care (proximity), not a
knob. A clap is a discrete, satisfying "event" gesture rather than a
continuous control. The result is a system you *tend*, not a puppet
you *operate*.

## Tech stack

- **MediaPipe Hands** (`@mediapipe/hands@0.4`) — 21-point hand landmark detection, via CDN
- **MediaPipe Camera Utils** (`@mediapipe/camera_utils@0.3`) — webcam frame piping
- **HTML5 Canvas 2D** — all rendering (stems, petals, particles, hand guides, HUD)
- **Vanilla JavaScript (ES6 classes)** — no framework, no bundler

## Gesture math worth knowing

- **Pinch openness** is normalized against wrist-to-knuckle distance, so
  it reads consistently whether your hand is close to or far from the
  camera.
- **Fist detection** counts how many of the four non-thumb fingertips sit
  closer to the wrist than their own knuckle does — three or more folded
  fingers counts as a fist.
- **Clap detection** tracks the distance between your two palm centers
  and fires when that distance drops sharply after having been wide open
  moments earlier (a real "coming together" motion, not just two hands
  that happen to be close).

## Running it locally

Camera access requires `localhost` or `https://` — opening `index.html`
directly via `file://` will not work.

```bash
cd flower-bloom
npx serve .
```

Then open the printed URL and allow camera access.

## Known tuning knobs (if gestures feel off)

All in `app.js`, inside `LivingGardenApp`:

- Seed-planting sensitivity: the `0.18` / `0.58` thresholds in
  `onHandResults` (closed-pinch and flick-open thresholds)
- Planting cooldown: `1100` ms in the same block
- Clap sensitivity: `0.09` (must-close-to) and `0.24` (must-have-been-open)
  in the clap detection block
- Bloom proximity radius: `radius = 150` in the animation loop
- Garden size cap: `this.maxGardenFlowers = 10` in the constructor

## Ideas for a next pass

- Swap flower species per fist-gesture cycle (tulip / rose / lily presets)
- A "record" button exporting a few seconds of canvas frames as a GIF
- Day/night ambient lighting cycle tied to real elapsed session time
- Two-hand "stretch" gesture to create a connecting vine between two flowers
