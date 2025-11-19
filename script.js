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
// Format: { 'NoteName': { osc: OscillatorNode, gain: GainNode, filter: BiquadFilterNode } }
const oscs = {};
let lastNoteFrequency = 440; // Used to stabilize the oscilloscope

// --- Configuration & Constants ---
const settings = {
    waveform: 'sine',
    cutoff: 2000,
    resonance: 1,
    attack: 0.1,
    decay: 0.2,
    sustain: 0.5,
    release: 0.5,
    volume: 0.5
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

    // Remove the "Click to start" overlay text if desired
    document.querySelector('.instructions p').innerText = "AUDIO ENGINE ACTIVE";
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
    const filter = audioCtx.createBiquadFilter();
    const noteGain = audioCtx.createGain();

    // Configure Oscillator
    osc.type = settings.waveform;
    osc.frequency.value = freq;

    // Configure Filter
    filter.type = 'lowpass';
    filter.frequency.value = settings.cutoff;
    filter.Q.value = settings.resonance;

    // Configure Envelope (ADSR)
    // Start at 0
    noteGain.gain.setValueAtTime(0, t);
    // Attack: Ramp to peak (0.3 is a safe peak volume per note)
    noteGain.gain.linearRampToValueAtTime(0.3, t + settings.attack);
    // Decay: Ramp down to sustain level
    noteGain.gain.linearRampToValueAtTime(0.3 * settings.sustain, t + settings.attack + settings.decay);

    // Connect: Osc -> Filter -> NoteGain -> Analyser (Mix Bus)
    osc.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(analyser);

    osc.start();

    // Store reference
    oscs[note] = { osc, noteGain, filter };

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

    // ADSR visual duration (fixed 3 seconds total width)
    const pxPerSec = w / 3;

    const atk = settings.attack * pxPerSec;
    const dec = settings.decay * pxPerSec;
    const rel = settings.release * pxPerSec;
    const susH = h - (settings.sustain * h);

    ctx.beginPath();
    ctx.moveTo(0, h); // Start bottom left
    ctx.lineTo(atk, 0); // Attack peak
    ctx.lineTo(atk + dec, susH); // Decay to sustain
    ctx.lineTo(atk + dec + (0.5 * pxPerSec), susH); // Hold sustain 0.5s
    ctx.lineTo(atk + dec + (0.5 * pxPerSec) + rel, h); // Release
    ctx.stroke();
}

function drawFilter() {
    const canvas = document.getElementById('filter-viz');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.strokeStyle = '#ff00ff';

    // Map Logarithmic Frequency
    const minLog = Math.log(20);
    const maxLog = Math.log(20000);
    const valLog = Math.log(Math.max(20, settings.cutoff));

    const ratio = (valLog - minLog) / (maxLog - minLog);
    const x = ratio * w;

    // Resonance Peak
    const qHeight = Math.min(settings.resonance * (h / 4), h / 2);

    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    // Draw curve
    ctx.quadraticCurveTo(x, h / 2, x, (h / 2) - qHeight);
    ctx.quadraticCurveTo(x, h, w, h);
    ctx.stroke();
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
    const inputs = ['cutoff', 'resonance', 'attack', 'decay', 'sustain', 'release', 'volume'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', (e) => {
            settings[id] = parseFloat(e.target.value);

            // Live update Master Volume
            if (id === 'volume' && masterGain) {
                masterGain.gain.setTargetAtTime(settings.volume, audioCtx.currentTime, 0.1);
            }
            // Live update active filters
            if (id === 'cutoff' || id === 'resonance') {
                Object.values(oscs).forEach(({ filter }) => {
                    if (id === 'cutoff') filter.frequency.value = settings.cutoff;
                    if (id === 'resonance') filter.Q.value = settings.resonance;
                });
            }
        });
    });

    // 3. Keyboard Events
    const handleKey = (key, type) => {
        const note = keyMap[key.toLowerCase()];
        if (!note) return;
        if (type === 'down') playNote(note);
        else stopNote(note);
    };

    document.addEventListener('keydown', e => {
        if (!e.repeat) handleKey(e.key, 'down');
    });
    document.addEventListener('keyup', e => handleKey(e.key, 'up'));

    // 4. Mouse Events
    document.querySelectorAll('.key').forEach(k => {
        k.addEventListener('mousedown', () => playNote(k.dataset.note));
        k.addEventListener('mouseup', () => stopNote(k.dataset.note));
        k.addEventListener('mouseleave', () => stopNote(k.dataset.note));
    });

    // 5. Init Audio on Interaction
    document.body.addEventListener('click', initAudio, { once: true });
});