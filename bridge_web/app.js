/* ============================================================
   Bridge2 — Dashboard Client Logic
   ============================================================ */

const BUTTON_NAMES = [
    'X', 'A', 'B', 'Y', 'LB', 'RB', 'LT_DIGITAL', 'RT_DIGITAL',
    'HOME', 'START', 'BACK', 'L3', 'R3'
];

const BUTTON_DISPLAY = {
    'X': 'X', 'A': 'A', 'B': 'B', 'Y': 'Y',
    'LB': 'LB', 'RB': 'RB',
    'LT_DIGITAL': 'LTd', 'RT_DIGITAL': 'RTd',
    'HOME': 'Home', 'START': 'Start', 'BACK': 'Back',
    'L3': 'L3', 'R3': 'R3'
};

let currentProfile = {};
let pollTimer = null;
let lastLogCount = 0;
let webConfigPingTimer = null;


/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    setupTheme();
    setupNavigation();
    buildButtonGrid();
    buildRemapGrid();
    buildTurboGrid();
    buildActivationDropdown();
    setupSliderLabels();
    setupInputModeToggle();
    loadConfig();
    loadProfile();
    loadProfiles();
    startPolling();
    drawCurve('left');
    drawCurve('right');
});


/* ============================================================
   THEMING
   ============================================================ */
function setupTheme() {
    const isDarkMode = localStorage.getItem('theme') === 'dark';
    if (isDarkMode) {
        document.documentElement.classList.add('dark-mode');
        document.getElementById('theme-icon-sun').style.display = 'block';
        document.getElementById('theme-icon-moon').style.display = 'none';
    } else {
        document.getElementById('theme-icon-sun').style.display = 'none';
        document.getElementById('theme-icon-moon').style.display = 'block';
    }

    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            if (isDark) {
                document.getElementById('theme-icon-sun').style.display = 'block';
                document.getElementById('theme-icon-moon').style.display = 'none';
            } else {
                document.getElementById('theme-icon-sun').style.display = 'none';
                document.getElementById('theme-icon-moon').style.display = 'block';
            }
            // Redraw canvases with new theme colors
            drawCurve('left');
            drawCurve('right');
            drawStick('canvas-left-stick', 0, 0);
            drawStick('canvas-right-stick', 0, 0);
        });
    }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            item.classList.add('active');
            document.getElementById('tab-' + tab).classList.add('active');
        });
    });
}


/* ============================================================
   API HELPERS
   ============================================================ */
async function api(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    try {
        const res = await fetch('/api/' + path, opts);
        return await res.json();
    } catch (e) {
        console.error('API error:', e);
        return null;
    }
}


/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 3000);
}


/* ============================================================
   POLLING
   ============================================================ */
function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollStatus, 120);
}

async function pollStatus() {
    const data = await api('status');
    if (!data) return;

    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const gamepadSub = document.getElementById('signal-gamepad');

    if (data.running) {
        dot.classList.add('running');
        text.textContent = 'Running';
        btnStart.disabled = true;
        btnStop.disabled = false;
    } else {
        dot.classList.remove('running');
        text.textContent = 'Stopped';
        btnStart.disabled = false;
        btnStop.disabled = true;
    }

    // Show gamepad device info in signal chain
    if (data.device_info && data.device_info.name) {
        gamepadSub.textContent = data.device_info.name;
        gamepadSub.title = data.device_info.path || '';
    } else {
        gamepadSub.textContent = data.running ? 'Connecting...' : 'Not connected';
    }

    document.getElementById('sidebar-active-profile').textContent = data.active_profile || 'Default';

    if (data.state) {
        updateLiveViewer(data.state);
    }

    // Fetch logs
    const logData = await api('logs');
    if (logData && logData.logs) {
        updateLogs(logData.logs);
    }
}


/* ============================================================
   LIVE INPUT VIEWER
   ============================================================ */
function buildButtonGrid() {
    const grid = document.getElementById('button-grid');
    grid.innerHTML = '';
    BUTTON_NAMES.forEach(btn => {
        const el = document.createElement('div');
        el.className = 'btn-indicator';
        el.id = 'btn-ind-' + btn;
        el.textContent = BUTTON_DISPLAY[btn] || btn;
        grid.appendChild(el);
    });
}

function updateLiveViewer(state) {
    if (!state) return;

    // Sticks
    const axes = state.processed_axes || state.axes || {};
    drawStick('canvas-left-stick', axes.lx || 0, axes.ly || 0);
    drawStick('canvas-right-stick', axes.rx || 0, axes.ry || 0);

    document.getElementById('lx-val').textContent = axes.lx || 0;
    document.getElementById('ly-val').textContent = axes.ly || 0;
    document.getElementById('rx-val').textContent = axes.rx || 0;
    document.getElementById('ry-val').textContent = axes.ry || 0;

    // Triggers
    const lt = axes.lt || 0;
    const rt = axes.rt || 0;
    document.getElementById('lt-bar').style.width = (lt / 255 * 100) + '%';
    document.getElementById('rt-bar').style.width = (rt / 255 * 100) + '%';
    document.getElementById('lt-val').textContent = lt;
    document.getElementById('rt-val').textContent = rt;

    // Buttons
    const buttons = state.processed_buttons || state.buttons || {};
    BUTTON_NAMES.forEach(btn => {
        const el = document.getElementById('btn-ind-' + btn);
        if (el) {
            if (buttons[btn]) {
                el.classList.add('pressed');
            } else {
                el.classList.remove('pressed');
            }
        }
    });

    // DPad
    const dpad = state.dpad || {};
    ['up', 'down', 'left', 'right'].forEach(dir => {
        const el = document.getElementById('dpad-' + dir);
        if (el) {
            if (dpad[dir]) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        }
    });
}

function drawStick(canvasId, x, y) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 12;

    const isDark = document.documentElement.classList.contains('dark-mode');
    const colorLineOuter = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(14, 15, 12, 0.12)';
    const colorLineInner = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(14, 15, 12, 0.08)';
    const colorLineDz = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(14, 15, 12, 0.08)';
    const colorAccent = isDark ? '#ffffff' : '#0e0f0c'; // Near black or white dot
    const colorTrail = isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(14, 15, 12, 0.4)';

    ctx.clearRect(0, 0, w, h);

    // Outer circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = colorLineOuter;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Crosshair
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = colorLineInner;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Deadzone circle (small inner)
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2);
    ctx.strokeStyle = colorLineDz;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Dot position
    const nx = (x / 32768) * r;
    const ny = (y / 32768) * r;
    const dotX = cx + nx;
    const dotY = cy + ny;

    // Trail line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(dotX, dotY);
    ctx.strokeStyle = colorTrail;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Dot glow
    const gradient = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 12);
    gradient.addColorStop(0, 'rgba(159, 232, 112, 0.5)'); // Wise Green Glow
    gradient.addColorStop(1, 'rgba(159, 232, 112, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(dotX - 12, dotY - 12, 24, 24);

    // Dot
    ctx.beginPath();
    ctx.arc(dotX, dotY, 6, 0, Math.PI * 2); // Slightly bigger dot
    ctx.fillStyle = colorAccent;
    ctx.fill();
}


/* ============================================================
   LOGS
   ============================================================ */
function updateLogs(logs) {
    const container = document.getElementById('log-container');
    if (!logs || logs.length === 0) {
        if (lastLogCount === 0) return;
        container.innerHTML = '<div class="log-empty">No packets yet. Start the bridge to see live data.</div>';
        lastLogCount = 0;
        return;
    }

    if (logs.length === lastLogCount) return;
    lastLogCount = logs.length;

    container.innerHTML = '';
    logs.forEach(log => {
        const line = document.createElement('div');
        line.className = 'log-line';
        const msg = log.msg || '';
        if (msg.startsWith('[PKT]')) {
            line.innerHTML = '<span class="log-tag">[PKT]</span>' + escapeHtml(msg.substring(5));
        } else {
            line.textContent = msg;
        }
        container.appendChild(line);
    });
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


/* ============================================================
   BRIDGE CONTROL
   ============================================================ */
async function bridgeStart() {
    toast('Starting bridge...', 'info');
    const res = await api('start', 'POST');
    if (res && res.ok) {
        toast('Bridge started!', 'success');
    } else {
        toast(res && res.error ? res.error : 'Failed to start', 'error');
    }
}

async function bridgeStop() {
    toast('Stopping bridge...', 'info');
    const res = await api('stop', 'POST');
    if (res && res.ok) {
        toast('Bridge stopped.', 'info');
    }
}

/* ============================================================
   WEB CONFIG FLOW
   ============================================================ */
async function enterWebConfig() {
    // 1. Call API to hold pin (GPIO 18 LOW)
    // Backend will auto-release it after 15 seconds.
    const res = await api('webconfig', 'POST', { action: 'hold', pin: 18 });
    if (!res || !res.ok) {
        toast('Failed to configure GPIO', 'error');
        return;
    }

    // 2. Show loading UI
    document.getElementById('webconfig-intro').style.display = 'none';
    document.getElementById('webconfig-loading').style.display = 'block';

    // 3. Start pinging 192.168.7.1
    // We use an EXACT Image check instead of fetch.
    // If there is an IP conflict (e.g. WSL or Router) responding to 192.168.7.1,
    // they usually return 404 HTML for /favicon.ico, which triggers onerror.
    // Only the real GP2040-CE will return a valid image and trigger onload!
    if (webConfigPingTimer) clearInterval(webConfigPingTimer);
    
    webConfigPingTimer = setInterval(() => {
        const img = new Image();
        
        img.onload = () => {
            // Valid image loaded! GP2040-CE is officially UP.
            clearInterval(webConfigPingTimer);
            toast('Connection successful!', 'success');
            
            // Open new tab automatically!
            window.open('http://192.168.7.1', '_blank');
            
            // Reset UI
            document.getElementById('webconfig-intro').style.display = 'block';
            document.getElementById('webconfig-loading').style.display = 'none';
        };
        
        img.onerror = () => {
            // Server down, or false positive server returning HTML on 404
            // Just wait for the next tick
        };
        
        // Timeout image load internally if network drops
        setTimeout(() => { img.src = ''; }, 800);
        
        // Append timestamp to avoid caching
        img.src = 'http://192.168.7.1/favicon.ico?v=' + Date.now();
    }, 1000);
}

async function cancelWebConfig() {
    if (webConfigPingTimer) clearInterval(webConfigPingTimer);
    
    // Explicitly release the pin if user cancels early
    await api('webconfig', 'POST', { action: 'release', pin: 18 });
    
    // Reset UI
    document.getElementById('webconfig-intro').style.display = 'block';
    document.getElementById('webconfig-loading').style.display = 'none';
    toast('Cancelled', 'info');
}



/* ============================================================
   CONFIG (SETTINGS TAB)
   ============================================================ */
async function loadConfig() {
    const data = await api('config');
    if (!data) return;
    document.getElementById('cfg-serial').value = data.serial_port || '/dev/ttyAMA0';
    document.getElementById('cfg-baud').value = data.baud_rate || 500000;
    document.getElementById('cfg-device').value = data.device_path || 'auto';
    document.getElementById('cfg-keyboard').value = data.keyboard_device || '';
    document.getElementById('cfg-mouse').value = data.mouse_device || '';
    document.getElementById('cfg-input-mode').value = data.input_mode || 'gamepad';
    document.getElementById('cfg-debug-interval').value = data.debug_interval || 0.5;
    updateInputModeUI();
}

function updateInputModeUI() {
    const mode = document.getElementById('cfg-input-mode').value;
    const gamepadRow = document.getElementById('row-cfg-device');
    const kbRow = document.getElementById('row-cfg-kb');
    const mouseRow = document.getElementById('row-cfg-mouse');
    if (mode === 'kb_mouse') {
        gamepadRow.style.display = 'none';
        kbRow.style.display = 'flex';
        mouseRow.style.display = 'flex';
    } else {
        gamepadRow.style.display = 'flex';
        kbRow.style.display = 'none';
        mouseRow.style.display = 'none';
    }
}

function setupInputModeToggle() {
    const el = document.getElementById('cfg-input-mode');
    if (el) el.addEventListener('change', updateInputModeUI);
}

async function saveSettings() {
    const data = {
        serial_port: document.getElementById('cfg-serial').value,
        baud_rate: parseInt(document.getElementById('cfg-baud').value) || 500000,
        device_path: document.getElementById('cfg-device').value,
        keyboard_device: document.getElementById('cfg-keyboard').value,
        mouse_device: document.getElementById('cfg-mouse').value,
        input_mode: document.getElementById('cfg-input-mode').value,
        debug_interval: parseFloat(document.getElementById('cfg-debug-interval').value) || 0.5
    };
    const res = await api('config', 'POST', data);
    if (res && res.ok) {
        toast('Settings saved!', 'success');
    } else {
        toast('Failed to save settings', 'error');
    }
}

async function detectDevices(type) {
    const res = await api('devices');
    const containerId = type === 'gamepad' ? 'detected-devices-gamepad' : type === 'keyboard' ? 'detected-devices-keyboard' : 'detected-devices-mouse';
    const inputId = type === 'gamepad' ? 'cfg-device' : type === 'keyboard' ? 'cfg-keyboard' : 'cfg-mouse';

    const container = document.getElementById(containerId);
    if (!res || !res.devices || res.devices.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">No devices found (Linux only)</div>';
        container.style.display = 'flex';
        return;
    }
    container.innerHTML = '';
    res.devices.forEach(dev => {
        const el = document.createElement('div');
        el.className = 'device-option';
        el.innerHTML = '<span class="dev-path">' + escapeHtml(dev.path) + '</span><span class="dev-name">' + escapeHtml(dev.name) + '</span>';
        el.addEventListener('click', () => {
            document.getElementById(inputId).value = dev.path;
            container.style.display = 'none';
            toast('Selected: ' + dev.name, 'info');
        });
        container.appendChild(el);
    });
    container.style.display = 'flex';
}


/* ============================================================
   PROFILE MANAGEMENT
   ============================================================ */
async function loadProfile() {
    const data = await api('profile');
    if (!data || !data.profile) return;
    currentProfile = data.profile;
    applyProfileToUI(currentProfile);
}

function applyProfileToUI(profile) {
    // Remap
    const remap = profile.button_remap || {};
    BUTTON_NAMES.forEach(btn => {
        const sel = document.getElementById('remap-' + btn);
        if (sel) sel.value = remap[btn] || btn;
    });

    // Anti-Recoil
    const ar = profile.anti_recoil || {};
    document.getElementById('ar-enabled').checked = ar.enabled || false;
    document.getElementById('ar-strength').value = ar.strength || 30;
    document.getElementById('ar-strength-val').textContent = ar.strength || 30;
    document.getElementById('ar-activation').value = ar.activation_button || 'RT_DIGITAL';
    document.getElementById('ar-axis').value = ar.axis || 'ry';

    // Turbo
    const turbo = profile.turbo || {};
    const turboButtons = turbo.buttons || {};
    document.getElementById('turbo-speed').value = turbo.speed_hz || 15;
    document.getElementById('turbo-speed-val').textContent = (turbo.speed_hz || 15) + ' Hz';
    BUTTON_NAMES.forEach(btn => {
        const cb = document.getElementById('turbo-' + btn);
        if (cb) cb.checked = turboButtons[btn] || false;
    });

    // Deadzone
    const dz = profile.deadzone || {};
    document.getElementById('dz-left').value = dz.left_stick || 5;
    document.getElementById('dz-left-val').textContent = (dz.left_stick || 5) + '%';
    document.getElementById('dz-right').value = dz.right_stick || 5;
    document.getElementById('dz-right-val').textContent = (dz.right_stick || 5) + '%';

    // Sensitivity
    const sens = profile.sensitivity || {};
    const leftSens = sens.left_stick || { curve: 'linear', multiplier: 1.0 };
    const rightSens = sens.right_stick || { curve: 'linear', multiplier: 1.0 };

    document.getElementById('curve-left').value = leftSens.curve || 'linear';
    document.getElementById('mult-left').value = Math.round((leftSens.multiplier || 1.0) * 10);
    document.getElementById('mult-left-val').textContent = (leftSens.multiplier || 1.0).toFixed(1) + 'x';

    document.getElementById('curve-right').value = rightSens.curve || 'linear';
    document.getElementById('mult-right').value = Math.round((rightSens.multiplier || 1.0) * 10);
    document.getElementById('mult-right-val').textContent = (rightSens.multiplier || 1.0).toFixed(1) + 'x';

    // KB & Mouse
    const mSens = profile.mouse_sensitivity || 50;
    document.getElementById('mouse-sens').value = mSens;
    document.getElementById('mouse-sens-val').textContent = mSens;
    document.getElementById('mouse-invert').checked = profile.mouse_y_invert || false;
    
    // Bindings Builder
    const kBindings = profile.key_bindings || {};
    const mBindings = profile.mouse_bindings || {};
    buildKbmBindings(kBindings, mBindings);

    drawCurve('left');
    drawCurve('right');
}

function gatherProfileFromUI() {
    // Remap
    const remap = {};
    BUTTON_NAMES.forEach(btn => {
        const sel = document.getElementById('remap-' + btn);
        if (sel && sel.value !== btn) {
            remap[btn] = sel.value;
        }
    });

    // Anti-Recoil
    const anti_recoil = {
        enabled: document.getElementById('ar-enabled').checked,
        strength: parseInt(document.getElementById('ar-strength').value) || 30,
        activation_button: document.getElementById('ar-activation').value,
        axis: document.getElementById('ar-axis').value
    };

    // Turbo
    const turboButtons = {};
    BUTTON_NAMES.forEach(btn => {
        const cb = document.getElementById('turbo-' + btn);
        if (cb && cb.checked) {
            turboButtons[btn] = true;
        }
    });
    const turbo = {
        buttons: turboButtons,
        speed_hz: parseInt(document.getElementById('turbo-speed').value) || 15
    };

    // Deadzone
    const deadzone = {
        left_stick: parseInt(document.getElementById('dz-left').value) || 5,
        right_stick: parseInt(document.getElementById('dz-right').value) || 5
    };

    // Sensitivity
    const sensitivity = {
        left_stick: {
            curve: document.getElementById('curve-left').value,
            multiplier: parseInt(document.getElementById('mult-left').value) / 10
        },
        right_stick: {
            curve: document.getElementById('curve-right').value,
            multiplier: parseInt(document.getElementById('mult-right').value) / 10
        }
    };

    // KB & Mouse
    const key_bindings = {};
    const mouse_bindings = {};
    document.querySelectorAll('.kbm-row').forEach(row => {
        const src = row.querySelector('.kbm-src').value.trim();
        const tgt = row.querySelector('.kbm-tgt').value;
        if (src && tgt) {
            if (src.startsWith('BTN_')) {
                mouse_bindings[src] = tgt;
            } else {
                key_bindings[src] = tgt;
            }
        }
    });

    return { 
        button_remap: remap, 
        anti_recoil, 
        turbo, 
        deadzone, 
        sensitivity,
        key_bindings,
        mouse_bindings,
        mouse_sensitivity: parseInt(document.getElementById('mouse-sens').value) || 50,
        mouse_y_invert: document.getElementById('mouse-invert').checked
    };
}

async function saveProfile() {
    const profile = gatherProfileFromUI();
    const res = await api('profile', 'POST', profile);
    if (res && res.ok) {
        toast('Profile saved!', 'success');
        currentProfile = profile;
    } else {
        toast('Failed to save profile', 'error');
    }
}

async function loadProfiles() {
    const data = await api('profiles');
    if (!data) return;
    const container = document.getElementById('profile-list');
    container.innerHTML = '';

    (data.profiles || []).forEach(name => {
        const isActive = name === data.active;
        const el = document.createElement('div');
        el.className = 'profile-item' + (isActive ? ' active-profile' : '');
        el.innerHTML = `
            <div class="profile-name">
                ${escapeHtml(name)}
                ${isActive ? '<span class="profile-active-tag">Active</span>' : ''}
            </div>
            <div class="profile-actions">
                ${!isActive ? '<button class="btn btn-secondary btn-sm" onclick="activateProfile(\'' + escapeHtml(name) + '\')">Activate</button>' : ''}
                ${(data.profiles || []).length > 1 ? '<button class="btn btn-danger btn-sm" onclick="deleteProfile(\'' + escapeHtml(name) + '\')">Delete</button>' : ''}
            </div>
        `;
        container.appendChild(el);
    });
}

async function createProfile() {
    const input = document.getElementById('new-profile-name');
    const name = input.value.trim();
    if (!name) {
        toast('Enter a profile name', 'error');
        return;
    }
    const res = await api('profiles', 'POST', { name });
    if (res && res.ok) {
        toast('Profile created: ' + name, 'success');
        input.value = '';
        loadProfiles();
    }
}

async function activateProfile(name) {
    const res = await api('profiles/' + encodeURIComponent(name) + '/activate', 'POST');
    if (res && res.ok) {
        toast('Switched to: ' + name, 'success');
        loadProfiles();
        loadProfile();
    }
}

async function deleteProfile(name) {
    if (!confirm('Delete profile "' + name + '"?')) return;
    const res = await api('profiles/' + encodeURIComponent(name), 'DELETE');
    if (res && res.ok) {
        toast('Deleted: ' + name, 'info');
        loadProfiles();
        loadProfile();
    }
}


/* ============================================================
   REMAP GRID
   ============================================================ */
function buildRemapGrid() {
    const grid = document.getElementById('remap-grid');
    grid.innerHTML = '';
    BUTTON_NAMES.forEach(btn => {
        const row = document.createElement('div');
        row.className = 'remap-row';

        const source = document.createElement('span');
        source.className = 'remap-source';
        source.textContent = BUTTON_DISPLAY[btn] || btn;

        const arrow = document.createElement('span');
        arrow.className = 'remap-arrow';
        arrow.textContent = '→';

        const select = document.createElement('select');
        select.className = 'select-input';
        select.id = 'remap-' + btn;

        BUTTON_NAMES.forEach(target => {
            const opt = document.createElement('option');
            opt.value = target;
            opt.textContent = (target === btn ? '— Same —' : BUTTON_DISPLAY[target] || target);
            if (target === btn) opt.selected = true;
            select.appendChild(opt);
        });

        row.appendChild(source);
        row.appendChild(arrow);
        row.appendChild(select);
        grid.appendChild(row);
    });
}

function resetRemap() {
    BUTTON_NAMES.forEach(btn => {
        const sel = document.getElementById('remap-' + btn);
        if (sel) sel.value = btn;
    });
    toast('Remap reset to default', 'info');
}


/* ============================================================
   TURBO GRID
   ============================================================ */
function buildTurboGrid() {
    const grid = document.getElementById('turbo-grid');
    grid.innerHTML = '';
    BUTTON_NAMES.forEach(btn => {
        const item = document.createElement('div');
        item.className = 'turbo-item';

        const label = document.createElement('span');
        label.textContent = BUTTON_DISPLAY[btn] || btn;

        const toggle = document.createElement('label');
        toggle.className = 'toggle-switch';
        toggle.innerHTML = '<input type="checkbox" id="turbo-' + btn + '"><span class="toggle-slider"></span>';

        item.appendChild(label);
        item.appendChild(toggle);
        grid.appendChild(item);
    });
}


/* ============================================================
   ACTIVATION BUTTON DROPDOWN
   ============================================================ */
function buildActivationDropdown() {
    const sel = document.getElementById('ar-activation');
    sel.innerHTML = '';
    BUTTON_NAMES.forEach(btn => {
        const opt = document.createElement('option');
        opt.value = btn;
        opt.textContent = BUTTON_DISPLAY[btn] || btn;
        sel.appendChild(opt);
    });
    sel.value = 'RT_DIGITAL';
}


/* ============================================================
   SLIDER LABELS
   ============================================================ */
function setupSliderLabels() {
    // Anti-Recoil strength
    const arSlider = document.getElementById('ar-strength');
    arSlider.addEventListener('input', () => {
        document.getElementById('ar-strength-val').textContent = arSlider.value;
    });

    // Turbo speed
    const turboSlider = document.getElementById('turbo-speed');
    turboSlider.addEventListener('input', () => {
        document.getElementById('turbo-speed-val').textContent = turboSlider.value + ' Hz';
    });

    // Deadzone left
    const dzLeft = document.getElementById('dz-left');
    dzLeft.addEventListener('input', () => {
        document.getElementById('dz-left-val').textContent = dzLeft.value + '%';
    });

    // Deadzone right
    const dzRight = document.getElementById('dz-right');
    dzRight.addEventListener('input', () => {
        document.getElementById('dz-right-val').textContent = dzRight.value + '%';
    });

    // Multiplier left
    const multLeft = document.getElementById('mult-left');
    multLeft.addEventListener('input', () => {
        document.getElementById('mult-left-val').textContent = (parseInt(multLeft.value) / 10).toFixed(1) + 'x';
        drawCurve('left');
    });

    // Multiplier right
    const multRight = document.getElementById('mult-right');
    multRight.addEventListener('input', () => {
        document.getElementById('mult-right-val').textContent = (parseInt(multRight.value) / 10).toFixed(1) + 'x';
        drawCurve('right');
    });

    // Mouse Sensitivity
    const mouseSens = document.getElementById('mouse-sens');
    if (mouseSens) {
        mouseSens.addEventListener('input', () => {
            document.getElementById('mouse-sens-val').textContent = mouseSens.value;
        });
    }

    // Curve selectors
    document.getElementById('curve-left').addEventListener('change', () => drawCurve('left'));
    document.getElementById('curve-right').addEventListener('change', () => drawCurve('right'));
}


/* ============================================================
   SENSITIVITY CURVE CANVAS
   ============================================================ */
function drawCurve(side) {
    const canvas = document.getElementById('curve-canvas-' + side);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const pad = 30;
    const gw = w - pad * 2;
    const gh = h - pad * 2;

    const curveType = document.getElementById('curve-' + side).value;
    const mult = parseInt(document.getElementById('mult-' + side).value) / 10;

    const isDark = document.documentElement.classList.contains('dark-mode');
    const colorGrid = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(14, 15, 12, 0.08)';
    const colorText = isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(14, 15, 12, 0.5)';
    const colorRef = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(14, 15, 12, 0.2)';
    const colorLine = isDark ? '#ffffff' : '#0e0f0c'; // Draw the curve in white or near-black
    const colorGlow = 'rgba(159, 232, 112, 0.4)'; // Wise Green Glow over the line

    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = colorGrid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const x = pad + (gw / 4) * i;
        const y = pad + (gh / 4) * i;
        ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, pad + gh); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + gw, y); ctx.stroke();
    }

    // Axes labels
    ctx.fillStyle = colorText;
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Input', pad + gw / 2, h - 4);
    ctx.save();
    ctx.translate(10, pad + gh / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Output', 0, 0);
    ctx.restore();

    // Linear reference (dotted)
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.moveTo(pad, pad + gh);
    ctx.lineTo(pad + gw, pad);
    ctx.strokeStyle = colorRef;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // Curve
    ctx.beginPath();
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
        const norm = i / steps;
        let output;
        if (curveType === 'exponential') {
            output = Math.pow(norm, 2.0);
        } else if (curveType === 's_curve') {
            output = Math.pow(norm, 3.0) * 0.5 + norm * 0.5;
        } else {
            output = norm;
        }
        output = Math.min(output * mult, 1.0);

        const px = pad + norm * gw;
        const py = pad + gh - output * gh;

        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = colorLine;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Glow effect
    ctx.shadowColor = colorGlow;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
}


/* ============================================================
   KB & MOUSE BINDINGS GRID
   ============================================================ */
const TARGET_OPTS = [
    {v:'btn:A', l:'Button A'}, {v:'btn:B', l:'Button B'}, {v:'btn:X', l:'Button X'}, {v:'btn:Y', l:'Button Y'},
    {v:'btn:LB', l:'Left Bumper'}, {v:'btn:RB', l:'Right Bumper'}, {v:'btn:LT_DIGITAL', l:'Left Trigger'}, {v:'btn:RT_DIGITAL', l:'Right Trigger'},
    {v:'btn:BACK', l:'Back'}, {v:'btn:START', l:'Start'}, {v:'btn:HOME', l:'Home'},
    {v:'btn:L3', l:'L3 (LS Click)'}, {v:'btn:R3', l:'R3 (RS Click)'},
    {v:'axis:ly:-32768', l:'L-Stick UP'}, {v:'axis:ly:32767', l:'L-Stick DOWN'}, {v:'axis:lx:-32768', l:'L-Stick LEFT'}, {v:'axis:lx:32767', l:'L-Stick RIGHT'},
    {v:'axis:ry:-32768', l:'R-Stick UP'}, {v:'axis:ry:32767', l:'R-Stick DOWN'}, {v:'axis:rx:-32768', l:'R-Stick LEFT'}, {v:'axis:rx:32767', l:'R-Stick RIGHT'},
    {v:'dpad:up', l:'DPad UP'}, {v:'dpad:down', l:'DPad DOWN'}, {v:'dpad:left', l:'DPad LEFT'}, {v:'dpad:right', l:'DPad RIGHT'}
];

function buildKbmBindings(keyMap, mouseMap) {
    const container = document.getElementById('kbm-bindings-container');
    if (!container) return;
    container.innerHTML = '';
    
    Object.keys(keyMap).forEach(k => addBindingRow(k, keyMap[k]));
    Object.keys(mouseMap).forEach(k => addBindingRow(k, mouseMap[k]));
}

function addBindingRow(src = '', tgt = 'btn:A') {
    const container = document.getElementById('kbm-bindings-container');
    const row = document.createElement('div');
    row.className = 'remap-row kbm-row';
    
    const srcInput = document.createElement('input');
    srcInput.type = 'text';
    srcInput.className = 'text-input kbm-src';
    srcInput.placeholder = 'e.g. KEY_W or BTN_LEFT';
    srcInput.value = src;
    srcInput.style.flex = '1';
    
    const arrow = document.createElement('span');
    arrow.className = 'remap-arrow';
    arrow.textContent = '→';

    const sel = document.createElement('select');
    sel.className = 'select-input kbm-tgt';
    sel.style.flex = '1';
    TARGET_OPTS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.l;
        if (opt.v === tgt) o.selected = true;
        sel.appendChild(o);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Del';
    delBtn.onclick = () => row.remove();

    row.appendChild(srcInput);
    row.appendChild(arrow);
    row.appendChild(sel);
    row.appendChild(delBtn);
    container.appendChild(row);
}


/* ============================================================
   UTILITY
   ============================================================ */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
