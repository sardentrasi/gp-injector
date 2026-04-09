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
    buildRemapGrid();
    buildTurboGrid();
    buildActivationDropdown();
    setupSliderLabels();
    loadConfig();
    loadProfile();
    loadProfiles();
    applyTabSpecifics();
    startPolling();
    drawCurve('left');
    drawCurve('right');
    
    // Virtual Gamepad Init
    window.virtualGamepad = new VirtualGamepad();
});

function applyTabSpecifics() {
    const warning = document.getElementById('vg-mode-warning');
    if (warning) {
        warning.style.display = 'none'; 
    }
}


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
            // Redraw curves with new theme colors
            drawCurve('left');
            drawCurve('right');
        });
    }
}

let currentActiveTab = 'dashboard';
let liveSocket = null;
let currentStreamSlot = '1';
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
            
            currentActiveTab = tab;
            manageLiveStream();
        });
    });
}


/* ============================================================
   API HELPERS
   ============================================================ */
async function api(path, method = 'GET', body = null) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), (path === 'inject' ? 1000 : 2000));
    
    const opts = { 
        method, 
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' } 
    };
    if (body) opts.body = JSON.stringify(body);
    
    try {
        const res = await fetch('/api/' + path, opts);
        clearTimeout(id);
        return await res.json();
    } catch (e) {
        clearTimeout(id);
        if (e.name !== 'AbortError') {
            console.error('API error:', e);
        }
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
   POLLING & LIVE MAP
   ============================================================ */
let isBridgeRunning = false;
let liveEventSource = null;

function startPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    
    const runPoll = async () => {
        // Hibernation: Slow down system polling to once every 2s when in Virtual Gamepad mode
        const interval = (currentActiveTab === 'virtual') ? 2000 : 250;
        
        await pollStatus();
        pollTimer = setTimeout(runPoll, interval);
    };
    
    runPoll();
}

async function pollStatus() {
    const viewSlot = document.getElementById('live-slot-selector')?.value || '1';
    const data = await api(`status?slot=${viewSlot}`);
    if (!data) return;

    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const gamepadSub = document.getElementById('signal-gamepad-sub');
    const gamepadIcon = document.getElementById('signal-gamepad-icon');
    const gamepadLabel = document.getElementById('signal-gamepad-label');

    if (data.running) {
        if (!isBridgeRunning) {
            isBridgeRunning = true;
            manageLiveStream();
        }
        dot.classList.add('running');
        text.textContent = 'Running';
        btnStart.disabled = true;
        btnStop.disabled = false;
    } else {
        if (isBridgeRunning) {
            isBridgeRunning = false;
            manageLiveStream();
        }
        dot.classList.remove('running');
        text.textContent = 'Stopped';
        btnStart.disabled = false;
        btnStop.disabled = true;
    }

    // Show gamepad device info in signal chain
    let activeSlotCount = 0;
    if (data.multi_slots) {
        data.multi_slots.forEach(s => { if (s && s.enabled) activeSlotCount++; });
    }

    // Show gamepad device info in signal chain
    if (activeSlotCount >= 2) {
        gamepadIcon.textContent = '🎮'.repeat(activeSlotCount);
        gamepadLabel.textContent = `${activeSlotCount} Gamepads`;
        gamepadSub.textContent = data.running ? 'Multi-Slot Active' : 'Ready';
        gamepadSub.title = '';
    } else {
        let activeSlotCfg = data.multi_slots ? data.multi_slots.find(s => s && s.enabled) : null;
        let mode = activeSlotCfg ? activeSlotCfg.input_mode : 'gamepad';
        
        if (mode === 'virtual_gamepad') {
            gamepadIcon.textContent = '📱';
            gamepadLabel.textContent = 'Virtual Pad';
            gamepadSub.textContent = data.running ? 'Connected' : 'Ready';
            gamepadSub.title = 'Web-based input active';
        } else if (mode === 'kb_mouse') {
            gamepadIcon.textContent = '⌨️';
            gamepadLabel.textContent = 'KB & Mouse';
            gamepadSub.textContent = data.running ? 'Active' : 'Ready';
        } else {
            gamepadIcon.textContent = '🎮';
            gamepadLabel.textContent = 'Gamepad';
            if (data.device_info && data.device_info.name) {
                gamepadSub.textContent = data.device_info.name;
                gamepadSub.title = data.device_info.path || '';
            } else {
                gamepadSub.textContent = data.running ? 'Connecting...' : 'Not connected';
            }
        }
    }

    document.getElementById('sidebar-active-profile').textContent = data.active_profile || 'Default';

    // Update Status Cards
    const container = document.getElementById('multi-status-container');
    if (container && data.multi_slots) {
        let html = '';
        for (let i = 0; i < 4; i++) {
            const slotId = i + 1;
            const slotCfg = data.multi_slots[i];
            if (!slotCfg || !slotCfg.enabled) continue;
            
            const w = data.workers && data.workers[slotId] ? data.workers[slotId] : null;
            const isRunning = w && w.running;
            
            let icon = '🎮';
            let label = 'Gamepad';
            let subtext = 'Not connected';
            if (slotCfg.input_mode === 'virtual_gamepad') {
                icon = '📱';
                label = 'Virtual Pad';
                subtext = isRunning ? 'Connected' : 'Ready';
            } else if (slotCfg.input_mode === 'kb_mouse') {
                icon = '⌨️';
                label = 'KB & Mouse';
                subtext = isRunning ? 'Active' : 'Ready';
            } else {
                if (w && w.device_info && w.device_info.name) {
                    subtext = w.device_info.name;
                } else {
                    subtext = isRunning ? 'Connecting...' : 'Not connected';
                }
            }
            
            const borderColor = isRunning ? 'var(--success-color)' : 'var(--danger-color)';
            const badgeColor = isRunning ? 'var(--success-color)' : 'var(--danger-color)';
            html += `
                <div class="card" style="flex: 1 1 200px; padding: 15px; border-top: 4px solid ${borderColor};">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                        <h3 style="margin:0;">Slot ${slotId}</h3>
                        <span style="font-size:12px; padding:3px 8px; border-radius:12px; background-color:${badgeColor}20; color:${badgeColor}; font-weight:bold;">
                            ${isRunning ? 'Running' : 'Stopped'}
                        </span>
                    </div>
                    <div style="font-size:13px; margin-bottom: 10px; color:var(--text-muted); display:flex; align-items:center; gap:5px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                        ${slotCfg.serial_port}
                    </div>
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <span style="font-size:28px;">${icon}</span>
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:14px; text-transform:capitalize;">${label}</span>
                            <span style="font-size:12px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px;" title="${subtext}">${subtext}</span>
                        </div>
                    </div>
                </div>
            `;
        }
        if (html === '') {
            html = '<div style="color:var(--text-muted); padding:10px;">No slots are enabled. Settings > Enable a slot.</div>';
        }
        container.innerHTML = html;
    }

    // Update Live Viewer
    if (data.state && (currentActiveTab === 'dashboard' || currentActiveTab === 'sticks')) {
        updateLiveViewer(data.state);
    }

    // Only fetch/update logs if we are on the dashboard
    if (currentActiveTab === 'dashboard') {
        const viewSlot = document.getElementById('live-slot-selector')?.value || '1';
        const logData = await api(`logs?slot=${viewSlot}`);
        if (logData && logData.logs) {
            updateLogs(logData.logs);
        }
    }
}

function manageLiveStream() {
    if (liveSocket) {
        liveSocket.close();
        liveSocket = null;
    }
    
    if (isBridgeRunning && (currentActiveTab === 'dashboard' || currentActiveTab === 'sticks')) {
        const viewSlot = document.getElementById('live-slot-selector')?.value || '1';
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/state?slot=${viewSlot}`;
        
        console.log("[*] Opening telemetry WebSocket for slot " + viewSlot);
        liveSocket = new WebSocket(wsUrl);
        liveSocket.onmessage = (e) => {
            try {
                const state = JSON.parse(e.data);
                if (state.stopped) {
                    if (liveSocket) { liveSocket.close(); liveSocket = null; }
                    return;
                }
                updateLiveViewer(state);
            } catch (err) {}
        };
        liveSocket.onerror = () => {
            if (liveSocket) { liveSocket.close(); liveSocket = null; }
        };
    }
}

function changeLiveSlot() {
    // If bridge is running, manageLiveStream will restart EventSource with the new slot query.
    manageLiveStream();
    pollStatus();
}

function changeVgSlot() {
    // Just force a sync logic update in the class (it reads from UI each tick).
}


/* ============================================================
   LIVE INPUT VIEWER
   ============================================================ */

function updateLiveViewer(state) {
    if (!state) return;

    // Sticks
    const axes = state.processed_axes || state.axes || {};
    const rad = 35; // 35px visual bounded radius
    const mapAxis = (val) => (val / 32768.0) * rad;

    const stickL = document.getElementById('lv-stick-l-dot');
    if (stickL) stickL.style.transform = `translate(${mapAxis(axes.lx || 0)}px, ${mapAxis(axes.ly || 0)}px)`;

    const stickR = document.getElementById('lv-stick-r-dot');
    if (stickR) stickR.style.transform = `translate(${mapAxis(axes.rx || 0)}px, ${mapAxis(axes.ry || 0)}px)`;

    // Buttons
    const buttons = state.processed_buttons || state.buttons || {};
    for (const [btnName, isPressed] of Object.entries(buttons)) {
        const el = document.getElementById('lv-btn-' + btnName);
        if (el) {
            if (isPressed) el.classList.add('active');
            else el.classList.remove('active');
        }
    }

    // DPad
    const dpad = state.dpad || {};
    ['up', 'down', 'left', 'right'].forEach(dir => {
        const el = document.getElementById('lv-dpad-' + dir);
        if (el) {
            if (dpad[dir]) el.classList.add('active');
            else el.classList.remove('active');
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
    document.getElementById('cfg-baud').value = data.baud_rate || 500000;
    document.getElementById('cfg-debug-interval').value = data.debug_interval || 0.5;
    
    // Inject parsed profile list into multi cards builder
    const profileNames = Object.keys(data.profiles || {});
    buildMultiCards(data.multi_slots || [], profileNames);
}

function buildMultiCards(slotsData, profileList) {
    const container = document.getElementById('settings-slots-box');
    if (!container) return;
    
    let html = '<h2 class="card-title" style="margin-bottom: 15px;">Slot Configuration</h2>';
    html += '<div style="display: flex; flex-wrap: wrap; gap: 15px;">';
    
    for (let i = 0; i < 4; i++) {
        const slot = slotsData[i] || {};
        const enabled = slot.enabled || false;
        const assignedProfile = slot.profile || 'Default';
        const inputMode = slot.input_mode || 'gamepad';
        const serialPort = slot.serial_port || `/dev/ttyS${i+1}`;
        const devicePath = slot.device_path || 'auto';
        
        let profileOptions = '';
        if (profileList && profileList.length > 0) {
            profileList.forEach(pName => {
                profileOptions += `<option value="${pName}" ${assignedProfile === pName ? 'selected' : ''}>${escapeHtml(pName)}</option>`;
            });
        } else {
            profileOptions = `<option value="Default">Default</option>`;
        }

        html += `
            <div class="card" style="box-sizing: border-box; flex: 1 1 calc(50% - 15px); min-width: 320px; margin-bottom: 0; padding: 15px; border-left: 4px solid var(--primary-color);">
                <div class="setting-row" style="padding-top:0;">
                    <h3 style="margin:0;">Slot ${i+1}</h3>
                    <label class="toggle-switch">
                        <input type="checkbox" class="slot-enable-toggle" id="cfg-m-enabled-${i}" ${enabled ? 'checked' : ''} onchange="enforceAtLeastOneSlot(this)">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                

                <div class="setting-row" style="padding: 8px 0;">
                    <div class="setting-label">
                        <h4 style="margin:0; font-size: 13px;">Input Mode</h4>
                    </div>
                    <select id="cfg-m-input-${i}" class="select-input" style="font-size: 13px; padding: 4px 8px; box-sizing: border-box; width: 170px;" onchange="updateMultiInputModeUI(${i})">
                        <option value="gamepad" ${inputMode === 'gamepad' ? 'selected' : ''}>Gamepad</option>
                        <option value="kb_mouse" ${inputMode === 'kb_mouse' ? 'selected' : ''}>Keyboard & Mouse</option>
                        <option value="virtual_gamepad" ${inputMode === 'virtual_gamepad' ? 'selected' : ''}>Virtual Gamepad</option>
                    </select>
                </div>
                
                <div class="setting-row" id="row-cfg-m-device-${i}" style="padding: 8px 0;">
                    <div class="setting-label">
                        <h4 style="margin:0; font-size: 13px;">Gamepad Device</h4>
                    </div>
                    <div class="device-select-group">
                        <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 12px;" onclick="detectDevices('gamepad', ${i})">Detect</button>
                        <input type="text" id="cfg-m-device-${i}" class="text-input" style="font-size: 13px; padding: 4px 8px; box-sizing: border-box; width: 170px; flex: 0 0 170px;" value="${devicePath}">
                    </div>
                </div>
                <div id="detected-devices-gamepad-${i}" class="detected-devices" style="display:none; font-size:12px;"></div>
                
                <div class="setting-row kbmouse-only-setting" id="row-cfg-m-kb-${i}" style="display:none; padding: 8px 0;">
                    <div class="setting-label">
                        <h4 style="margin:0; font-size: 13px;">Keyboard</h4>
                    </div>
                    <div class="device-select-group">
                        <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 12px;" onclick="detectDevices('keyboard', ${i})">Detect</button>
                        <input type="text" id="cfg-m-kb-${i}" class="text-input" style="font-size: 13px; padding: 4px 8px; box-sizing: border-box; width: 170px; flex: 0 0 170px;" value="${slot.keyboard_device || ''}" placeholder="/dev/input/eventX">
                    </div>
                </div>
                <div id="detected-devices-keyboard-${i}" class="detected-devices" style="display:none; font-size:12px;"></div>

                <div class="setting-row kbmouse-only-setting" id="row-cfg-m-mouse-${i}" style="display:none; padding: 8px 0;">
                    <div class="setting-label">
                        <h4 style="margin:0; font-size: 13px;">Mouse</h4>
                    </div>
                    <div class="device-select-group">
                        <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 12px;" onclick="detectDevices('mouse', ${i})">Detect</button>
                        <input type="text" id="cfg-m-mouse-${i}" class="text-input" style="font-size: 13px; padding: 4px 8px; box-sizing: border-box; width: 170px; flex: 0 0 170px;" value="${slot.mouse_device || ''}" placeholder="/dev/input/eventY">
                    </div>
                </div>
                <div id="detected-devices-mouse-${i}" class="detected-devices" style="display:none; font-size:12px;"></div>

                <div class="setting-row" style="padding: 8px 0;">
                    <div class="setting-label">
                        <h4 style="margin:0; font-size: 13px;">Serial Port</h4>
                    </div>
                    <div class="device-select-group">
                        <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 12px;" onclick="detectDevices('serial', ${i})">Detect</button>
                        <input type="text" id="cfg-m-serial-${i}" class="text-input" style="font-size: 13px; padding: 4px 8px; box-sizing: border-box; width: 170px; flex: 0 0 170px;" value="${serialPort}">
                    </div>
                </div>
                <div id="detected-devices-serial-${i}" class="detected-devices" style="display:none; font-size:12px;"></div>

                <div class="setting-row" style="padding: 8px 0; border-bottom: none;">
                    <div class="setting-label">
                        <h4 style="margin:0; font-size: 13px;">Assigned Profile</h4>
                    </div>
                    <select id="cfg-m-profile-${i}" class="select-input" style="font-size: 13px; padding: 4px 8px; box-sizing: border-box; width: 170px;">
                        ${profileOptions}
                    </select>
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    container.innerHTML = html;

    
    // Set initial display
    for (let i = 0; i < 4; i++) {
        updateMultiInputModeUI(i);
    }
}

function updateMultiInputModeUI(idx) {
    const mode = document.getElementById(`cfg-m-input-${idx}`)?.value;
    const gamepadRow = document.getElementById(`row-cfg-m-device-${idx}`);
    const kbRow = document.getElementById(`row-cfg-m-kb-${idx}`);
    const mouseRow = document.getElementById(`row-cfg-m-mouse-${idx}`);
    if (!mode) return;
    
    if (mode === 'kb_mouse') {
        gamepadRow.style.display = 'none';
        kbRow.style.display = 'flex';
        mouseRow.style.display = 'flex';
    } else if (mode === 'virtual_gamepad') {
        gamepadRow.style.display = 'none';
        kbRow.style.display = 'none';
        mouseRow.style.display = 'none';
    } else {
        gamepadRow.style.display = 'flex';
        kbRow.style.display = 'none';
        mouseRow.style.display = 'none';
    }
}

function enforceAtLeastOneSlot(checkboxRef) {
    if (!checkboxRef.checked) {
        let count = 0;
        document.querySelectorAll('.slot-enable-toggle').forEach(el => {
            if (el.checked) count++;
        });
        if (count === 0) {
            checkboxRef.checked = true; // Rollback
            toast('Minimum 1 slot is required to use the bridge.', 'warning');
        }
    }
}

async function saveSettings() {
    const multiSlots = [];
    let enabledCount = 0;
    
    for (let i=0; i<4; i++) {
        const elEnabled = document.getElementById(`cfg-m-enabled-${i}`);
        if (!elEnabled) break;
        if (elEnabled.checked) enabledCount++;
        multiSlots.push({
            enabled: elEnabled.checked,
            profile: document.getElementById(`cfg-m-profile-${i}`).value,
            input_mode: document.getElementById(`cfg-m-input-${i}`).value,
            device_path: document.getElementById(`cfg-m-device-${i}`).value,
            keyboard_device: document.getElementById(`cfg-m-kb-${i}`).value,
            mouse_device: document.getElementById(`cfg-m-mouse-${i}`).value,
            serial_port: document.getElementById(`cfg-m-serial-${i}`).value
        });
    }

    if (enabledCount === 0) {
        toast('You must enable at least 1 slot!', 'error');
        return;
    }

    const data = {
        multi_slots: multiSlots,
        baud_rate: parseInt(document.getElementById('cfg-baud').value) || 500000,
        debug_interval: parseFloat(document.getElementById('cfg-debug-interval').value) || 0.5
    };
    const res = await api('config', 'POST', data);
    if (res && res.ok) {
        toast('Settings saved!', 'success');
    } else {
        toast('Failed to save settings', 'error');
    }
}

async function detectDevices(type, idx) {
    const res = type === 'serial' ? await api('serial_ports') : await api('devices');
    const containerId = type === 'serial' ? `detected-devices-serial-${idx}` : type === 'gamepad' ? `detected-devices-gamepad-${idx}` : type === 'keyboard' ? `detected-devices-keyboard-${idx}` : `detected-devices-mouse-${idx}`;
    const inputId = type === 'serial' ? `cfg-m-serial-${idx}` : type === 'gamepad' ? `cfg-m-device-${idx}` : type === 'keyboard' ? `cfg-m-kb-${idx}` : `cfg-m-mouse-${idx}`;

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

function resetSticks() {
    document.getElementById('dz-left').value = 5;
    document.getElementById('dz-left-val').textContent = '5%';
    document.getElementById('dz-right').value = 5;
    document.getElementById('dz-right-val').textContent = '5%';
    
    document.getElementById('curve-left').value = 'linear';
    document.getElementById('curve-right').value = 'linear';
    
    document.getElementById('mult-left').value = 10;
    document.getElementById('mult-left-val').textContent = '1.0x';
    document.getElementById('mult-right').value = 10;
    document.getElementById('mult-right-val').textContent = '1.0x';
    
    drawCurve('left');
    drawCurve('right');
    saveProfile();
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


/* ============================================================
   STATE STREAMING FOR VISUALIZERS
   ============================================================ */
function manageLiveStream() {
    if (isBridgeRunning && currentActiveTab === 'sticks') {
        if (!liveEventSource) {
            liveEventSource = new EventSource('/api/state_stream');
            liveEventSource.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.stopped) {
                        if (liveEventSource) { liveEventSource.close(); liveEventSource = null; }
                        return;
                    }
                    updateStickVisualizers(data);
                } catch (err) {}
            };
            liveEventSource.onerror = () => {
                if (liveEventSource) { liveEventSource.close(); liveEventSource = null; }
            };
        }
    } else {
        if (liveEventSource) {
            liveEventSource.close();
            liveEventSource = null;
        }
    }
}

function updateStickVisualizers(data) {
    if (!data || !data.axes || !data.processed_axes) return;

    // Map -32768..32767 to 0%..100%
    const mapAxis = (val) => {
        let percent = ((val + 32768) / 65535) * 100;
        return Math.max(0, Math.min(100, percent));
    };

    const dRawL = document.getElementById('dot-left-raw');
    const dProcL = document.getElementById('dot-left-proc');
    if (dRawL && dProcL) {
        dRawL.style.left = mapAxis(data.axes.lx) + '%';
        dRawL.style.top  = mapAxis(data.axes.ly) + '%';
        dProcL.style.left = mapAxis(data.processed_axes.lx) + '%';
        dProcL.style.top  = mapAxis(data.processed_axes.ly) + '%';
    }

    const dRawR = document.getElementById('dot-right-raw');
    const dProcR = document.getElementById('dot-right-proc');
    if (dRawR && dProcR) {
        dRawR.style.left = mapAxis(data.axes.rx) + '%';
        dRawR.style.top  = mapAxis(data.axes.ry) + '%';
        dProcR.style.left = mapAxis(data.processed_axes.rx) + '%';
        dProcR.style.top  = mapAxis(data.processed_axes.ry) + '%';
    }
}

/* ============================================================
   VIRTUAL GAMEPAD CLASS
   ============================================================ */
class VirtualGamepad {
    constructor() {
        this.state = {
            buttons: {},
            axes: { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 },
            dpad: { up: 0, down: 0, left: 0, right: 0 }
        };
        BUTTON_NAMES.forEach(b => this.state.buttons[b] = 0);
        this.lastSentState = "";
        this.syncBusy = false;
        this.ws = null;
        this.wsConnecting = false;

        this.initEventListeners();
        this.startSyncLoop();
    }

    manageSocket() {
        const currentMode = document.getElementById('cfg-input-mode')?.value;
        if (currentMode === 'virtual_gamepad' && isBridgeRunning) {
            if (!this.ws && !this.wsConnecting) {
                this.wsConnecting = true;
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.host}/ws/inject`;
                
                console.log("[*] Connecting WebSocket for Virtual Input...");
                this.ws = new WebSocket(wsUrl);
                
                this.ws.onopen = () => {
                    console.log("[*] WebSocket Connected");
                    this.wsConnecting = false;
                };
                
                this.ws.onmessage = (e) => {}; 
                
                this.ws.onclose = () => {
                    console.log("[!] WebSocket Disconnected");
                    this.ws = null;
                    this.wsConnecting = false;
                };
                
                this.ws.onerror = (e) => {
                    this.ws = null;
                    this.wsConnecting = false;
                };
            }
        } else {
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
        }
    }

    initEventListeners() {
        // Buttons
        document.querySelectorAll('.vg-btn').forEach(btn => {
            const handlePress = (e) => {
                const b = btn.dataset.btn;
                const d = btn.dataset.dpad;
                if (b) this.state.buttons[b] = 1;
                if (d) this.state.dpad[d] = 1;
                btn.classList.add('active');
            };
            const handleRelease = (e) => {
                const b = btn.dataset.btn;
                const d = btn.dataset.dpad;
                if (b) this.state.buttons[b] = 0;
                if (d) this.state.dpad[d] = 0;
                btn.classList.remove('active');
            };
            
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); handlePress(); });
            btn.addEventListener('touchend', (e) => { e.preventDefault(); handleRelease(); });
            btn.addEventListener('mousedown', (e) => { handlePress(); });
            btn.addEventListener('mouseup', (e) => { handleRelease(); });
            btn.addEventListener('mouseleave', (e) => { handleRelease(); });
        });

        // Joysticks (Fixed)
        this.setupStick('vg-stick-l', 'lx', 'ly', 'vg-stick-l-dot');
        this.setupStick('vg-stick-r', 'rx', 'ry', 'vg-stick-r-dot');
    }

    setupStick(containerId, axisX, axisY, dotId) {
        const container = document.getElementById(containerId);
        const dot = document.getElementById(dotId);
        if (!container || !dot) return;

        let activeRect = null;
        let activeTouchId = null;

        const updateStick = (clientX, clientY) => {
            const rect = activeRect || container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const radius = rect.width / 2;

            let dx = clientX - centerX;
            let dy = clientY - centerY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist > radius) {
                dx *= radius / dist;
                dy *= radius / dist;
            }

            // Map to -32768..32767
            this.state.axes[axisX] = Math.round((dx / radius) * 32767);
            this.state.axes[axisY] = Math.round((dy / radius) * 32767);

            // Visuals
            dot.style.transform = `translate(${dx}px, ${dy}px)`;
        };

        const handleMove = (e) => {
            if (e.cancelable) e.preventDefault();
            
            let touch = null;
            if (e.touches) {
                // Find the touch that matches our activeTouchId
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === activeTouchId) {
                        touch = e.touches[i];
                        break;
                    }
                }
            } else {
                touch = e;
            }

            if (touch) {
                updateStick(touch.clientX, touch.clientY);
            }
        };

        const handleEnd = (e) => {
            if (e && e.changedTouches) {
                let match = false;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === activeTouchId) {
                        match = true;
                        break;
                    }
                }
                if (!match) return; // Not our finger
            }

            if (e && e.cancelable) e.preventDefault();
            activeRect = null;
            activeTouchId = null;
            this.state.axes[axisX] = 0;
            this.state.axes[axisY] = 0;
            dot.style.transform = 'translate(0,0)';
        };

        container.addEventListener('touchstart', (e) => {
            if (activeTouchId !== null) return;
            const touch = e.changedTouches[0];
            activeTouchId = touch.identifier;
            activeRect = container.getBoundingClientRect();
            updateStick(touch.clientX, touch.clientY);
        });

        container.addEventListener('touchmove', handleMove, { passive: false });
        container.addEventListener('touchend', handleEnd);
        container.addEventListener('touchcancel', handleEnd);
        
        container.addEventListener('mousedown', (e) => {
            activeRect = container.getBoundingClientRect();
            const onMouseMove = (me) => updateStick(me.clientX, me.clientY);
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                handleEnd();
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            updateStick(e.clientX, e.clientY);
        });
    }

    async startSyncLoop() {
        if (this.syncBusy) return;
        this.syncBusy = true;

        try {
            this.manageSocket();

            const targetSlot = document.getElementById('vg-slot-selector')?.value || '1';
            
            // Send virtual input
            this.state._slot = parseInt(targetSlot);
            const currentStateStr = JSON.stringify(this.state);
            if (currentStateStr !== this.lastSentState) {
                this.lastSentState = currentStateStr;
                
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(currentStateStr);
                } else {
                    // Fallback to HTTP if WS not ready
                    await api('inject', 'POST', this.state);
                }
            }
        } catch (e) {
            console.error('VG Sync Error:', e);
        } finally {
            this.syncBusy = false;
            // 60Hz Throttle
            setTimeout(() => this.startSyncLoop(), 16);
        }
    }
}
