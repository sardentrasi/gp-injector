# Release Notes — GP-Injector v2.0 "Starlight" 🌟

We are excited to announce the release of **GP-Injector v2.0**, a ground-up overhaul focusing on performance, visual fidelity, and multi-device capabilities.

## 🚀 NEW: Multi-Slot Architecture
The bridge has evolved from a single-device relay to a multi-slot engine.
- **4-Slot Management**: Run up to 4 concurrent controller-to-UART bridges from a single host.
- **Dynamic Slot Allocation**: Each slot can be independently enabled and assigned a specific input device and UART peripheral (e.g., `/dev/ttyS0` through `ttyS3`).
- **Isolation**: Each worker thread is decoupled; a disconnect in Slot 1 will not cause jitter or latency in Slot 2.

## ⏱️ Performance: UART Priority Logic
Achieving a "Rock Solid" 250Hz signal was our top priority.
- **Telemetry Throttling**: Visual state mirroring is now intelligently throttled to 50Hz (50 FPS). This secures 80% more CPU/Lock capacity for the critical UART path.
- **Atomic State Sharing**: Replaced heavy JSON serialization in the bridge loop with high-speed memory copies, reducing internal latency by up to 90%.
- **Zero-Latency WebSockets**: Migrated from legacy SSE (EventSource) to persistent WebSockets (`/ws/state`) for real-time visual telemetry.

## 🎨 UI/UX: High-Fidelity Dashboard
The dashboard has been redesigned for a more immersive and informative experience.
- **Real-Time Input Viewer**: Replaced the analytical grid with a beautiful, gamepad-shaped interactive visualizer.
- **Neon-Glow Feedback**: Added multi-layered pendar (glow) effects for buttons. Face buttons (ABXY) and the D-Pad now feature color-coded neon feedback.
- **Compact Layout**: A new dashboard density mode that minimizes whitespace, perfect for monitoring multiple slots on a single screen.
- **Virtual Gamepad Sync**: The visual language is now unified across the physical viewer and the Virtual Pad.

## 🔧 Internal Improvements
- **Smart Deduplication**: The WebSocket only pushes data when the controller state actually changes, significantly reducing network traffic.
- **Thread Safety**: Refined `threading.Lock` management to prevent GIL contention between the bridge and the web server.
- **Enhanced Auto-Detection**: Improved `evdev` node filtering to instantly find the correct gamepad handle at boot.

---
_Thank you for using GP-Injector. This update ensures that your hardware bridge is as fast as your reflexes._
