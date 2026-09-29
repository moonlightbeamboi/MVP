# UrbanEye — AI-Powered Mobile Urban Intelligence Platform Using Public Transport Fleet

**Smart India Hackathon 2026 · Working MVP prototype**

UrbanEye turns a public-transport bus into a moving road-sensing unit. A camera watches the road, on-board
AI detects what matters (vehicles, congestion, potholes, waterlogging, pedestrians, traffic signs, incidents,
number plates), and every detection is geo-tagged and streamed to a centralized traffic control-room dashboard.

This MVP **simulates the entire architecture on a single laptop**:

| Real system | This prototype |
| --- | --- |
| Fleet camera | Laptop **webcam** / bundled road videos / screen-share / any video file |
| Vehicle GPS unit | **Simulated bus** on a real Sector 62–63 (Noida) route loop · device GPS optional |
| On-board edge AI box | **TensorFlow.js in the browser** (no server, no GPU needed) |
| City data platform | **Firebase Firestore** (optional) or built-in offline store |
| Control room | Live map, incident queue, analytics — in the same app |

---

## Quick start

```bash
npm install       # once
npm run dev       # → http://localhost:5173
```

That's it. The app boots in **offline local-store mode** — no accounts, no API keys. The AI models and sample
videos are already vendored into `public/` (≈60 MB), so it also works with **no internet**.

> If you ever clone this repo without `public/models` / `public/tesseract` / `public/samples`, run
> `npm run vendor` once to re-download them.

### Demo flow (2 minutes)

1. **Overview** page → *Open Bus Unit*. The bundled city-junction video starts playing as the "bus camera".
2. Press **Start AI Sensing**. Detection boxes appear; the Live Perception panel counts vehicles/pedestrians
   and computes a traffic-density index. Events appear in the feed as the AI fires them.
3. Use **Demo Aids** (right column) to inject a pothole / waterlogging / congestion / accident report at will —
   useful when live conditions can't produce a specific event during the presentation.
4. Open **Control Room** (same tab or a second tab/window — they sync):
   - *Live Map*: the bus moves along the dashed route, incident markers + heatmap build up in real time.
   - *Incident Management*: click any incident → evidence snapshot, confidence, GPS, sensor metrics,
     plate-OCR result, and the acknowledge → in-progress → resolved workflow. Filters + CSV export included.
   - *Analytics*: incidents over time, category split, road-user counts, density index along the route.
5. **Architecture** page explains how each simulated piece maps to the real deployment (judges like this one).

### Camera source options (Bus Unit)

- **Bundled Indian street clips** — *Bengaluru street* (HSR Layout, ~25 vehicles in frame), *Mumbai traffic*
  (dense corridor for the congestion story), *Bad road — potholes* (a water-filled pothole the detector fires
  on with ~0.95 confidence) and *Cattle on road* (a bull crossing an intersection — stray-cattle detection at 96%).
- **Webcam** — the honest "bus camera", and the mode for the plate reader: hold any plate (paper, phone
  screen) up to the camera and it gets read and checked against the watchlist.
- **Screen share** — share a browser tab playing any street video (e.g. a dashcam compilation).
- **Video file** — any local mp4.

### Vehicle watchlist & plate OCR

In **Control Room → Vehicle Watchlist** you can add plates to an alert list (e.g. `UP16AB1234`). Plates are
read three ways: automatically on qualifying incidents, continuously with the **Continuous plate reader**
toggle (webcam mode — OCR every ~2.5 s, no vehicle detection needed), or on demand via **Scan number plate**.
A hit flags the sighting **critical**, badges it `ALERT` in the incident queue, and files it under Flagged
sightings. Matching tolerates typical OCR confusions (O↔0, I/L↔1, S↔5, B↔8, Z↔2, G↔6), partial fragments of
4+ characters, and reads that drop a character or two (longest-common-substring over the canonical form).
The list lives in localStorage for the MVP; move it to Firestore for multi-device deployments.

Hazard detections also flash a banner on the video itself — **“⚠ POTHOLE DETECTED”**, waterlogging, stray
cattle, sudden braking — so the audience sees the AI react live.

### Real GPS

The Bus Unit's **Use device GPS** toggle replaces the simulated route with the laptop/phone's actual
geolocation (verified working — the laptop's WiFi-position fix streams as the bus position, and the top bar
switches its badge from *sim GPS* to *real GPS*). If permission is denied the app says so and stays on the
simulated route. **Reset demo data** (top bar, local mode) wipes stored events for a clean rehearsal.

---

## Optional: go multi-device with Firebase

By default everything stays on one machine (localStorage + BroadcastChannel sync between tabs). To have a real
"bus uploads to cloud, control room subscribes" setup across laptops/phones:

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) (free Spark plan).
2. **Build → Firestore Database → Create database** (test mode, pick a region).
3. **Project settings → Your apps → Web app (`</>`)** → copy the config values.
4. Copy `.env.example` to `.env`, fill in the `VITE_FIREBASE_*` values, restart `npm run dev`.
5. The top-bar badge switches from *Local demo store* to *Firebase live*. Events and bus position now flow
   through Firestore — open the Control Room on a phone (same Wi-Fi, `npm run dev -- --host`) and watch it
   update live.

Collections used: `events/{id}` (documents with type, severity, confidence, lat/lng, speed, heading, JPEG
snapshot, plate, details) and `fleet/{busId}` (latest position). Test-mode rules are fine for a demo — do not
ship them to production.

---

## How the AI works (honest version)

- **Detection model** — SSD MobileNet-v2 (the accurate variant, vendored locally) via TensorFlow.js WebGL at
  ~8 fps, restricted to road-relevant classes only (COCO's keyboard/bird hallucinations on road texture are
  filtered out before they reach the overlay or stats), with per-class confidence floors. An IoU tracker
  provides unique counts and a motion-based speed proxy.
- **Stray cattle & dogs on the carriageway** — COCO's `cow`/`dog` classes, sized + confidence gated (fires at
  up to 96% confidence on the bundled bull clip). A very Indian road condition, detected by the same on-board model.
- **Potholes** — two classical-CV signatures on the road ROI (bottom-center of frame): (1) a dark, high-edge
  patch — a dry, shadowed hole; (2) a large *smooth warm pool* — murky water filling a pothole (the monsoon
  killer condition; measured 0.25–0.28 pool ratio on the bundled bad-road clip vs ≤0.17 on normal streets).
  Both are localized into an on-screen bounding box with a persistence gate (two consecutive positives).
  Sensitivity is a slider; it's a demo of the *pipeline*, not a production pothole model.
- **Waterlogging** — blue-sheen + specular-glare pixel statistics, extended with the murky-pool signature,
  localized on screen like other hazards.
- **Rash driving** — per-vehicle tracked speed vs the median speed of surrounding traffic; a vehicle moving
  ~2.8× faster than traffic flow raises a high-severity event.
- **Congestion** — fusion of in-frame vehicle count and tracked motion speed → 0–100 density index. The
  bundled Mumbai clip drives it to 100/100 “Heavy / Congested”.
- **Harsh braking** — sudden drop of the tracked motion proxy.
- **Number plates** — three ways: automatically on qualifying incidents, the **continuous plate reader**
  toggle (webcam mode), and on-demand **Scan number plate**. The OCR localizes the high-edge text band inside
  the vehicle crop, preprocesses (grayscale + contrast), upscales, runs Tesseract.js with a plate alphabet in
  two segmentation modes, then applies Indian-format position-aware correction (2 letters, 1-2 digits,
  1-3 letters, 3-4 digits — fixing I↔1, O↔0, S↔5, B↔8 confusions by position). Watchlist matching additionally
  tolerates partial fragments and dropped characters. When unreadable at the available resolution, the event
  says so rather than inventing a plate.
- **Demo Aids** — manual injection buttons (pothole, waterlogging, stray cattle, congestion, accident) so
  every dashboard feature can be demonstrated on demand.

The simulated bus runs a **real Sector 62–63 route loop in Noida** (past the JIIT gate, along the Sector 62
main road to the 62/63 boundary and back through Sector 63) on dark OSM tiles.

`Architecture` page in the app documents how to swap each simulated piece for real hardware.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:5173 (`-- --host` to expose on LAN) |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run vendor` | (Re)download offline AI models, OCR data and sample videos into `public/` |

## Tech stack

React 19 · Vite 7 · TypeScript (strict) · TensorFlow.js + COCO-SSD · Tesseract.js · Leaflet + OSM ·
Recharts · Zustand · Tailwind CSS v4 · Firebase (optional)

## Presentation-day checklist

- [ ] Charge the laptop; close heavy apps (Chrome + this app ≈ 2–3 GB RAM with AI running).
- [ ] `npm run dev` and do one dry run of the 2-minute flow.
- [ ] Decide your camera story: bundled clip (safest), webcam, or screen share of a dashcam video.
- [ ] If using Firebase, verify the badge shows *Firebase live* and the phone sees the map.
- [ ] Keep the **Demo Aids** buttons in your back pocket — they always work, even offline.
