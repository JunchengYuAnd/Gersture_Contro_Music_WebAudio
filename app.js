let hands, camera, isPlaying = false;

// Audio players and effects
let drumPlayer, bassPlayer, melodyPlayer, padPlayer, percPlayer;
let drumVolume, bassVolume, melodyVolume, padVolume, percVolume;
let melodyFilter; // Low-pass filter for melody

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

// For gesture detection
let prevRightHandY = null;

// Touch zones - small boxes in a row on the right side (mirrored view shows on top-left)
const zones = {
    drum: { x: 0.64, y: 0.05, w: 0.08, h: 0.12, label: '🥁', color: '#ff4444' },
    bass: { x: 0.73, y: 0.05, w: 0.08, h: 0.12, label: '🎸', color: '#44ff44' },
    melody: { x: 0.82, y: 0.05, w: 0.08, h: 0.12, label: '🎹', color: '#4444ff' },
    perc: { x: 0.91, y: 0.05, w: 0.08, h: 0.12, label: '🔔', color: '#ffff44' }
};

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

// Detect if hand is making a fist (strict detection)
function isFist(lm) {
    const tips = [8, 12, 16, 20];  // Index, middle, ring, pinky fingertips
    const bases = [5, 9, 13, 17];  // Base of each finger

    let curledCount = 0;
    for (let i = 0; i < tips.length; i++) {
        if (lm[tips[i]].y > lm[bases[i]].y) {
            curledCount++;
        }
    }

    // Also check thumb is curled (thumb tip closer to palm than thumb base)
    const thumbCurled = lm[4].x > lm[3].x || Math.abs(lm[4].x - lm[2].x) < 0.05;

    // Need all 4 fingers curled AND thumb curled for strict fist detection
    return curledCount >= 4 && thumbCurled;
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

// Draw touch zones on canvas
function drawZones(activeZone) {
    Object.entries(zones).forEach(([name, zone]) => {
        const x = zone.x * canvas.width;
        const y = zone.y * canvas.height;
        const w = zone.w * canvas.width;
        const h = zone.h * canvas.height;

        // Get volume percentage for this zone
        let volumePercent = 0;
        if (name === 'drum' && drumVolume) {
            const vol = drumVolume.volume.value;
            volumePercent = Math.round((Math.max(vol, -60) + 60) / 60 * 100);
        } else if (name === 'bass' && bassVolume) {
            const vol = bassVolume.volume.value;
            volumePercent = Math.round((Math.max(vol, -60) + 60) / 60 * 100);
        } else if (name === 'melody' && melodyVolume) {
            const vol = melodyVolume.volume.value;
            volumePercent = Math.round((Math.max(vol, -60) + 60) / 60 * 100);
        } else if (name === 'perc' && percVolume) {
            const vol = percVolume.volume.value;
            volumePercent = Math.round((Math.max(vol, -60) + 60) / 60 * 100);
        }

        // Draw zone background - brightness based on volume
        const alpha = Math.round(0x44 + (0xaa - 0x44) * volumePercent / 100).toString(16).padStart(2, '0');
        ctx.fillStyle = zone.color + alpha;
        ctx.fillRect(x, y, w, h);

        // Highlight if left hand is in this zone
        if (activeZone === name) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, w, h);
        } else {
            ctx.strokeStyle = zone.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
        }

        // Draw label (flip text so it appears correct in mirrored view)
        ctx.save();
        ctx.translate(x + w/2, y + h/2 - 5);
        ctx.scale(-1, 1); // Flip horizontally
        ctx.fillStyle = '#ffffff';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(zone.label, 0, 0);
        ctx.restore();

        // Draw volume percentage (flip text)
        ctx.save();
        ctx.translate(x + w/2, y + h - 8);
        ctx.scale(-1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${volumePercent}%`, 0, 0);
        ctx.restore();
    });
}

// Check which zone the index fingertip (landmark 8) is in
function getZone(lm) {
    // Use index fingertip (landmark 8) instead of wrist (landmark 0)
    const x = lm[8].x;
    const y = lm[8].y;

    for (const [name, zone] of Object.entries(zones)) {
        if (x >= zone.x && x <= zone.x + zone.w &&
            y >= zone.y && y <= zone.y + zone.h) {
            return name;
        }
    }
    return null;
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
            } else {
                leftHandLm = lm;
            }
        }
    }

    // Check which zone left hand is in
    const activeZone = leftHandLm ? getZone(leftHandLm) : null;

    // Draw zones first (behind hands)
    if (isPlaying) {
        drawZones(activeZone);
    }

    // Draw hands on top
    if (rightHandLm) drawHand(rightHandLm, '#00ff00');
    if (leftHandLm) drawHand(leftHandLm, '#ff6600');

    // Check for DJ scratch mode: both hands fist
    const rightFist = rightHandLm ? isFist(rightHandLm) : false;
    const leftFist = leftHandLm ? isFist(leftHandLm) : false;

    // DJ Reverse: both hands fist + right hand swipe left = reverse
    if (rightFist && leftFist && rightHandLm && isPlaying) {
        const currentX = rightHandLm[0].x;

        if (prevRightHandX !== null) {
            const dx = currentX - prevRightHandX;
            if (dx > 0.005) {
                // Moving left - reverse playback, speed based on movement
                const speed = Math.min(dx * 80, 5);
                if (!isScratchMode) {
                    setAllReverse(true);
                    isScratchMode = true;
                }
                setAllPlaybackRate(speed);
                info.textContent = `🎧 DJ REVERSE! ⏪ ${speed.toFixed(1)}x`;
            } else {
                // Not moving left - normal playback
                if (isScratchMode) {
                    setAllReverse(false);
                    setAllPlaybackRate(1);
                    isScratchMode = false;
                }
                info.textContent = `🤛🤛 Scratch ready (swipe right hand left)`;
            }
        } else {
            info.textContent = `🤛🤛 Scratch ready (swipe right hand left)`;
        }

        prevRightHandX = currentX;
        prevRightHandY = null; // Reset swipe tracking when in scratch mode
    } else {
        // Not in scratch gesture - resume normal playback
        if (isScratchMode) {
            setAllReverse(false);
            isScratchMode = false;
        }
        setAllPlaybackRate(1);
        prevRightHandX = null;

        // Left hand in zone + right hand up/down to adjust volume
        if (activeZone && rightHandLm && isPlaying) {
            const currentY = rightHandLm[0].y;

            if (prevRightHandY !== null) {
                const dy = currentY - prevRightHandY;

                // Get current volume node
                let volumeNode = null;
                let label = '';
                if (activeZone === 'drum') {
                    volumeNode = drumVolume;
                    label = '🥁';
                } else if (activeZone === 'bass') {
                    volumeNode = bassVolume;
                    label = '🎸';
                } else if (activeZone === 'melody') {
                    volumeNode = melodyVolume;
                    label = '🎹';
                } else if (activeZone === 'perc') {
                    volumeNode = percVolume;
                    label = '🔔';
                }

                if (volumeNode && Math.abs(dy) > 0.005) {
                    // Get current volume (handle -Infinity)
                    let currentVol = volumeNode.volume.value;
                    if (currentVol < -60) currentVol = -60;

                    // Adjust volume: up = increase, down = decrease (larger change)
                    const volumeChange = -dy * 200; // Invert: moving up (negative dy) increases volume
                    let newVol = currentVol + volumeChange;

                    // Clamp volume between -60 and 0
                    newVol = Math.max(-60, Math.min(0, newVol));

                    volumeNode.volume.value = newVol;

                    // Show volume as percentage (0-100)
                    const volumePercent = Math.round((newVol + 60) / 60 * 100);
                    info.textContent = `${label} Volume: ${volumePercent}%`;
                }
            }

            prevRightHandY = currentY;
        } else {
            prevRightHandY = null;

            // Melody filter control: detect if thumb is on left or right side of palm
            if (rightHandLm && melodyFilter && isPlaying) {
                // Compare X position of thumb tip (4) vs pinky base (17)
                // Right hand from camera view (which is "Left" in handedness due to mirror):
                // Palm facing screen: thumb X < pinky X (thumb on left side)
                // Back of hand facing screen: thumb X > pinky X (thumb on right side)
                const thumbX = rightHandLm[4].x;
                const pinkyBaseX = rightHandLm[17].x;
                const xDiff = thumbX - pinkyBaseX;

                // xDiff: negative = palm facing, positive = back facing
                // Map to 0-1 range (roughly -0.15 to +0.15)
                const rotation = Math.max(0, Math.min(1, (xDiff + 0.15) / 0.3));

                const minFreq = 200;
                const maxFreq = 20000;
                // Back facing (thumb right) = high freq, palm facing (thumb left) = low freq
                const freq = minFreq * Math.pow(maxFreq / minFreq, rotation);
                melodyFilter.frequency.value = freq;

                if (!leftHandLm) {
                    info.textContent = `🎹 Filter: ${Math.round(freq)} Hz`;
                }
            }

            if (!rightHandLm && !leftHandLm && isPlaying) {
                info.textContent = 'Move left finger to a zone';
            } else if (isPlaying && leftHandLm && !activeZone && !rightHandLm) {
                info.textContent = 'Move left finger to a zone';
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

    // Volume controls - all start at -60 dB (0%), except Pad at 0 dB (100%)
    drumVolume = new Tone.Volume(-60).toDestination();
    bassVolume = new Tone.Volume(-60).toDestination();
    melodyVolume = new Tone.Volume(-60).toDestination();
    padVolume = new Tone.Volume(-10).toDestination(); // Pad starts at 100%
    percVolume = new Tone.Volume(-60).toDestination();

    // Low-pass filter for melody (controlled by right hand wrist Y position)
    melodyFilter = new Tone.Filter(20000, "lowpass").connect(melodyVolume);

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
        }).connect(bassVolume);
    }

    if (trackBuffers.melody) {
        melodyPlayer = new Tone.Player({
            url: trackBuffers.melody,
            loop: true
        }).connect(melodyFilter); // Connect through filter instead of directly to volume
    }

    if (trackBuffers.pad) {
        padPlayer = new Tone.Player({
            url: trackBuffers.pad,
            loop: true
        }).connect(padVolume);
    }

    if (trackBuffers.perc) {
        percPlayer = new Tone.Player({
            url: trackBuffers.perc,
            loop: true
        }).connect(percVolume);
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
    isScratchMode = false;
    prevRightHandX = null;
    prevRightHandY = null;

    // Stop all players
    if (drumPlayer) { drumPlayer.stop(); drumPlayer.dispose(); drumPlayer = null; }
    if (bassPlayer) { bassPlayer.stop(); bassPlayer.dispose(); bassPlayer = null; }
    if (melodyPlayer) { melodyPlayer.stop(); melodyPlayer.dispose(); melodyPlayer = null; }
    if (padPlayer) { padPlayer.stop(); padPlayer.dispose(); padPlayer = null; }
    if (percPlayer) { percPlayer.stop(); percPlayer.dispose(); percPlayer = null; }
    if (drumVolume) { drumVolume.dispose(); drumVolume = null; }
    if (bassVolume) { bassVolume.dispose(); bassVolume = null; }
    if (melodyFilter) { melodyFilter.dispose(); melodyFilter = null; }
    if (melodyVolume) { melodyVolume.dispose(); melodyVolume = null; }
    if (padVolume) { padVolume.dispose(); padVolume = null; }
    if (percVolume) { percVolume.dispose(); percVolume = null; }

    // Release blob URLs and reset track buffers
    Object.keys(trackBuffers).forEach(key => {
        if (trackBuffers[key]) {
            URL.revokeObjectURL(trackBuffers[key]);
            trackBuffers[key] = null;
        }
    });

    // Reset status indicators
    drumStatus.classList.remove('loaded');
    bassStatus.classList.remove('loaded');
    melodyStatus.classList.remove('loaded');
    padStatus.classList.remove('loaded');
    percStatus.classList.remove('loaded');

    // Reset file inputs
    drumFile.value = '';
    bassFile.value = '';
    melodyFile.value = '';
    padFile.value = '';
    percFile.value = '';

    // Disable start button
    startBtn.disabled = true;

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
