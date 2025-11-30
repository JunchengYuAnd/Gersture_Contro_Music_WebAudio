let hands, camera, isPlaying = false;

// Audio players and effects
let drumPlayer, bassPlayer, melodyPlayer, padPlayer, percPlayer;
let filter, drumVolume;
let isDrumMuted = false;

// Track buffers
const trackBuffers = {
    drum: null,
    bass: null,
    melody: null,
    pad: null,
    perc: null
};

// For DJ reverse effect
let isScratchMode = false;
let prevRightHandX = null;

// DOM elements
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const info = document.getElementById('info');

// File inputs
const drumFile = document.getElementById('drumFile');
const bassFile = document.getElementById('bassFile');
const melodyFile = document.getElementById('melodyFile');
const padFile = document.getElementById('padFile');
const percFile = document.getElementById('percFile');

// Status indicators
const drumStatus = document.getElementById('drumStatus');
const bassStatus = document.getElementById('bassStatus');
const melodyStatus = document.getElementById('melodyStatus');
const padStatus = document.getElementById('padStatus');
const percStatus = document.getElementById('percStatus');

// Handle file uploads
drumFile.onchange = (e) => loadTrack(e, 'drum', drumStatus);
bassFile.onchange = (e) => loadTrack(e, 'bass', bassStatus);
melodyFile.onchange = (e) => loadTrack(e, 'melody', melodyStatus);
padFile.onchange = (e) => loadTrack(e, 'pad', padStatus);
percFile.onchange = (e) => loadTrack(e, 'perc', percStatus);

async function loadTrack(event, trackName, statusEl) {
    const file = event.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    trackBuffers[trackName] = url;
    statusEl.classList.add('loaded');
    updateStartButton();
}

function updateStartButton() {
    // Enable start if at least one track is loaded
    const hasAnyTrack = Object.values(trackBuffers).some(b => b !== null);
    startBtn.disabled = !hasAnyTrack;
    if (hasAnyTrack) {
        info.textContent = 'Ready! Click Start to begin';
    }
}

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

// Set reverse mode for all players
function setAllReverse(reverse) {
    if (drumPlayer) drumPlayer.reverse = reverse;
    if (bassPlayer) bassPlayer.reverse = reverse;
    if (melodyPlayer) melodyPlayer.reverse = reverse;
    if (padPlayer) padPlayer.reverse = reverse;
    if (percPlayer) percPlayer.reverse = reverse;
}

// Set playback rate for all players
function setAllPlaybackRate(rate) {
    if (drumPlayer) drumPlayer.playbackRate = rate;
    if (bassPlayer) bassPlayer.playbackRate = rate;
    if (melodyPlayer) melodyPlayer.playbackRate = rate;
    if (padPlayer) padPlayer.playbackRate = rate;
    if (percPlayer) percPlayer.playbackRate = rate;
}

// Detect if hand is making a fist
function isFist(lm) {
    const tips = [8, 12, 16, 20];
    const bases = [5, 9, 13, 17];

    let curledCount = 0;
    for (let i = 0; i < tips.length; i++) {
        if (lm[tips[i]].y > lm[bases[i]].y) {
            curledCount++;
        }
    }

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

    if (results.multiHandLandmarks && results.multiHandedness) {
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const lm = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness[i].label;

            if (handedness === 'Left') {
                rightHandLm = lm;
                drawHand(lm, '#00ff00');
            } else {
                leftHandLm = lm;
                drawHand(lm, '#ff6600');
            }
        }
    }

    // Check for DJ scratch mode: right hand fist
    const rightFist = rightHandLm ? isFist(rightHandLm) : false;

    // DJ Reverse: right hand fist + swipe left = reverse with speed control
    if (rightFist && rightHandLm && isPlaying) {
        const currentX = rightHandLm[0].x;

        if (prevRightHandX !== null) {
            // Calculate movement (positive = moving left in mirrored view)
            const dx = currentX - prevRightHandX;

            if (dx > 0.005) {
                // Moving left - reverse playback, speed based on movement
                const speed = Math.min(dx * 80, 5); // Even faster: multiplier 80, max 5x
                if (!isScratchMode) {
                    setAllReverse(true);
                    isScratchMode = true;
                }
                setAllPlaybackRate(speed);
                info.textContent = `🎧 DJ REVERSE! ⏪ ${speed.toFixed(1)}x`;
            } else {
                // Not moving left or moving right - pause at current position
                if (isScratchMode) {
                    setAllReverse(false);
                    isScratchMode = false;
                }
                setAllPlaybackRate(0); // Freeze playback
                info.textContent = `🤛 Scratch ready (swipe left)`;
            }
        }

        prevRightHandX = currentX;
    } else {
        // Not in scratch gesture - normal playback
        if (isScratchMode) {
            setAllReverse(false);
            setAllPlaybackRate(1);
            isScratchMode = false;
        }
        prevRightHandX = null;

        // Left hand controls drum mute (only if right hand is not making fist)
        if (leftHandLm && isPlaying && drumVolume && !rightFist) {
            const fist = isFist(leftHandLm);
            if (fist && !isDrumMuted) {
                drumVolume.volume.rampTo(-Infinity, 0.1);
                isDrumMuted = true;
            } else if (!fist && isDrumMuted) {
                drumVolume.volume.rampTo(0, 0.1);
                isDrumMuted = false;
            }

            const drumStatusText = isDrumMuted ? '🤛 Drums OFF' : '✋ Drums ON';
            info.textContent = drumStatusText;
        }

        if (!rightHandLm && !leftHandLm) {
            if (isPlaying) {
                info.textContent = 'No hands detected';
            }
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

    // Filter for bass, melody, pad
    filter = new Tone.Filter({
        type: 'lowpass',
        frequency: 1000,
        rolloff: -24,
        Q: 4
    }).toDestination();

    // Separate volume for drums
    drumVolume = new Tone.Volume(0).toDestination();

    // Create players for each track
    if (trackBuffers.drum) {
        drumPlayer = new Tone.Player({
            url: trackBuffers.drum,
            loop: true
        }).connect(drumVolume);
    }

    if (trackBuffers.bass) {
        bassPlayer = new Tone.Player({
            url: trackBuffers.bass,
            loop: true
        }).toDestination(); // Filter disabled, direct output
    }

    if (trackBuffers.melody) {
        melodyPlayer = new Tone.Player({
            url: trackBuffers.melody,
            loop: true
        }).toDestination(); // Filter disabled, direct output
    }

    if (trackBuffers.pad) {
        padPlayer = new Tone.Player({
            url: trackBuffers.pad,
            loop: true
        }).toDestination(); // Filter disabled, direct output
    }

    if (trackBuffers.perc) {
        percPlayer = new Tone.Player({
            url: trackBuffers.perc,
            loop: true
        }).connect(drumVolume);
    }

    // Wait for all players to load
    await Tone.loaded();

    // Start all players together
    const now = Tone.now();
    if (drumPlayer) drumPlayer.start(now);
    if (bassPlayer) bassPlayer.start(now);
    if (melodyPlayer) melodyPlayer.start(now);
    if (padPlayer) padPlayer.start(now);
    if (percPlayer) percPlayer.start(now);

    isPlaying = true;
    await startCamera();

    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
};

stopBtn.onclick = () => {
    isPlaying = false;
    isDrumMuted = false;
    isScratchMode = false;
    prevRightHandX = null;

    // Stop all players
    if (drumPlayer) { drumPlayer.stop(); drumPlayer.dispose(); drumPlayer = null; }
    if (bassPlayer) { bassPlayer.stop(); bassPlayer.dispose(); bassPlayer = null; }
    if (melodyPlayer) { melodyPlayer.stop(); melodyPlayer.dispose(); melodyPlayer = null; }
    if (padPlayer) { padPlayer.stop(); padPlayer.dispose(); padPlayer = null; }
    if (percPlayer) { percPlayer.stop(); percPlayer.dispose(); percPlayer = null; }
    if (filter) { filter.dispose(); filter = null; }
    if (drumVolume) { drumVolume.dispose(); drumVolume = null; }

    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
    if (camera) camera.stop();

    startBtn.style.display = 'inline-block';
    stopBtn.style.display = 'none';
    info.textContent = 'Stopped. Upload tracks and click Start';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
};

// Initial state
startBtn.disabled = true;
