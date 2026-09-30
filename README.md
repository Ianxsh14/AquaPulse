# AquaPulse Simulator

AquaPulse is a bench-oriented simulation of an adaptive software-defined sonar transmitter payload for AUVs.

The simulator demonstrates the project decision loop:

**Sense → Decide → Generate → Transmit → Verify**

It combines:
- water-condition inputs,
- mission requirements,
- battery state,
- transducer limits,
- a constraint-first waveform optimizer,
- energy-per-ping budgeting,
- DAC / sampling constraints,
- transducer-aware filtering,
- electrical output verification,
- matched-filter pulse compression,
- and feasibility gates.

## Important scope note

This is **not** a validated underwater sonar-range predictor.

The web app is intended to demonstrate the transmitter decision logic and the engineering trade-offs discussed for the AquaPulse SIH prototype.

Real underwater acoustic performance still requires:
- calibrated source-level measurements,
- an actual transducer,
- receiver characterization,
- water-tank tests,
- and field validation.

## What the simulator models

### Environment
- Temperature
- Salinity
- Depth
- pH
- Turbidity proxy
- Bubble / sea-state noise penalty

### Mission
- High Resolution
- Balanced
- Long Range
- Eco
- Required range
- Required range resolution

### Battery
- Remaining energy
- Reserved energy
- Planned remaining pings
- Per-ping energy budget

### Transducer / electronics
- Centre frequency
- Usable bandwidth
- Maximum drive voltage
- Maximum duty cycle
- DAC update rate
- DAC bit depth
- Driver efficiency
- Load impedance

### Optimizer
Candidates are rejected if they violate:
- transducer bandwidth,
- DAC sampling quality,
- requested resolution,
- modelled range margin,
- per-ping energy budget,
- duty-cycle limits.

Remaining candidates are scored according to mission mode.

### Visual outputs
- generated waveform,
- instantaneous-frequency chirp view,
- analog-chain / transducer response,
- matched-filter pulse compression,
- candidate score space,
- candidate rejection breakdown,
- V/I-based transducer health,
- feasibility gates.

## Physics used

Range resolution:

```
ΔR ≈ c / (2B)
```

Per-ping energy budget:

```
E_ping,max = (E_remaining - E_reserve) / N_pings_remaining
```

The simulator also uses:
- a Mackenzie-style sound-speed equation,
- a simplified frequency-dependent seawater absorption model,
- a first-order transmission-loss estimate,
- a scenario-based active-sonar link-margin model.

These are used for **decision simulation**, not to claim measured underwater performance.

## Running locally

No build step is required.

Open `index.html` directly in a browser, or run any simple static HTTP server.

Example with Python:

```bash
python -m http.server 8000
```

Then open:

```
http://localhost:8000
```

## GitHub Pages

This repository is designed to run as a static GitHub Pages site.

In GitHub:

1. Open **Settings**
2. Go to **Pages**
3. Under **Build and deployment**, choose **Deploy from a branch**
4. Select `main`
5. Select `/ (root)`
6. Save

The site will then be published at a URL similar to:

```
https://<username>.github.io/AquaPulse/
```

## Project context

AquaPulse is being developed for the Smart India Hackathon problem:

**Development of a Low-Power, Real-Time Adaptive Software-Defined Sonar Transmitter Payload for Autonomous Underwater Vehicles (AUVs)**

The web simulator is a supporting demonstration for the hardware prototype.