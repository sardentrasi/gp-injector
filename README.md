# GP-Injector - RP2040 Input Engine 🎮⚙️

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Linux-lightgrey)

GP-Injector is a high-performance Python-based input translation engine. It intercepts inputs from standard USB Gamepads or Keyboard/Mouse setups and translates them into a serial UART datastream, designed directly for RP2040/GP2040-CE - UART devices bridging authentication to PS5.

## 🔗 GP2040-CE UART Integration

GP-Injector is specifically built as the **"Host software"** companion for our custom-modified GP2040-CE firmware.
By connecting the Raspberry Pi's TX/RX pins directly to the RP2040 board, GP-Injector acts as a proxy: injecting high-speed controller data from KBM or Gamepad directly into the RP2040 via UART, enabling elite anti-recoil and mapping capabilities.

## ✨ Key Features

- 🌐 **Modern Web Dashboard:** Manage your entire configuration via a responsive, glassmorphism-styled Web UI (Complete with Light & Dark modes).
- 🕹️ **Dual Mode (Gamepad / KBM):** Play your games using a native PS4/PS5/Xbox controller, or easily switch to Keyboard and Mouse configuration.
- 🔧 **Deep Customization:**
  - **Button Remapping:** Remap any paddle or button.
  - **Anti-Recoil:** Dynamically adjusts right-stick pitch automatically when triggers are pulled.
  - **Turbo (Rapid Fire):** Adjustable Hz rapid-fire logic built straight into the loop.
  - **Analog Curves & Deadzones:** Fine-tune radial deadzones and apply Exponential or S-Curve multipliers.
- 🤖 **Smart Auto-Detection:** Intelligently skips false DualSense event nodes (like Touchpad or Motion sensors) to instantly map onto the primary Gamepad device at boot.
- ⏱️ **Ultra-Low Latency:** Relies on a non-blocking `select`-based polling loop locked at 250Hz minimum to guarantee crisp input delivery and prevent PS5 authentication timeouts.

## 📦 Requirements

- **OS:** Linux (Designed for Raspberry Pi)
- **Python:** 3.6+
- **Hardware:**
  - Raspberry Pi (or any Linux board)
  - RP2040 Board flashed with GP2040-CE firmware (and UART Passthrough enabled)

### Python Dependencies

```bash
pip install pyserial flask evdev
```

## 🚀 Installation & Usage

### 1. Automated Installation (Recommended)

You can automatically install all dependencies and set up GP-Injector to run in the background (as a `systemd` service) on boot.

```bash
# Make the installer executable
chmod +x install.sh

# Run the installer
sudo ./install.sh
```

### 2. Manual Installation

If you prefer to run it manually without installing as a background service:

1. **Copy the directory:** Place the `Bridge` folder on your Raspberry Pi.
2. **Run the Script:**
   ```bash
   python3 gp_injector.py
   ```

### 3. Access the Web UI

Open a browser on your PC or phone and go to:

```text
http://localhost:8080
```

Navigate the dashboard, set your sensitivity or remappings, and click **Start Bridge** to begin injecting inputs.

## 🛠️ Architecture

GP-Injector safely separates into two decoupled layers:

1. **Flask API Thread:** Handles Web interactions, saving standard JSON configuration dynamically.
2. **Bridge Worker Thread:** Dedicated polling loop for `evdev` that catches events, runs modifications, and flushes bytes to the `serial` descriptor linearly, preventing the Web layer from slowing down controller response time.

## 📝 Configuration (bridge_config.json)

The application handles everything through the Web UI and saves it into exactly one local file: `bridge_config.json`. If you break the configuration or want to completely factory-reset, just delete the `bridge_config.json` file and restart `gp_injector.py`.

---

_Built to bring elite controller capabilities to DIY open-source gamepads._
