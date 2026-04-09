# GP-Injector — Multi-Slot Input Translation Engine 🎮⚙️

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Linux-lightgrey)

**GP-Injector** is a high-performance, multi-threaded input translation engine designed for elite gaming setups. It bridges standard USB Gamepads or Keyboard/Mouse setups to a serial UART datastream, optimized for **XBOX360 bridging** via RP2040/GP2040-CE devices.

## 🚀 The Multi-Slot Revolution

GP-Injector now supports **Multi-Slot Architecture**, allowing a single host (e.g., Raspberry Pi) to manage up to **4 independent controllers** simultaneously. Each slot acts as a dedicated, asynchronous bridge with its own configuration.

- **Independent Input Modes:** Assign Slot 1 to a DualSense, Slot 2 to Keyboard/Mouse, and Slot 3 to a mobile Virtual Pad.
- **Dedicated UART Ports:** Map each slot to a unique hardware peripheral (e.g., `/dev/ttyS0`, `/dev/ttyS1`).
- **Isolation:** A crash or disconnect in one slot does not impact the stability of others.

## ✨ Core Features

- 🌐 **Modern Web Dashboard:** A responsive, glassmorphism-styled Web UI featuring the **Wise Design System** (Light & Dark modes).
- 📱 **Virtual Gamepad:** High-fidelity browser-based controller for mobile play or testing.
- 🔧 **Elite Input Engine:**
  - **Anti-Recoil:** Dynamic right-stick pitch adjustment during trigger activation.
  - **Turbo (Rapid Fire):** Adjustable frequency logic built at the hardware tick level.
  - **Radial Deadzones:** Eliminate stick drift with precision inner/outer bounds.
  - **Sensitivity Curves:** Custom Response Curves (Linear, Exponential, or S-Curve).
- 🤖 **Smart Auto-Detection:** Intelligently identifies primary gamepad nodes while skipping auxiliary sensor nodes (touchpad/motion).
- ⚙️ **Automated Web Config Bypass:** Directly enter GP2040-CE configurator mode via GPIO-orchestrated boot loops, avoiding RNDIS conflicts.

## ⏱️ Performance Architecture

GP-Injector is engineered for **Zero perceived latency**, prioritizing the UART signal above all else.

### 1. UART-First Scheduling

The 250Hz core bridge logic is protected by **UART Priority Logic**. Visual telemetry is throttled to 50Hz, ensuring the serial stream remains "Rock Solid" and jitter-free even during heavy UI interaction.

### 2. High-Speed Telemetry

- **WebSocket Driven:** Telemetry uses persistent WebSocket pipes (`/ws/state`) to eliminate HTTP overhead.
- **Atomic State Sharing:** Data is passed via high-speed atomic copies in Python, removing the CPU overhead of JSON roundtrips in the critical path.
- **Neon-Glow Visualizer:** Real-time, interactive controller graphic with color-coded pendar (glow) for face buttons (ABXY) and D-Pad.

## 📦 Requirements

- **OS:** Linux (Designed for Raspberry Pi)
- **Python:** 3.6+
- **Hardware:**
  - Raspberry Pi (or similar Linux board)
  - RP2040 Board flashed with GP2040-CE firmware (UART Passthrough enabled)

### Dependencies

```bash
pip install pyserial flask flask-sock evdev
```

## 🛠️ Usage

1. **Install:** Run `sudo ./install.sh` to set up as a background systemd service.
2. **Launch:** Access the dashboard at `http://<pi-ip>:8080`.
3. **Configure:** Use the **Dashboard** to enable slots, assign serial ports, and choose your input mode.
4. **Play:** Click **Start Bridge** and monitor live telemetry with zero lag.

---

> [!TIP]
> **Performance Note:** If you experience any visual delay on the Dashboard, the system is designed to favor the **UART Signal**. Your in-game movements will remain 1:1 even if the browser rendering encounters network jitter.

_Built to bring elite controller capabilities to DIY open-source gamepads._
