let hands, camera, synth, synth2, filter, reverb, delay, isPlaying = false;

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

    // Right hand controls filter
    if (rightHandLm && isPlaying && filter) {
        const angle = calculateWristAngle(rightHandLm);
        const freq = mapToFreq(angle);
        filter.frequency.rampTo(freq, 0.1);
        info.textContent = `Right Hand - Angle: ${Math.round(angle)}° | Filter: ${freq} Hz`;
    }

    // Left hand detected but not yet assigned (placeholder for future)
    if (leftHandLm) {
        // TODO: Add left hand control here
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
        Q: 2
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

    isPlaying = true;
    await startCamera();

    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
};

stopBtn.onclick = () => {
    isPlaying = false;
    Tone.Transport.stop();
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
