/**
 * Arcade Waveform Synthesizer
 * * Manages AudioContext, Oscillator creation, and Visualizations.
 */

// --- Global Audio State ---
let audioCtx;
let analyser;
let compressor;
let masterGain;

// Track active oscillators to handle polyphony (multiple notes at once)
// Format: { 'NoteName': { osc: OscillatorNode, noteGain: GainNode, lowpass: BiquadFilterNode, highpass: BiquadFilterNode } }
const oscs = {};
let lastNoteFrequency = 440; // Used to stabilize the oscilloscope

// --- Configuration & Constants ---
const settings = {
    waveform: 'sine',
    lowCutoff: 20000,
    highCutoff: 20,
    attack: 0.1,
    release: 0.5,
    volume: 0.5
};

const uiTuning = {
    nudgeMultiplier: 3
};

const notes = {
    'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13,
    'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00,
    'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88, 'C5': 523.25
};

const keyMap = {
    'z': 'C4', 's': 'C#4', 'x': 'D4', 'd': 'D#4', 'c': 'E4', 'v': 'F4',
    'g': 'F#4', 'b': 'G4', 'h': 'G#4', 'n': 'A4', 'j': 'A#4', 'm': 'B4', ',': 'C5'
};

const sliderHotkeys = {
    '1': 'lowCutoff',
    '2': 'highCutoff',
    '3': 'attack',
    '4': 'release',
    '5': 'volume'
};

// Per-slider keyboard nudges (two letters per slider)
const sliderAdjustHotkeys = {
    'o': { id: 'lowCutoff', direction: -1 },
    'p': { id: 'lowCutoff', direction: 1 },
    'l': { id: 'highCutoff', direction: -1 },
    'k': { id: 'highCutoff', direction: 1 },
    'q': { id: 'attack', direction: -1 },
    'w': { id: 'attack', direction: 1 },
    'e': { id: 'release', direction: -1 },
    'r': { id: 'release', direction: 1 },
    'u': { id: 'volume', direction: -1 },
    'i': { id: 'volume', direction: 1 }
};

// --- Audio Engine Initialization ---
function initAudio() {
    if (audioCtx) return; // Already initialized

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    // 1. Create Analyser (Visualizer input)
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    // 2. Create Compressor (Limiter to prevent clipping)
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    // 3. Master Gain (Volume Control)
    masterGain = audioCtx.createGain();
    masterGain.gain.value = settings.volume;

    // 4. Connect Graph: Analyser -> Compressor -> Master -> Speakers
    analyser.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    // Start the visual loop
    resizeCanvases(); // Fix canvas resolution
    drawLoop();
}

// --- Note Control ---
function playNote(note) {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    // Stop existing note if key is pressed again quickly
    if (oscs[note]) {
        stopNote(note);
    }

    const freq = notes[note];
    lastNoteFrequency = freq;
    const t = audioCtx.currentTime;

    // Create Nodes
    const osc = audioCtx.createOscillator();
    const lowpass = audioCtx.createBiquadFilter();
    const highpass = audioCtx.createBiquadFilter();
    const noteGain = audioCtx.createGain();

    // Configure Oscillator
    osc.type = settings.waveform;
    osc.frequency.value = freq;

    // Configure Filters
    lowpass.type = 'lowpass';
    lowpass.frequency.value = settings.lowCutoff;
    lowpass.Q.value = 0.707;

    highpass.type = 'highpass';
    highpass.frequency.value = settings.highCutoff;
    highpass.Q.value = 0.707;

    // Configure Envelope (AR)
    // Start at 0
    noteGain.gain.setValueAtTime(0, t);
    // Attack: Ramp to peak (0.3 is a safe peak volume per note)
    noteGain.gain.linearRampToValueAtTime(0.3, t + settings.attack);

    // Connect: Osc -> LP -> HP -> NoteGain -> Analyser (Mix Bus)
    osc.connect(lowpass);
    lowpass.connect(highpass);
    highpass.connect(noteGain);
    noteGain.connect(analyser);

    osc.start();

    // Store reference
    oscs[note] = { osc, noteGain, lowpass, highpass };

    // UI Update
    const keyEl = document.querySelector(`.key[data-note="${note}"]`);
    if (keyEl) keyEl.classList.add('active');
}

function stopNote(note) {
    if (!oscs[note]) return;

    const { osc, noteGain } = oscs[note];
    const t = audioCtx.currentTime;

    // Release Phase
    noteGain.gain.cancelScheduledValues(t);
    noteGain.gain.setValueAtTime(noteGain.gain.value, t); // Hold current value
    noteGain.gain.linearRampToValueAtTime(0, t + settings.release);

    osc.stop(t + settings.release);

    // Cleanup Object
    // We use a closure check to ensure we don't delete a *new* note if pressed rapidly
    const activeOsc = oscs[note].osc;
    setTimeout(() => {
        if (oscs[note] && oscs[note].osc === activeOsc) {
            delete oscs[note];
        }
    }, settings.release * 1000);

    // UI Update
    const keyEl = document.querySelector(`.key[data-note="${note}"]`);
    if (keyEl) keyEl.classList.remove('active');
}

// --- Visualizations ---

function resizeCanvases() {
    const canvases = ['oscilloscope', 'envelope-viz', 'filter-viz'];
    canvases.forEach(id => {
        const c = document.getElementById(id);
        const rect = c.getBoundingClientRect();
        // Set actual resolution to match CSS size * device pixel ratio
        c.width = rect.width * window.devicePixelRatio;
        c.height = rect.height * window.devicePixelRatio;
    });
}
window.addEventListener('resize', resizeCanvases);

function drawLoop() {
    requestAnimationFrame(drawLoop);
    drawOscilloscope();
    drawEnvelope();
    drawFilter();
}

function drawOscilloscope() {
    const canvas = document.getElementById('oscilloscope');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    // Clear Screen
    ctx.fillStyle = 'rgba(0, 10, 0, 0.2)'; // Trail effect
    ctx.fillRect(0, 0, width, height);

    ctx.lineWidth = 3 * window.devicePixelRatio;
    ctx.strokeStyle = '#39ff14';
    ctx.beginPath();

    // Trigger Logic (stabilize wave)
    let trigger = -1;
    for (let i = 0; i < bufferLength - 1; i++) {
        // Find point crossing center (128) going up
        if (dataArray[i] < 128 && dataArray[i + 1] >= 128) {
            trigger = i;
            break;
        }
    }

    // If no sound or trigger not found, draw flat line
    if (trigger === -1) {
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
    }

    // Draw Wave
    // Scale to show about 2 cycles
    const sampleRate = audioCtx.sampleRate;
    const cycleSamples = sampleRate / lastNoteFrequency;
    const samplesToDraw = cycleSamples * 2;

    const step = width / samplesToDraw;

    for (let i = 0; i < samplesToDraw; i++) {
        const index = trigger + i;
        let v = 128;
        if (index < bufferLength) v = dataArray[index];

        // Map 0-255 to canvas height
        const y = (v / 255.0) * height;

        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * step, y);
    }
    ctx.stroke();
}

function drawEnvelope() {
    const canvas = document.getElementById('envelope-viz');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Helper for responsiveness
    const lineWidth = 2 * window.devicePixelRatio;
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = '#00ffff';

    const pxPerSec = w / 2.5;

    const atk = settings.attack * pxPerSec;
    const rel = settings.release * pxPerSec;

    ctx.beginPath();
    ctx.moveTo(0, h); // Start bottom left
    ctx.lineTo(atk, 0); // Attack peak
    ctx.lineTo(atk + (0.5 * pxPerSec), 0); // Hold sustain 0.5s
    ctx.lineTo(atk + (0.5 * pxPerSec) + rel, h); // Release
    ctx.stroke();
}

function drawFilter() {
    const canvas = document.getElementById('filter-viz');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2 * window.devicePixelRatio;

    // Map Logarithmic Frequency helper
    const mapFreq = (val, min, max) => {
        const minLog = Math.log(min);
        const maxLog = Math.log(max);
        const valLog = Math.log(Math.max(min, val));
        const ratio = (valLog - minLog) / (maxLog - minLog);
        return ratio * w;
    };

    const lpX = mapFreq(settings.lowCutoff, 20, 20000);
    const hpX = mapFreq(settings.highCutoff, 20, 20000);

    // Low-pass curve
    ctx.strokeStyle = '#ff00ff';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.quadraticCurveTo(lpX, h / 2, lpX, h * 0.35);
    ctx.quadraticCurveTo(lpX, h, w, h);
    ctx.stroke();

    // High-pass curve
    ctx.strokeStyle = '#39ff14';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.quadraticCurveTo(hpX, h, hpX, h * 0.45);
    ctx.quadraticCurveTo(hpX, h / 2, w, h / 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = `${10 * window.devicePixelRatio}px 'Press Start 2P'`;
    ctx.textBaseline = 'top';
    ctx.fillText('LP', 6 * window.devicePixelRatio, 6 * window.devicePixelRatio);
    ctx.fillText('HP', 6 * window.devicePixelRatio, 18 * window.devicePixelRatio);
}

// --- Input Handling ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Waveform Buttons
    document.querySelectorAll('.wave-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.wave-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            settings.waveform = e.target.dataset.wave;
        });
    });

    // 2. Sliders
    const inputs = ['lowCutoff', 'highCutoff', 'attack', 'release', 'volume'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', (e) => {
            if (id === 'nudgeSpeed') {
                uiTuning.nudgeMultiplier = parseFloat(e.target.value);
                return;
            }

            settings[id] = parseFloat(e.target.value);

            // Live update Master Volume
            if (id === 'volume' && masterGain) {
                masterGain.gain.setTargetAtTime(settings.volume, audioCtx.currentTime, 0.1);
            }

            // Live update active filters
            if (id === 'lowCutoff' || id === 'highCutoff') {
                Object.values(oscs).forEach(({ lowpass, highpass }) => {
                    if (id === 'lowCutoff') lowpass.frequency.value = settings.lowCutoff;
                    if (id === 'highCutoff') highpass.frequency.value = settings.highCutoff;
                });
            }
        });
    });

    // 3. Slider hotkeys for quick focus + arrow tweak
    const nudgeSlider = (el, direction) => {
        if (!el) return;
        const step = parseFloat(el.step || '1');
        const min = parseFloat(el.min);
        const max = parseFloat(el.max);
        const next = Math.min(max, Math.max(min, parseFloat(el.value) + direction * step));
        if (next !== parseFloat(el.value)) {
            el.value = next;
            el.dispatchEvent(new Event('input'));
        }
    };

    document.addEventListener('keydown', e => {
        const adjust = sliderAdjustHotkeys[e.key.toLowerCase()];
        if (adjust) {
            const el = document.getElementById(adjust.id);
            nudgeSlider(el, adjust.direction);
            return;
        }

        const id = sliderHotkeys[e.key];
        if (id) {
            const el = document.getElementById(id);
            el.focus();
        }
    });

    document.addEventListener('keydown', e => {
        const focused = document.activeElement;
        if (!focused || focused.type !== 'range') return;

        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            nudgeSlider(focused, 1);
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            nudgeSlider(focused, -1);
        }
    });

    // 4. Keyboard Events for notes
    const handleKey = (key, type) => {
        const note = keyMap[key.toLowerCase()];
        if (!note) return;
        if (type === 'down') playNote(note);
        else stopNote(note);
    };

    document.addEventListener('keydown', e => {
        if (sliderHotkeys[e.key]) return; // Reserve hotkeys for sliders
        if (!e.repeat) handleKey(e.key, 'down');
    });
    document.addEventListener('keyup', e => handleKey(e.key, 'up'));

    // 5. Mouse Events.
    document.querySelectorAll('.key').forEach(k => {
        k.addEventListener('mousedown', () => playNote(k.dataset.note));
        k.addEventListener('mouseup', () => stopNote(k.dataset.note));
        k.addEventListener('mouseleave', () => stopNote(k.dataset.note));
    });

    // 6. Init Audio on Interaction
    document.body.addEventListener('click', initAudio, { once: true });
});
