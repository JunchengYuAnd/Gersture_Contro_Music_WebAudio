let hands, camera, synth, synth2, filter, reverb, delay, isPlaying = false;
let kick, snare, hihat, drumLoop, drumVolume;
let isDrumMuted = false;

// For tracking hand velocity
let prevRightHandPos = null;
let prevTime = null;
let currentFilterFreq = 150; // Start at minimum frequency

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const info = document.getElementById('info');

// Init MediaPipe
hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

hands.onResults(onResults);

// Calculate wrist flip angle
function calculateWristAngle(lm) {
    const wrist = lm[0];
    const middle = lm[9];
    const pinky = lm[17];

    const v1 = {
        x: middle.x - wrist.x,
        y: middle.y - wrist.y,
        z: middle.z - wrist.z
    };

    const v2 = {
        x: pinky.x - wrist.x,
        y: pinky.y - wrist.y,
        z: pinky.z - wrist.z
    };

    const normal = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x
    };

    const len = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
    const nz = normal.z / len;
    const angle = Math.asin(Math.max(-1, Math.min(1, nz))) * (180 / Math.PI);

    return angle + 90;
}

function mapToFreq(angle) {
    const norm = angle / 180;
    const logMin = Math.log(200);
    const logMax = Math.log(5000);
    return Math.round(Math.exp(logMin + norm * (logMax - logMin)));
}

// Calculate hand velocity (only right-to-left movement)
function calculateHandVelocity(lm) {
    const wrist = lm[0];
    const currentTime = performance.now();

    if (prevRightHandPos === null || prevTime === null) {
        prevRightHandPos = { x: wrist.x, y: wrist.y };
        prevTime = currentTime;
        return 0;
    }

    // Calculate horizontal movement (X axis only)
    // Note: video is mirrored, so positive dx in screen = moving left in real world
    const dx = wrist.x - prevRightHandPos.x;

    // Calculate time delta in seconds
    const dt = (currentTime - prevTime) / 1000;

    // Update previous values
    prevRightHandPos = { x: wrist.x, y: wrist.y };
    prevTime = currentTime;

    // Avoid division by zero
    if (dt === 0) return 0;

    // Only count right-to-left movement (positive dx due to mirror)
    // Ignore left-to-right movement
    if (dx <= 0) return 0;

    // Velocity in normalized units per second
    const velocity = dx / dt;

    return velocity;
}

// Map velocity to frequency (logarithmic scale)
function mapVelocityToFreq(velocity) {
    // Lower threshold for more sensitivity - now 0 to 0.8 maps to full range
    const clampedVelocity = Math.min(Math.max(velocity, 0), 0.8);
    const norm = clampedVelocity / 0.8; // normalize to 0-1

    // Wider frequency range: 150Hz to 8000Hz
    const logMin = Math.log(150);
    const logMax = Math.log(8000);
    return Math.round(Math.exp(logMin + norm * (logMax - logMin)));
}

// Detect if hand is making a fist (all fingers curled)
function isFist(lm) {
    // Compare fingertip positions to their base knuckle positions
    // Finger tips: 8(index), 12(middle), 16(ring), 20(pinky)
    // Finger bases: 5(index), 9(middle), 13(ring), 17(pinky)
    const tips = [8, 12, 16, 20];
    const bases = [5, 9, 13, 17];

    let curledCount = 0;
    for (let i = 0; i < tips.length; i++) {
        const tipY = lm[tips[i]].y;
        const baseY = lm[bases[i]].y;
        // In screen coordinates, larger Y = lower position
        // When finger is curled, tip is below (greater Y) than base
        if (tipY > baseY) {
            curledCount++;
        }
    }

    // Consider it a fist if at least 3 fingers are curled
    return curledCount >= 3;
}

function drawHand(lm, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const connections = [
        [0,1],[1,2],[2,3],[3,4],
        [0,5],[5,6],[6,7],[7,8],
        [0,9],[9,10],[10,11],[11,12],
        [0,13],[13,14],[14,15],[15,16],
        [0,17],[17,18],[18,19],[19,20],
        [5,9],[9,13],[13,17]
    ];

    connections.forEach(([a,b]) => {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
        ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
        ctx.stroke();
    });
}

function onResults(results) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let rightHandLm = null;
    let leftHandLm = null;

    // Identify left and right hands
    if (results.multiHandLandmarks && results.multiHandedness) {
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const lm = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness[i].label;

            // Note: MediaPipe returns "Left"/"Right" from camera's perspective
            // Since video is mirrored, we swap them
            if (handedness === 'Left') {
                rightHandLm = lm;
                drawHand(lm, '#00ff00'); // Green for right hand
            } else {
                leftHandLm = lm;
                drawHand(lm, '#ff6600'); // Orange for left hand
            }
        }
    }

    // Right hand velocity controls filter
    if (rightHandLm && isPlaying && filter) {
        const velocity = calculateHandVelocity(rightHandLm);
        const targetFreq = mapVelocityToFreq(velocity);

        // Smooth the frequency change: rise fast, fall fast
        if (targetFreq > currentFilterFreq) {
            // Fast attack when moving fast
            currentFilterFreq = currentFilterFreq + (targetFreq - currentFilterFreq) * 0.5;
        } else {
            // Faster decay when slowing down
            currentFilterFreq = currentFilterFreq + (targetFreq - currentFilterFreq) * 0.25;
        }

        filter.frequency.rampTo(currentFilterFreq, 0.05);
        info.textContent = `Speed: ${velocity.toFixed(2)} | Filter: ${Math.round(currentFilterFreq)} Hz`;
    }

    // Left hand controls drum mute (fist = mute)
    if (leftHandLm && isPlaying && drumVolume) {
        const fist = isFist(leftHandLm);
        if (fist && !isDrumMuted) {
            drumVolume.volume.rampTo(-Infinity, 0.1);
            isDrumMuted = true;
        } else if (!fist && isDrumMuted) {
            drumVolume.volume.rampTo(0, 0.1);
            isDrumMuted = false;
        }

        // Update info to show drum status
        const drumStatus = isDrumMuted ? '🤛 Drums OFF' : '✋ Drums ON';
        if (rightHandLm) {
            info.textContent = `Filter: ${Math.round(currentFilterFreq)} Hz | ${drumStatus}`;
        } else {
            info.textContent = drumStatus;
        }
    }

    // Update info when no hands detected
    if (!rightHandLm && !leftHandLm) {
        if (isPlaying) {
            info.textContent = 'No hands detected';
        }
    }
}

async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 }
    });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
        camera = new Camera(video, {
            onFrame: async () => await hands.send({ image: video }),
            width: 1280,
            height: 720
        });
        camera.start();
    };
}

startBtn.onclick = async () => {
    await Tone.start();
    Tone.Transport.bpm.value = 90;

    // Main synth - warm pad sound
    synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
        envelope: { attack: 0.3, decay: 0.4, sustain: 0.6, release: 1.2 }
    });
    synth.volume.value = -8;

    // Second synth layer - sub bass octave
    synth2 = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.2, decay: 0.3, sustain: 0.5, release: 1.0 }
    });
    synth2.volume.value = -12;

    // Filter with resonance
    filter = new Tone.Filter({
        type: 'lowpass',
        frequency: 1000,
        rolloff: -24,
        Q: 4
    });

    // Reverb for space
    reverb = new Tone.Reverb({
        decay: 1.5,
        wet: 0.15
    });
    await reverb.generate();

    // Subtle delay
    delay = new Tone.FeedbackDelay({
        delayTime: '8n.',
        feedback: 0.2,
        wet: 0.15
    });

    // Drum volume control (for muting with left hand)
    drumVolume = new Tone.Volume(0).toDestination();

    // Drum sounds
    kick = new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 6,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 }
    }).connect(drumVolume);
    kick.volume.value = -6;

    snare = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 }
    }).connect(drumVolume);
    snare.volume.value = -10;

    hihat = new Tone.MetalSynth({
        frequency: 200,
        envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5
    }).connect(drumVolume);
    hihat.volume.value = -18;

    // Drum loop pattern
    drumLoop = new Tone.Part((time, note) => {
        if (note === 'kick') {
            kick.triggerAttackRelease('C1', '8n', time);
        } else if (note === 'snare') {
            snare.triggerAttackRelease('8n', time);
        } else if (note === 'hihat') {
            hihat.triggerAttackRelease('C6', '32n', time);
        }
    }, [
        // Beat pattern: kick on 1 and 3, snare on 2 and 4, hihat on every 8th
        ['0:0:0', 'kick'],
        ['0:0:0', 'hihat'],
        ['0:0:2', 'hihat'],
        ['0:1:0', 'snare'],
        ['0:1:0', 'hihat'],
        ['0:1:2', 'hihat'],
        ['0:2:0', 'kick'],
        ['0:2:0', 'hihat'],
        ['0:2:2', 'hihat'],
        ['0:3:0', 'snare'],
        ['0:3:0', 'hihat'],
        ['0:3:2', 'hihat']
    ]);
    drumLoop.loop = true;
    drumLoop.loopEnd = '1m';

    // Audio chain
    const volume = new Tone.Volume(-6);
    synth.chain(filter, delay, reverb, volume, Tone.Destination);
    synth2.chain(filter, reverb, volume, Tone.Destination);

    // More musical chord progression: Cmaj7 -> Am7 -> Fmaj7 -> G7
    const chordProgression = [
        ['C3', 'E3', 'G3', 'B3'],   // Cmaj7
        ['A2', 'C3', 'E3', 'G3'],   // Am7
        ['F2', 'A2', 'C3', 'E3'],   // Fmaj7
        ['G2', 'B2', 'D3', 'F3']    // G7
    ];

    let chordIndex = 0;
    const pattern = new Tone.Pattern((time, note) => {
        synth.triggerAttackRelease(note, '2n', time);
        // Sub bass plays root note one octave lower
        const rootNote = note.replace(/\d/, (n) => parseInt(n) - 1);
        synth2.triggerAttackRelease(rootNote, '2n', time);
    }, chordProgression[0], 'up');

    pattern.interval = '4n';

    // Change chords every 2 bars
    Tone.Transport.scheduleRepeat((time) => {
        chordIndex = (chordIndex + 1) % chordProgression.length;
        pattern.values = chordProgression[chordIndex];
    }, '2m', '2m');

    Tone.Transport.start();
    pattern.start(0);
    drumLoop.start(0);

    isPlaying = true;
    await startCamera();

    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
};

stopBtn.onclick = () => {
    isPlaying = false;
    isDrumMuted = false;
    prevRightHandPos = null;
    prevTime = null;
    currentFilterFreq = 150;
    Tone.Transport.stop();
    if (drumLoop) drumLoop.stop();
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
    if (camera) camera.stop();

    startBtn.style.display = 'inline-block';
    stopBtn.style.display = 'none';
    info.textContent = 'Angle: -- | Filter: -- Hz';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
};
