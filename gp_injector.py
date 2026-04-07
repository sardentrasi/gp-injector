#!/usr/bin/env python3
"""
Bridge2 — GIMX-like UART Bridge with Web Configuration
Gamepad → [Remap → Deadzone → Sensitivity → Anti-Recoil → Turbo] → UART → RP2040

Run:  python3 bridge2.py
Open: http://<pi-ip>:8080
"""

import json
import os
import sys
import struct
import time
import math
import threading
from collections import deque
from select import select as _select

# --- Platform-specific imports ---
try:
    import serial
except ImportError:
    serial = None
    print("[!] pyserial not installed. UART disabled.")

try:
    import evdev
    from evdev import ecodes
except ImportError:
    evdev = None
    ecodes = None
    print("[!] evdev not installed. Gamepad disabled.")

try:
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
except ImportError:
    GPIO = None

try:
    from flask import Flask, jsonify, request, send_from_directory
except ImportError:
    print("[X] Flask not installed. Run: pip install flask")
    sys.exit(1)

# ============================================================
# CONSTANTS
# ============================================================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(SCRIPT_DIR, 'bridge_web')
CONFIG_FILE = os.path.join(SCRIPT_DIR, 'bridge_config.json')

BUTTON_NAMES = [
    'X', 'A', 'B', 'Y', 'LB', 'RB', 'LT_DIGITAL', 'RT_DIGITAL',
    'HOME', 'START', 'BACK', 'L3', 'R3'
]

EVCODE_TO_BUTTON = {
    308: 'X', 304: 'A', 305: 'B', 307: 'Y',
    310: 'LB', 311: 'RB', 312: 'LT_DIGITAL', 313: 'RT_DIGITAL',
    316: 'HOME', 315: 'START', 314: 'BACK', 317: 'L3', 318: 'R3'
}

BUTTON_TO_BIT = {
    'X': ('low', 0), 'A': ('low', 1), 'B': ('low', 2), 'Y': ('low', 3),
    'LB': ('low', 4), 'RB': ('low', 5),
    'LT_DIGITAL': ('low', 6), 'RT_DIGITAL': ('low', 7),
    'HOME': ('high', 0), 'START': ('high', 1), 'BACK': ('high', 2),
    'L3': ('high', 3), 'R3': ('high', 4)
}


# ============================================================
# CONFIG MANAGER
# ============================================================
class ConfigManager:
    DEFAULT_PROFILE = {
        "button_remap": {},
        "anti_recoil": {
            "enabled": False,
            "strength": 30,
            "activation_button": "RT_DIGITAL",
            "axis": "ry"
        },
        "turbo": {
            "buttons": {},
            "speed_hz": 15
        },
        "deadzone": {
            "left_stick": 5,
            "right_stick": 5
        },
        "sensitivity": {
            "left_stick": {"curve": "linear", "multiplier": 1.0},
            "right_stick": {"curve": "linear", "multiplier": 1.0}
        },
        "key_bindings": {
            "KEY_W": "axis:ly:-32768",
            "KEY_S": "axis:ly:32767",
            "KEY_A": "axis:lx:-32768",
            "KEY_D": "axis:lx:32767",
            "KEY_SPACE": "btn:X",
            "KEY_LEFTSHIFT": "btn:L3",
            "KEY_E": "btn:A",
            "KEY_R": "btn:Y",
            "KEY_F": "btn:B",
            "KEY_Q": "btn:LB",
            "KEY_G": "btn:RB",
            "KEY_TAB": "btn:BACK",
            "KEY_ESC": "btn:START",
            "KEY_C": "btn:R3",
            "KEY_1": "dpad:up",
            "KEY_2": "dpad:down",
            "KEY_3": "dpad:left",
            "KEY_4": "dpad:right"
        },
        "mouse_bindings": {
            "BTN_LEFT": "btn:RT_DIGITAL",
            "BTN_RIGHT": "btn:LT_DIGITAL",
            "BTN_MIDDLE": "btn:R3"
        },
        "mouse_sensitivity": 50,
        "mouse_y_invert": False
    }

    DEFAULT_CONFIG = {
        "serial_port": "/dev/ttyS0",
        "baud_rate": 500000,
        "device_path": "auto",
        "input_mode": "gamepad",
        "keyboard_device": "",
        "mouse_device": "",
        "web_port": 8080,
        "debug_interval": 0.5,
        "active_profile": "Default",
        "profiles": {
            "Default": None
        }
    }

    def __init__(self):
        self._lock = threading.Lock()
        self.config = self._load()

    def _deep_copy(self, obj):
        return json.loads(json.dumps(obj))

    def _default_config(self):
        cfg = self._deep_copy(self.DEFAULT_CONFIG)
        cfg['profiles']['Default'] = self._deep_copy(self.DEFAULT_PROFILE)
        return cfg

    def _merge(self, default, override):
        result = {}
        for k, v in default.items():
            if k in override:
                if isinstance(v, dict) and isinstance(override[k], dict):
                    result[k] = self._merge(v, override[k])
                else:
                    result[k] = override[k]
            else:
                result[k] = self._deep_copy(v) if isinstance(v, (dict, list)) else v
        for k in override:
            if k not in default:
                result[k] = override[k]
        return result

    def _load(self):
        default = self._default_config()
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r') as f:
                    user_cfg = json.load(f)
                return self._merge(default, user_cfg)
            except Exception:
                pass
        return default

    def save(self):
        with self._lock:
            with open(CONFIG_FILE, 'w') as f:
                json.dump(self.config, f, indent=2)

    def get(self):
        with self._lock:
            return self._deep_copy(self.config)

    def get_active_profile(self):
        with self._lock:
            name = self.config.get('active_profile', 'Default')
            profiles = self.config.get('profiles', {})
            if name in profiles and profiles[name]:
                return name, self._deep_copy(profiles[name])
            first_name = next(iter(profiles), None)
            if first_name and profiles[first_name]:
                return first_name, self._deep_copy(profiles[first_name])
            return 'Default', self._deep_copy(self.DEFAULT_PROFILE)

    def update_settings(self, data):
        with self._lock:
            for key in ['serial_port', 'baud_rate', 'device_path', 'debug_interval',
                        'web_port', 'input_mode', 'keyboard_device', 'mouse_device']:
                if key in data:
                    self.config[key] = data[key]
        self.save()

    def update_profile(self, name, data):
        with self._lock:
            if name in self.config.get('profiles', {}):
                prof = self.config['profiles'][name]
                if prof is None:
                    self.config['profiles'][name] = self._deep_copy(self.DEFAULT_PROFILE)
                    prof = self.config['profiles'][name]
                for section in ['button_remap', 'anti_recoil', 'turbo', 'deadzone', 'sensitivity',
                                'key_bindings', 'mouse_bindings', 'mouse_sensitivity', 'mouse_y_invert']:
                    if section in data:
                        prof[section] = data[section]
        self.save()

    def create_profile(self, name):
        with self._lock:
            if name and name not in self.config.get('profiles', {}):
                self.config.setdefault('profiles', {})[name] = self._deep_copy(self.DEFAULT_PROFILE)
        self.save()

    def delete_profile(self, name):
        with self._lock:
            profiles = self.config.get('profiles', {})
            if name in profiles and len(profiles) > 1:
                del profiles[name]
                if self.config.get('active_profile') == name:
                    self.config['active_profile'] = next(iter(profiles))
        self.save()

    def switch_profile(self, name):
        with self._lock:
            if name in self.config.get('profiles', {}):
                self.config['active_profile'] = name
        self.save()

    def list_profiles(self):
        with self._lock:
            return list(self.config.get('profiles', {}).keys())


# ============================================================
# INPUT PROCESSOR
# ============================================================
class InputProcessor:
    def __init__(self):
        self._turbo_states = {}
        self._turbo_last_toggle = {}

    def process(self, raw_buttons, raw_axes, raw_dpad, profile):
        buttons = dict(raw_buttons)
        axes = dict(raw_axes)
        dpad = dict(raw_dpad)

        # Pipeline: Remap → Deadzone → Sensitivity → Anti-Recoil → Turbo
        buttons = self._apply_remap(buttons, profile.get('button_remap', {}))
        axes = self._apply_deadzone(axes, profile.get('deadzone', {}))
        axes = self._apply_sensitivity(axes, profile.get('sensitivity', {}))
        axes = self._apply_anti_recoil(axes, buttons, profile.get('anti_recoil', {}))
        buttons = self._apply_turbo(buttons, profile.get('turbo', {}))

        return buttons, axes, dpad

    def _apply_remap(self, buttons, remap):
        if not remap:
            return buttons
        original = dict(buttons)
        result = {b: 0 for b in BUTTON_NAMES}
        for btn_name, value in original.items():
            if not value:
                continue
            target = remap.get(btn_name, btn_name)
            if target in result:
                result[target] = 1
        return result

    def _apply_deadzone(self, axes, dz_config):
        left_dz = dz_config.get('left_stick', 5) / 100.0
        right_dz = dz_config.get('right_stick', 5) / 100.0

        lx, ly = axes.get('lx', 0), axes.get('ly', 0)
        l_mag = math.sqrt(lx * lx + ly * ly) / 32768.0 if (lx or ly) else 0
        if l_mag < left_dz:
            axes['lx'] = 0
            axes['ly'] = 0

        rx, ry = axes.get('rx', 0), axes.get('ry', 0)
        r_mag = math.sqrt(rx * rx + ry * ry) / 32768.0 if (rx or ry) else 0
        if r_mag < right_dz:
            axes['rx'] = 0
            axes['ry'] = 0

        return axes

    def _apply_sensitivity(self, axes, sens_config):
        for stick, ax, ay in [('left_stick', 'lx', 'ly'), ('right_stick', 'rx', 'ry')]:
            cfg = sens_config.get(stick, {'curve': 'linear', 'multiplier': 1.0})
            curve = cfg.get('curve', 'linear')
            mult = cfg.get('multiplier', 1.0)
            axes[ax] = self._curve(axes.get(ax, 0), curve, mult)
            axes[ay] = self._curve(axes.get(ay, 0), curve, mult)
        return axes

    def _curve(self, value, curve_type, multiplier):
        if value == 0:
            return 0
        sign = 1 if value > 0 else -1
        norm = abs(value) / 32768.0

        if curve_type == 'exponential':
            output = norm ** 2.0
        elif curve_type == 's_curve':
            output = norm ** 3.0 * 0.5 + norm * 0.5
        else:
            output = norm

        output = min(output * multiplier, 1.0)
        return max(-32768, min(32767, int(sign * output * 32768)))

    def _apply_anti_recoil(self, axes, buttons, ar_config):
        if not ar_config.get('enabled', False):
            return axes
        activation = ar_config.get('activation_button', 'RT_DIGITAL')
        if not buttons.get(activation, 0):
            return axes
        strength = ar_config.get('strength', 30)
        axis = ar_config.get('axis', 'ry')
        compensation = int(strength * 32768 / 100)
        axes[axis] = max(-32768, min(32767, axes.get(axis, 0) + compensation))
        return axes

    def _apply_turbo(self, buttons, turbo_config):
        turbo_buttons = turbo_config.get('buttons', {})
        speed = turbo_config.get('speed_hz', 15)
        if speed <= 0:
            speed = 15
        interval = 1.0 / (speed * 2)
        now = time.time()

        for btn_name, enabled in turbo_buttons.items():
            if not enabled or not buttons.get(btn_name, 0):
                self._turbo_states.pop(btn_name, None)
                continue
            last = self._turbo_last_toggle.get(btn_name, 0)
            if now - last >= interval:
                self._turbo_states[btn_name] = not self._turbo_states.get(btn_name, False)
                self._turbo_last_toggle[btn_name] = now
            buttons[btn_name] = 1 if self._turbo_states.get(btn_name, False) else 0
        return buttons


# ============================================================
# BRIDGE WORKER
# ============================================================
class BridgeWorker(threading.Thread):
    def __init__(self, config_manager):
        super().__init__(daemon=True)
        self.config_mgr = config_manager
        self.processor = InputProcessor()
        self._running = False
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._device_info = {'name': None, 'path': None}
        self._live_state = {
            'buttons': {b: 0 for b in BUTTON_NAMES},
            'axes': {'lx': 0, 'ly': 0, 'rx': 0, 'ry': 0, 'lt': 0, 'rt': 0},
            'dpad': {'up': 0, 'down': 0, 'left': 0, 'right': 0},
            'processed_buttons': {b: 0 for b in BUTTON_NAMES},
            'processed_axes': {'lx': 0, 'ly': 0, 'rx': 0, 'ry': 0, 'lt': 0, 'rt': 0},
        }
        self._logs = deque(maxlen=100)

    @property
    def is_running(self):
        return self._running

    def get_device_info(self):
        with self._lock:
            return dict(self._device_info)

    def get_state(self):
        with self._lock:
            return json.loads(json.dumps(self._live_state))

    def get_logs(self):
        with self._lock:
            return list(self._logs)

    def stop(self):
        self._stop_event.set()

    def _log(self, msg):
        with self._lock:
            self._logs.append({'time': time.time(), 'msg': msg})
        print(msg)

    def _rumble_receiver(self, ser, dev):
        effect_id = -1
        buf = bytearray()
        while not self._stop_event.is_set():
            try:
                data = ser.read(max(1, ser.in_waiting))
                if data:
                    buf.extend(data)
                else:
                    time.sleep(0.002)
                    continue
                while len(buf) >= 4:
                    idx = buf.find(0xBB)
                    if idx == -1:
                        buf.clear()
                        break
                    if idx > 0:
                        buf = buf[idx:]
                    if len(buf) < 4:
                        break
                    left_motor, right_motor, chk = buf[1], buf[2], buf[3]
                    calc_chk = buf[0] ^ buf[1] ^ buf[2]
                    if chk == calc_chk:
                        try:
                            rumble = evdev.ff.Rumble(
                                strong_magnitude=int((left_motor / 255.0) * 65535),
                                weak_magnitude=int((right_motor / 255.0) * 65535)
                            )
                            effect = evdev.ff.Effect(
                                ecodes.FF_RUMBLE, effect_id, 0,
                                evdev.ff.Trigger(0, 0),
                                evdev.ff.Replay(0xFFFF, 0),
                                evdev.ff.EffectType(ff_rumble_effect=rumble)
                            )
                            effect_id = dev.upload_effect(effect)
                            dev.write(ecodes.EV_FF, effect_id, 1)
                        except Exception:
                            pass
                    buf = buf[4:]
            except Exception:
                time.sleep(0.01)

    def run(self):
        self._running = True
        self._stop_event.clear()
        config = self.config_mgr.get()
        input_mode = config.get('input_mode', 'gamepad')
        self._log("[*] Bridge starting in {} mode...".format(input_mode))

        if not serial:
            self._log("[X] pyserial not available")
            self._running = False
            return

        try:
            if input_mode == 'kb_mouse':
                self._run_kb_mouse(config)
            else:
                self._run_gamepad(config)
        except Exception as e:
            self._log("[X] Fatal: " + str(e))
        finally:
            self._running = False
            self._log("[!] Bridge stopped.")

    # ---- Shared packet builder ----
    def _build_and_send(self, ser, proc_buttons, proc_axes, proc_dpad, debug_state):
        btn_l, btn_h = 0, 0
        for bname, bval in proc_buttons.items():
            if bval and bname in BUTTON_TO_BIT:
                byte_pos, bit_pos = BUTTON_TO_BIT[bname]
                if byte_pos == 'low':
                    btn_l |= (1 << bit_pos)
                else:
                    btn_h |= (1 << bit_pos)

        dpad_byte = 0
        if proc_dpad.get('up'):    dpad_byte |= 0x01
        if proc_dpad.get('right'): dpad_byte |= 0x02
        if proc_dpad.get('down'):  dpad_byte |= 0x04
        if proc_dpad.get('left'):  dpad_byte |= 0x08

        lx = max(-32768, min(32767, proc_axes['lx']))
        ly = max(-32768, min(32767, proc_axes['ly']))
        rx = max(-32768, min(32767, proc_axes['rx']))
        ry = max(-32768, min(32767, proc_axes['ry']))
        lt = max(0, min(255, proc_axes.get('lt', 0)))
        rt = max(0, min(255, proc_axes.get('rt', 0)))

        packet = bytearray(15)
        packet[0] = 0xA5
        packet[1] = btn_l & 0xFF
        packet[2] = btn_h & 0xFF
        packet[3] = dpad_byte & 0xFF
        struct.pack_into('<hhhh', packet, 4, lx, ly, rx, ry)
        packet[12] = lt & 0xFF
        packet[13] = rt & 0xFF
        chk = 0
        for i in range(14):
            chk ^= packet[i]
        packet[14] = chk

        now = time.time()
        if now - debug_state['last'] >= debug_state['interval']:
            debug_state['last'] = now
            hex_str = " ".join("{:02X}".format(b) for b in packet)
            self._log("[PKT] " + hex_str)

        ser.write(packet)

    # ---- Gamepad mode ----
    def _run_gamepad(self, config):
        if not evdev:
            self._log("[X] evdev not available")
            return

        try:
            path = config.get('device_path', 'auto')
            dev = None
            if path == 'auto' or not path:
                for p in evdev.list_devices():
                    try:
                        d = evdev.InputDevice(p)
                        caps = d.capabilities()
                        # Gamepads typically have both ABS and KEY
                        if ecodes.EV_ABS in caps and ecodes.EV_KEY in caps:
                            name_low = d.name.lower()
                            if 'touchpad' in name_low or 'motion' in name_low or 'keyboard' in name_low or 'mouse' in name_low:
                                d.close()
                                continue
                            dev = d
                            break
                        d.close()
                    except Exception:
                        pass
                if not dev:
                    self._log("[X] No suitable gamepad found on 'auto'")
                    return
            else:
                dev = evdev.InputDevice(path)

            with self._lock:
                self._device_info = {'name': dev.name, 'path': dev.path}
            self._log("[V] Gamepad: {} ({})".format(dev.name, dev.path))
        except Exception as e:
            self._log("[X] Gamepad error: " + str(e))
            return

        try:
            ser = serial.Serial(config['serial_port'], config['baud_rate'], timeout=0)
            self._log("[V] UART: {} @ {}".format(config['serial_port'], config['baud_rate']))
        except Exception as e:
            self._log("[X] UART error: " + str(e))
            dev.close()
            return

        rumble_t = threading.Thread(target=self._rumble_receiver, args=(ser, dev), daemon=True)
        rumble_t.start()

        raw_buttons = {b: 0 for b in BUTTON_NAMES}
        raw_axes = {'lx': 0, 'ly': 0, 'rx': 0, 'ry': 0, 'lt': 0, 'rt': 0}
        raw_dpad = {'up': 0, 'down': 0, 'left': 0, 'right': 0}
        debug_state = {'last': 0, 'interval': config.get('debug_interval', 0.5)}

        TICK = 1.0 / 250  # 250 Hz
        self._log("[!] Gamepad bridge running at 250 Hz.")

        try:
            while not self._stop_event.is_set():
                r, _, _ = _select([dev], [], [], TICK)
                for d in r:
                    try:
                        for event in d.read():
                            if event.type == ecodes.EV_KEY:
                                btn_name = EVCODE_TO_BUTTON.get(event.code)
                                if btn_name:
                                    raw_buttons[btn_name] = event.value
                            elif event.type == ecodes.EV_ABS:
                                c, val = event.code, event.value
                                if   c == 0:  raw_axes['lx'] = max(-32768, min(32767, (val - 128) * 256))
                                elif c == 1:  raw_axes['ly'] = max(-32768, min(32767, (val - 128) * 256))
                                elif c == 3:  raw_axes['rx'] = max(-32768, min(32767, (val - 128) * 256))
                                elif c == 4:  raw_axes['ry'] = max(-32768, min(32767, (val - 128) * 256))
                                elif c == 2:  raw_axes['lt'] = max(0, min(255, val))
                                elif c == 5:  raw_axes['rt'] = max(0, min(255, val))
                                elif c == 16:
                                    raw_dpad['left']  = 1 if val < 0 else 0
                                    raw_dpad['right'] = 1 if val > 0 else 0
                                elif c == 17:
                                    raw_dpad['up']   = 1 if val < 0 else 0
                                    raw_dpad['down'] = 1 if val > 0 else 0
                    except OSError as e:
                        if getattr(e, 'errno', None) == 19:
                            self._log("[!] Device disconnected (ENODEV)")
                            self._stop_event.set()
                            break
                    except Exception:
                        pass

                # Continuously process to allow time-based features (Turbo) to execute
                _, profile = self.config_mgr.get_active_profile()
                proc_buttons, proc_axes, proc_dpad = self.processor.process(
                    raw_buttons, raw_axes, raw_dpad, profile
                )
                with self._lock:
                    self._live_state['buttons'] = dict(raw_buttons)
                    self._live_state['axes'] = dict(raw_axes)
                    self._live_state['dpad'] = dict(raw_dpad)
                    self._live_state['processed_buttons'] = dict(proc_buttons)
                    self._live_state['processed_axes'] = dict(proc_axes)
                
                self._build_and_send(ser, proc_buttons, proc_axes, proc_dpad, debug_state)
                
        except Exception as e:
            self._log("[X] Error: " + str(e))
        finally:
            ser.close()
            dev.close()

    # ---- Binding parser ----
    @staticmethod
    def _apply_binding(binding, buttons, axes, dpad):
        if not binding or binding == 'none':
            return
        if binding.startswith('btn:'):
            btn = binding[4:]
            if btn in buttons:
                buttons[btn] = 1
        elif binding.startswith('axis:'):
            parts = binding.split(':')
            if len(parts) == 3:
                axis_name, axis_val = parts[1], int(parts[2])
                if axis_name in axes:
                    axes[axis_name] = max(-32768, min(32767, axes[axis_name] + axis_val))
        elif binding.startswith('dpad:'):
            direction = binding[5:]
            if direction in dpad:
                dpad[direction] = 1

    # ---- Keyboard + Mouse mode ----
    def _run_kb_mouse(self, config):
        if not evdev:
            self._log("[X] evdev not available")
            return

        kb_path = config.get('keyboard_device', '')
        mouse_path = config.get('mouse_device', '')

        if not kb_path and not mouse_path:
            self._log("[X] No keyboard or mouse device configured.")
            self._log("[!] Set keyboard/mouse paths in Settings tab.")
            return

        devices = []
        kb_dev, mouse_dev = None, None

        if kb_path:
            try:
                kb_dev = evdev.InputDevice(kb_path)
                devices.append(kb_dev)
                self._log("[V] Keyboard: {} ({})".format(kb_dev.name, kb_dev.path))
            except Exception as e:
                self._log("[X] Keyboard error: " + str(e))

        if mouse_path:
            try:
                mouse_dev = evdev.InputDevice(mouse_path)
                devices.append(mouse_dev)
                self._log("[V] Mouse: {} ({})".format(mouse_dev.name, mouse_dev.path))
            except Exception as e:
                self._log("[X] Mouse error: " + str(e))

        if not devices:
            self._log("[X] Failed to open any input device.")
            return

        with self._lock:
            names = []
            if kb_dev:    names.append(kb_dev.name)
            if mouse_dev: names.append(mouse_dev.name)
            self._device_info = {'name': ' + '.join(names), 'path': 'KB+Mouse'}

        try:
            ser = serial.Serial(config['serial_port'], config['baud_rate'], timeout=0)
            self._log("[V] UART: {} @ {}".format(config['serial_port'], config['baud_rate']))
        except Exception as e:
            self._log("[X] UART error: " + str(e))
            for d in devices: d.close()
            return

        # Build evdev code → name lookup
        key_code_to_name = {}
        if ecodes:
            for code in range(600):
                n = ecodes.KEY.get(code) or ecodes.BTN.get(code)
                if n:
                    key_code_to_name[code] = n[0] if isinstance(n, list) else n

        pressed_keys = set()
        mouse_btns = set()
        mouse_dx, mouse_dy = 0, 0
        debug_state = {'last': 0, 'interval': config.get('debug_interval', 0.5)}
        TICK = 1.0 / 250  # 250 Hz

        self._log("[!] KB+Mouse bridge running at 250 Hz.")

        try:
            while not self._stop_event.is_set():
                r, _, _ = _select(devices, [], [], TICK)
                for dev in r:
                    try:
                        for event in dev.read():
                            if event.type == ecodes.EV_KEY:
                                kn = key_code_to_name.get(event.code, '')
                                if kn:
                                    if event.value >= 1:
                                        (mouse_btns if kn.startswith('BTN_') else pressed_keys).add(kn)
                                    elif event.value == 0:
                                        (mouse_btns if kn.startswith('BTN_') else pressed_keys).discard(kn)
                            elif event.type == ecodes.EV_REL:
                                if event.code == ecodes.REL_X:
                                    mouse_dx += event.value
                                elif event.code == ecodes.REL_Y:
                                    mouse_dy += event.value
                    except OSError as e:
                        if getattr(e, 'errno', None) == 19:
                            self._log("[!] Device disconnected (ENODEV)")
                            self._stop_event.set()
                            break
                    except Exception:
                        pass

                # Build state
                _, profile = self.config_mgr.get_active_profile()
                key_bindings = profile.get('key_bindings', {})
                mouse_bindings = profile.get('mouse_bindings', {})
                sens = profile.get('mouse_sensitivity', 50)
                y_inv = profile.get('mouse_y_invert', False)

                raw_buttons = {b: 0 for b in BUTTON_NAMES}
                raw_axes = {'lx': 0, 'ly': 0, 'rx': 0, 'ry': 0, 'lt': 0, 'rt': 0}
                raw_dpad = {'up': 0, 'down': 0, 'left': 0, 'right': 0}

                for kn in pressed_keys:
                    self._apply_binding(key_bindings.get(kn, 'none'), raw_buttons, raw_axes, raw_dpad)
                for bn in mouse_btns:
                    self._apply_binding(mouse_bindings.get(bn, 'none'), raw_buttons, raw_axes, raw_dpad)

                # Mouse → right stick
                sm = sens * 3
                mx = max(-32768, min(32767, int(mouse_dx * sm)))
                my = max(-32768, min(32767, int(mouse_dy * sm)))
                if y_inv: my = -my
                raw_axes['rx'] = max(-32768, min(32767, raw_axes['rx'] + mx))
                raw_axes['ry'] = max(-32768, min(32767, raw_axes['ry'] + my))
                mouse_dx, mouse_dy = 0, 0

                proc_buttons, proc_axes, proc_dpad = self.processor.process(
                    raw_buttons, raw_axes, raw_dpad, profile
                )
                with self._lock:
                    self._live_state['buttons'] = dict(raw_buttons)
                    self._live_state['axes'] = dict(raw_axes)
                    self._live_state['dpad'] = dict(raw_dpad)
                    self._live_state['processed_buttons'] = dict(proc_buttons)
                    self._live_state['processed_axes'] = dict(proc_axes)
                self._build_and_send(ser, proc_buttons, proc_axes, proc_dpad, debug_state)
        except Exception as e:
            self._log("[X] Error: " + str(e))
        finally:
            ser.close()
            for d in devices: d.close()


# ============================================================
# FLASK WEB SERVER
# ============================================================
config_mgr = ConfigManager()
bridge_worker = None
bridge_lock = threading.Lock()
BRIDGE_ENABLED = True

def _check_device_available():
    config = config_mgr.get()
    input_mode = config.get('input_mode', 'gamepad')
    if not evdev: return False
    
    if input_mode == 'gamepad':
        path = config.get('device_path', 'auto')
        if path == 'auto' or not path:
            for p in evdev.list_devices():
                try:
                    d = evdev.InputDevice(p)
                    caps = d.capabilities()
                    if ecodes.EV_ABS in caps and ecodes.EV_KEY in caps:
                        name_low = d.name.lower()
                        if 'touchpad' in name_low or 'motion' in name_low or 'keyboard' in name_low or 'mouse' in name_low:
                            d.close()
                            continue
                        d.close()
                        return True
                    d.close()
                except Exception:
                    pass
            return False
        else:
            return os.path.exists(path)
    elif input_mode == 'kb_mouse':
        kp = config.get('keyboard_device', '')
        mp = config.get('mouse_device', '')
        if kp and os.path.exists(kp): return True
        if mp and os.path.exists(mp): return True
        return False
    return False

def monitor_loop():
    global bridge_worker, BRIDGE_ENABLED
    while True:
        time.sleep(2)
        if not BRIDGE_ENABLED:
            continue
            
        with bridge_lock:
            if bridge_worker is None or not bridge_worker.is_running:
                if _check_device_available():
                    bridge_worker = BridgeWorker(config_mgr)
                    bridge_worker.start()

app = Flask(__name__, static_folder=WEB_DIR)


@app.route('/')
def index():
    return send_from_directory(WEB_DIR, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(WEB_DIR, path)


@app.route('/api/status')
def api_status():
    global bridge_worker
    running = bridge_worker is not None and bridge_worker.is_running
    state = bridge_worker.get_state() if running else None
    device_info = bridge_worker.get_device_info() if bridge_worker else None
    return jsonify({
        'running': running,
        'state': state,
        'device_info': device_info,
        'active_profile': config_mgr.get().get('active_profile', 'Default')
    })


@app.route('/api/config', methods=['GET'])
def api_get_config():
    return jsonify(config_mgr.get())


@app.route('/api/config', methods=['POST'])
def api_set_config():
    data = request.json
    config_mgr.update_settings(data)
    return jsonify({'ok': True})


@app.route('/api/profile', methods=['GET'])
def api_get_profile():
    name, profile = config_mgr.get_active_profile()
    return jsonify({'name': name, 'profile': profile})


@app.route('/api/profile', methods=['POST'])
def api_set_profile():
    data = request.json
    name = config_mgr.get().get('active_profile', 'Default')
    config_mgr.update_profile(name, data)
    return jsonify({'ok': True})


@app.route('/api/profiles', methods=['GET'])
def api_list_profiles():
    return jsonify({
        'profiles': config_mgr.list_profiles(),
        'active': config_mgr.get().get('active_profile', 'Default')
    })


@app.route('/api/profiles', methods=['POST'])
def api_create_profile():
    name = request.json.get('name', '')
    if name:
        config_mgr.create_profile(name)
    return jsonify({'ok': True})


@app.route('/api/profiles/<name>/activate', methods=['POST'])
def api_activate_profile(name):
    config_mgr.switch_profile(name)
    return jsonify({'ok': True})


@app.route('/api/profiles/<name>', methods=['DELETE'])
def api_delete_profile(name):
    config_mgr.delete_profile(name)
    return jsonify({'ok': True})


@app.route('/api/start', methods=['POST'])
def api_start():
    global bridge_worker, BRIDGE_ENABLED
    with bridge_lock:
        BRIDGE_ENABLED = True
        if bridge_worker and bridge_worker.is_running:
            return jsonify({'ok': False, 'error': 'Already running'})
        
        if _check_device_available():
            bridge_worker = BridgeWorker(config_mgr)
            bridge_worker.start()
            return jsonify({'ok': True})
        else:
            return jsonify({'ok': False, 'error': 'No device found'})


@app.route('/api/stop', methods=['POST'])
def api_stop():
    global bridge_worker, BRIDGE_ENABLED
    with bridge_lock:
        BRIDGE_ENABLED = False
        if bridge_worker and bridge_worker.is_running:
            bridge_worker.stop()
            bridge_worker.join(timeout=3)
    return jsonify({'ok': True})


@app.route('/api/logs')
def api_logs():
    global bridge_worker
    if bridge_worker:
        return jsonify({'logs': bridge_worker.get_logs()})
    return jsonify({'logs': []})


@app.route('/api/devices')
def api_devices():
    devices = []
    if evdev:
        try:
            for path in evdev.list_devices():
                try:
                    d = evdev.InputDevice(path)
                    devices.append({'path': path, 'name': d.name})
                    d.close()
                except Exception:
                    pass
        except Exception:
            pass
    return jsonify({'devices': devices})


def _auto_release_pin(pin, delay):
    time.sleep(delay)
    if GPIO:
        try:
            GPIO.setup(pin, GPIO.IN)
            print(f"[*] Auto-released GPIO {pin} after {delay}s")
        except Exception:
            pass

@app.route('/api/webconfig', methods=['POST'])
def api_webconfig():
    data = request.json
    action = data.get('action') # 'hold' or 'release'
    pin = data.get('pin', 18) # Default to GPIO18
    
    if GPIO:
        try:
            if action == 'hold':
                GPIO.setup(pin, GPIO.OUT)
                GPIO.output(pin, GPIO.LOW)
                # Auto release after 15 seconds to ensure it's not stuck
                t = threading.Thread(target=_auto_release_pin, args=(pin, 15), daemon=True)
                t.start()
                return jsonify({'ok': True, 'msg': f'Pin {pin} held LOW for 15s'})
            elif action == 'release':
                GPIO.setup(pin, GPIO.IN)
                return jsonify({'ok': True, 'msg': f'Pin {pin} released (INPUT)'})
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)})
    else:
        # Fallback if RPi.GPIO is not available (e.g., testing on PC)
        print(f"[!] Simulation: WebConfig GPIO {pin} -> {action}")
        return jsonify({'ok': True, 'msg': 'Simulation mode'})
    return jsonify({'ok': False, 'error': 'Invalid action'})


# ============================================================
# MAIN
# ============================================================
def main():
    global bridge_worker
    config = config_mgr.get()
    port = config.get('web_port', 8080)

    print("=" * 50)
    print("  Bridge2 — GIMX-like Controller Config")
    print("  Dashboard: http://0.0.0.0:{}".format(port))
    print("=" * 50)

    # Save default config if not exists
    if not os.path.exists(CONFIG_FILE):
        config_mgr.save()

    # Start monitor loop
    monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
    monitor_thread.start()
    print("[*] Device monitor started. Bridge will auto-start when a gamepad is connected.")

    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)


if __name__ == '__main__':
    main()
