/* ===========================================================
   LIVING GARDEN — Gesture-Grown Generative Flower Garden
   ===========================================================
   v2 rebuild of the original Flower Bloom controller.

   Old mechanic: hold two pinches, directly puppet one flower.
   New mechanic: plant seeds with a gesture, then the garden
   grows and lives on its own — you tend it, you don't puppet it.

   Controls:
     - Pinch fingers together, then flick them open fast
       -> plants a seed at that hand's position
     - Hold an open palm near a grown flower -> it blooms
     - Bring both hands together fast (clap) -> fertilizer burst:
       boosts the whole garden's growth/bloom + particle burst + wind gust
     - Flowers keep swaying and pulsing on their own once mature —
       the garden persists and feels alive even with no hands in frame.

   Built with MediaPipe Hands + Canvas 2D. No backend, no build step.
   =========================================================== */

// =============================================================
// NOISE — Organic movement via layered sine waves
// =============================================================
class OrganicNoise {
    constructor() {
        this.seeds = Array.from({ length: 8 }, () => Math.random() * 1000);
    }

    /** Returns a value roughly in [-1, 1]. `channel` selects an independent phase. */
    get(t, channel = 0) {
        const s = this.seeds[((channel % this.seeds.length) + this.seeds.length) % this.seeds.length];
        return (
            Math.sin(t * 0.7 + s) * 0.4 +
            Math.sin(t * 1.3 + s * 1.7) * 0.3 +
            Math.sin(t * 2.1 + s * 0.3) * 0.2 +
            Math.sin(t * 3.7 + s * 2.1) * 0.1
        );
    }
}

// =============================================================
// PARTICLE — Floating pollen / sparkle (ambient pool, recycled forever)
// =============================================================
class Particle {
    constructor(cw, ch) {
        this.cw = cw;
        this.ch = ch;
        this.reset(true);
    }

    reset(initial = false) {
        this.x = Math.random() * this.cw;
        this.y = initial ? Math.random() * this.ch : this.ch + Math.random() * 40;
        this.radius = Math.random() * 2.5 + 0.5;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = -(Math.random() * 0.6 + 0.15);
        this.life = Math.random() * 300 + 150;
        this.maxLife = this.life;
        this.hue = 330 + Math.random() * 40;
        this.brightness = 70 + Math.random() * 20;
        this.flickerPhase = Math.random() * Math.PI * 2;
    }

    update(windForce, dt) {
        this.x += this.vx + windForce * 1.8;
        this.y += this.vy;
        this.life -= dt;
        if (this.life <= 0 || this.y < -20 || this.x < -20 || this.x > this.cw + 20) {
            this.reset();
        }
    }

    draw(ctx) {
        const t = this.life / this.maxLife;
        const flicker = 0.5 + 0.5 * Math.sin(this.life * 0.08 + this.flickerPhase);
        const alpha = t * 0.75 * flicker;
        if (alpha < 0.02) return;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowBlur = 12;
        ctx.shadowColor = `hsla(${this.hue}, 100%, ${this.brightness}%, 0.8)`;
        ctx.fillStyle = `hsla(${this.hue}, 90%, ${this.brightness}%, 1)`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// =============================================================
// BURST PARTICLE — one-shot radial spark for the fertilizer clap
// =============================================================
class BurstParticle {
    constructor(x, y, hue) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 4;
        this.x = x;
        this.y = y;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - 1.5; // slight upward bias
        this.radius = Math.random() * 2 + 1.2;
        this.life = 60 + Math.random() * 40;
        this.maxLife = this.life;
        this.hue = hue + (Math.random() - 0.5) * 30;
        this.drag = 0.94;
    }

    update(dt) {
        this.vx *= Math.pow(this.drag, dt);
        this.vy = this.vy * Math.pow(this.drag, dt) + 0.05 * dt; // gentle gravity
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
    }

    get dead() {
        return this.life <= 0;
    }

    draw(ctx) {
        const t = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = t;
        ctx.shadowBlur = 14;
        ctx.shadowColor = `hsla(${this.hue}, 100%, 70%, 0.9)`;
        ctx.fillStyle = `hsla(${this.hue}, 100%, 75%, 1)`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * t, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// =============================================================
// GARDEN FLOWER — a single planted, self-growing flower
// =============================================================
class GardenFlower {
    constructor(xFrac, id) {
        this.xFrac = xFrac;       // horizontal position as a fraction of canvas width (resize-safe)
        this.id = id;             // used to pick a unique noise channel
        this.growth = 0;          // 0 -> 1, climbs on its own over time
        this.bloom = 0;           // 0 -> 1, smoothed, driven by hand proximity + ambient pulse
        this.heightFrac = 0.22 + Math.random() * 0.14;   // final stem height as fraction of canvas height
        this.sizeVar = 0.7 + Math.random() * 0.6;        // flower head scale variation
        this.hue = 320 + Math.random() * 70;             // per-flower color variety
        this.growthRate = 0.00065 + Math.random() * 0.00035; // per-ms base growth
        this.plantedAt = performance.now();
        this.fertilizeBoost = 0; // temporary extra growth speed after a clap
    }

    tipPosition(cw, ch) {
        return {
            x: this.xFrac * cw,
            y: ch * 0.985 - this.heightFrac * ch * this.growth,
        };
    }
}

// =============================================================
// MAIN APPLICATION
// =============================================================
class LivingGardenApp {
    constructor() {
        // DOM
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.video = document.getElementById('webcam');
        this.loadingEl = document.getElementById('loading');
        this.instructionsEl = document.getElementById('instructions');

        // Noise
        this.noise = new OrganicNoise();

        // Time
        this.time = 0;
        this.lastTimestamp = 0;

        // Wind
        this.windForce = 0;
        this.targetWindForce = 0;

        // Hand tracking state
        this.handLandmarks = [];
        this.handHandedness = [];
        this.handsDetected = 0;

        // Per-hand gesture state, keyed by 'Left' / 'Right'
        this.handState = {
            Left: this.freshHandState(),
            Right: this.freshHandState(),
        };
        this.recentMaxPalmDist = 0;
        this.lastClapTime = -Infinity;
        this.lastFlashTime = -Infinity;

        // Garden
        this.garden = [];
        this.maxGardenFlowers = 10;

        // Particle pools
        this.particles = [];
        this.burstParticles = [];

        // Setup
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.initParticles();
        this.initHandTracking();

        setTimeout(() => {
            this.instructionsEl?.classList.add('hidden');
        }, 9000);

        requestAnimationFrame((ts) => this.animate(ts));
    }

    freshHandState() {
        return {
            present: false,
            openness: 0,      // smoothed pinch-openness, 0 = pinched, 1 = spread
            prevOpenness: 0,
            isFist: false,
            lastPlantTime: -Infinity,
            palmPixel: { x: 0, y: 0 },
            palmNorm: { x: 0.5, y: 0.5 },
        };
    }

    // ---------------------------------------------------------
    // Setup
    // ---------------------------------------------------------
    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        for (const p of this.particles) {
            p.cw = this.canvas.width;
            p.ch = this.canvas.height;
        }
    }

    initParticles() {
        const count = 50;
        for (let i = 0; i < count; i++) {
            this.particles.push(new Particle(this.canvas.width, this.canvas.height));
        }
    }

    initHandTracking() {
        const hands = new Hands({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
        });

        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.65,
            minTrackingConfidence: 0.5,
        });

        hands.onResults((r) => this.onHandResults(r));

        const cam = new Camera(this.video, {
            onFrame: async () => {
                await hands.send({ image: this.video });
            },
            width: 1280,
            height: 720,
        });

        cam.start().then(() => {
            setTimeout(() => this.loadingEl?.classList.add('hidden'), 600);
        }).catch((err) => {
            console.error('Camera failed to start:', err);
            if (this.loadingEl) {
                const sub = this.loadingEl.querySelector('.loading-subtext');
                if (sub) sub.textContent = 'Camera access denied or unavailable';
            }
        });
    }

    // ---------------------------------------------------------
    // Gesture math
    // ---------------------------------------------------------

    /**
     * Pinch openness: distance between thumb tip (4) and index fingertip (8),
     * normalized by hand size. Returns 0 (pinched) -> 1 (fully spread).
     */
    calcOpenness(lm) {
        const thumb = lm[4];
        const index = lm[8];
        const wrist = lm[0];
        const mcp = lm[9];

        const ref = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
        if (ref < 0.01) return 0;

        const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
        return Math.min(1, Math.max(0, (dist / ref - 0.15) * 1.6));
    }

    /** Rough palm center (average of wrist + MCP joints), normalized coords */
    palmCenter(lm) {
        const ids = [0, 5, 9, 13, 17];
        let x = 0, y = 0;
        for (const i of ids) { x += lm[i].x; y += lm[i].y; }
        return { x: x / ids.length, y: y / ids.length };
    }

    /** True if index/middle/ring/pinky are all curled toward the palm (a fist) */
    calcIsFist(lm) {
        const wrist = lm[0];
        const pairs = [[5, 8], [9, 12], [13, 16], [17, 20]];
        let folded = 0;
        for (const [mcpId, tipId] of pairs) {
            const mcp = lm[mcpId];
            const tip = lm[tipId];
            const distTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
            const distMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
            if (distTip < distMcp * 1.08) folded++;
        }
        return folded >= 3;
    }

    // ---------------------------------------------------------
    // Hand results callback — this is where gestures become events
    // ---------------------------------------------------------
    onHandResults(results) {
        this.handLandmarks = results.multiHandLandmarks || [];
        this.handHandedness = results.multiHandedness || [];
        this.handsDetected = this.handLandmarks.length;

        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const now = performance.now();

        this.handState.Left.present = false;
        this.handState.Right.present = false;

        let windSum = 0;
        let windCount = 0;

        for (let i = 0; i < this.handsDetected; i++) {
            const lm = this.handLandmarks[i];
            const handedness = this.handHandedness[i];
            const label = (handedness && handedness.label === 'Left') ? 'Left' : 'Right';
            const state = this.handState[label];

            const openness = this.calcOpenness(lm);
            const palmNorm = this.palmCenter(lm);
            const palmPixel = { x: palmNorm.x * cw, y: palmNorm.y * ch };
            const isFist = this.calcIsFist(lm);

            // Wind: horizontal palm velocity, per-hand, summed then averaged
            if (state.present || state.palmNorm) {
                const dx = palmNorm.x - state.palmNorm.x;
                windSum += dx * 14;
                windCount++;
            }

            // --- Seed planting: pinch closed -> flick open fast ---
            if (state.prevOpenness < 0.18 && openness > 0.58 &&
                (now - state.lastPlantTime) > 1100) {
                this.plantSeed(palmNorm.x);
                state.lastPlantTime = now;
            }

            state.prevOpenness = openness;
            state.openness = openness;
            state.isFist = isFist;
            state.palmPixel = palmPixel;
            state.palmNorm = palmNorm;
            state.present = true;
        }

        this.targetWindForce = windCount > 0 ? windSum / windCount : this.targetWindForce * 0.9;

        // --- Clap detection: both hands present, fast approach, then close ---
        if (this.handState.Left.present && this.handState.Right.present) {
            const L = this.handState.Left.palmNorm;
            const R = this.handState.Right.palmNorm;
            const dist = Math.hypot(L.x - R.x, L.y - R.y);

            this.recentMaxPalmDist = Math.max(dist, this.recentMaxPalmDist * 0.93);

            if (dist < 0.09 && this.recentMaxPalmDist > 0.24 &&
                (now - this.lastClapTime) > 1200) {
                const midX = (this.handState.Left.palmPixel.x + this.handState.Right.palmPixel.x) / 2;
                const midY = (this.handState.Left.palmPixel.y + this.handState.Right.palmPixel.y) / 2;
                this.triggerFertilizeBurst(midX, midY);
                this.lastClapTime = now;
                this.recentMaxPalmDist = 0;
            }
        } else {
            this.recentMaxPalmDist *= 0.9;
        }

        if (this.handsDetected === 0) {
            this.targetWindForce *= 0.9;
        }
    }

    // ---------------------------------------------------------
    // Garden events
    // ---------------------------------------------------------
    plantSeed(xFrac) {
        const flower = new GardenFlower(xFrac, this.garden.length + Math.floor(Math.random() * 1000));
        this.garden.push(flower);
        if (this.garden.length > this.maxGardenFlowers) {
            this.garden.shift(); // oldest flower makes way for the new one
        }
        // small sparkle to confirm the plant
        for (let i = 0; i < 8; i++) {
            this.burstParticles.push(new BurstParticle(xFrac * this.canvas.width, this.canvas.height * 0.985, 140));
        }
    }

    triggerFertilizeBurst(x, y) {
        for (const flower of this.garden) {
            flower.fertilizeBoost = 0.35;
            flower.growth = Math.min(1, flower.growth + 0.12);
        }
        this.targetWindForce += (Math.random() - 0.5) * 6;
        const count = 32;
        for (let i = 0; i < count; i++) {
            this.burstParticles.push(new BurstParticle(x, y, 50 + Math.random() * 40));
        }
        this.lastFlashTime = performance.now();
    }

    // =============================================================
    // RENDERING
    // =============================================================

    // ----- Hand Skeleton + live gesture label -----
    drawHandSkeleton(lm, handedness) {
        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        const thumbTip = lm[4];
        const indexTip = lm[8];
        if (!thumbTip || !indexTip) return;

        const tx = thumbTip.x * cw;
        const ty = thumbTip.y * ch;
        const ix = indexTip.x * cw;
        const iy = indexTip.y * ch;

        const label = (handedness && handedness.label === 'Left') ? 'Left' : 'Right';
        const state = this.handState[label];

        let labelText = '✋ Open';
        let glowColor = 'rgba(140, 200, 255, 0.85)';
        let strokeStyle = '#8cc8ff';
        if (state.isFist) {
            labelText = '✊ Fist';
            glowColor = 'rgba(255, 180, 90, 0.85)';
            strokeStyle = '#ffb45a';
        } else if (state.openness < 0.22) {
            labelText = '🤏 Pinched';
            glowColor = 'rgba(255, 80, 130, 0.85)';
            strokeStyle = '#ff5082';
        } else if (state.openness > 0.55) {
            labelText = '🌱 Plant / Bloom';
            glowColor = 'rgba(56, 193, 114, 0.85)';
            strokeStyle = '#38c172';
        }

        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = strokeStyle;
        ctx.shadowBlur = 8;
        ctx.shadowColor = glowColor;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ix, iy);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = glowColor;
        ctx.fillStyle = strokeStyle;
        ctx.beginPath();
        ctx.arc(tx, ty, 6, 0, Math.PI * 2);
        ctx.arc(ix, iy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        const midX = (tx + ix) / 2;
        const midY = (ty + iy) / 2;

        ctx.save();
        // Counter-flip so the label reads correctly despite the mirrored canvas
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);

        ctx.font = 'bold 12px Inter, sans-serif';
        const textWidth = ctx.measureText(labelText).width;
        const paddingX = 10;
        const pillWidth = textWidth + paddingX * 2;
        const pillHeight = 22;

        const drawX = cw - midX;
        const drawY = midY - 20;

        ctx.fillStyle = 'rgba(10, 5, 20, 0.8)';
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 6;
        ctx.shadowColor = glowColor;
        ctx.beginPath();
        ctx.roundRect(drawX - pillWidth / 2, drawY - pillHeight / 2, pillWidth, pillHeight, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, drawX, drawY);

        ctx.restore();
    }

    // ----- Stem -----
    drawStem(baseX, baseY, height, windAngle, channelOffset) {
        const ctx = this.ctx;
        const segs = 20;
        const segH = height / segs;

        const pts = [{ x: baseX, y: baseY }];
        for (let i = 1; i <= segs; i++) {
            const t = i / segs;
            const windBend = windAngle * t * t * 36;
            const sway = this.noise.get(this.time * 0.6 + i * 0.25, channelOffset) * 9 * t;
            pts.push({
                x: baseX + windBend + sway,
                y: baseY - segH * i,
            });
        }

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.lineWidth = 4.5;
        ctx.strokeStyle = 'rgba(40, 120, 35, 0.22)';
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(80, 180, 60, 0.28)';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        ctx.lineWidth = 2.6;
        ctx.strokeStyle = '#3a8a30';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        this.drawLeaves(pts, channelOffset);

        ctx.restore();

        return { tip: pts[pts.length - 1], pts };
    }

    drawLeaves(stemPts, channelOffset) {
        const ctx = this.ctx;
        const positions = [0.35, 0.65];

        for (let li = 0; li < positions.length; li++) {
            const idx = Math.floor(positions[li] * (stemPts.length - 1));
            const pt = stemPts[idx];
            if (!pt) continue;
            const side = li % 2 === 0 ? 1 : -1;
            const len = 14 + 8 * li;
            const angle = side * (0.45 + this.noise.get(this.time * 0.6 + li * 3, channelOffset + 1) * 0.2);

            ctx.save();
            ctx.translate(pt.x, pt.y);
            ctx.rotate(angle);

            const grad = ctx.createLinearGradient(0, 0, len, 0);
            grad.addColorStop(0, 'rgba(55, 140, 45, 0.8)');
            grad.addColorStop(1, 'rgba(75, 170, 60, 0.4)');
            ctx.fillStyle = grad;
            ctx.shadowBlur = 4;
            ctx.shadowColor = 'rgba(80, 200, 60, 0.25)';

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(len * 0.5, -8, len, -1);
            ctx.quadraticCurveTo(len * 0.5, 8, 0, 0);
            ctx.fill();

            ctx.strokeStyle = 'rgba(90, 180, 70, 0.3)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(3, 0);
            ctx.lineTo(len * 0.8, 0);
            ctx.stroke();

            ctx.restore();
        }
    }

    // ----- Flower Head (tulip, per-flower hue/scale/channel) -----
    drawFlowerHead(cx, cy, bloom, windAngle, scale, hue, channelOffset) {
        const bloomScaleFactor = 1.0 + bloom * 0.18;
        const adjustedScale = scale * bloomScaleFactor;
        const ctx = this.ctx;

        ctx.save();
        ctx.translate(cx, cy);

        const sat = 85;
        const light = 55;

        const glowR = (50 + bloom * 100) * adjustedScale;
        if (bloom > 0.02) {
            const glow = ctx.createRadialGradient(0, -glowR * 0.4, 0, 0, -glowR * 0.4, glowR);
            glow.addColorStop(0, `hsla(${hue}, 100%, 65%, ${0.4 * bloom})`);
            glow.addColorStop(0.5, `hsla(${hue}, 100%, 55%, ${0.2 * bloom})`);
            glow.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(0, -glowR * 0.4, glowR, 0, Math.PI * 2);
            ctx.fill();
        }

        const backPetals = [
            { angle: 0, lengthMul: 1.0, widthMul: 0.4, hueOffset: 0, lightOffset: -4 },
            { angle: -0.15 - bloom * 0.7, lengthMul: 0.95, widthMul: 0.38, hueOffset: 10, lightOffset: -2 },
            { angle: 0.15 + bloom * 0.7, lengthMul: 0.95, widthMul: 0.38, hueOffset: 10, lightOffset: -2 }
        ];
        const frontPetals = [
            { angle: -0.05 - bloom * 0.55, lengthMul: 0.9, widthMul: 0.35, hueOffset: 5, lightOffset: 2 },
            { angle: 0.05 + bloom * 0.55, lengthMul: 0.9, widthMul: 0.35, hueOffset: 5, lightOffset: 2 },
            { angle: 0, lengthMul: 0.85, widthMul: 0.32, hueOffset: -5, lightOffset: 5 }
        ];

        const maxPetalLen = 62 * adjustedScale;

        for (const p of backPetals) {
            const flutter = this.noise.get(this.time * 1.2 + p.angle * 10, channelOffset) * 0.04 * (1 + bloom);
            const finalAngle = p.angle + flutter + windAngle * 0.1;
            const len = maxPetalLen * p.lengthMul;
            const wid = maxPetalLen * p.widthMul * (0.6 + bloom * 0.8);
            this.drawTulipPetal(ctx, finalAngle, len, wid, hue + p.hueOffset, sat, light + p.lightOffset, bloom);
        }

        if (bloom > 0.15) {
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.fillStyle = `rgba(180, 220, 100, ${bloom})`;
            ctx.beginPath();
            ctx.arc(0, -maxPetalLen * 0.2, 4 * adjustedScale, 0, Math.PI * 2);
            ctx.fill();

            const stamenCount = 4;
            for (let i = 0; i < stamenCount; i++) {
                const a = (i / stamenCount) * Math.PI * 2 + this.time * 0.5;
                const r = 6 * adjustedScale * bloom;
                const sx = Math.cos(a) * r;
                const sy = -maxPetalLen * 0.2 + Math.sin(a) * r;

                ctx.strokeStyle = `rgba(220, 200, 80, ${bloom * 0.7})`;
                ctx.lineWidth = 1.2 * adjustedScale;
                ctx.beginPath();
                ctx.moveTo(0, -maxPetalLen * 0.1);
                ctx.lineTo(sx, sy);
                ctx.stroke();

                ctx.fillStyle = `rgba(255, 235, 120, ${bloom})`;
                ctx.beginPath();
                ctx.arc(sx, sy, 2 * adjustedScale, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        for (const p of frontPetals) {
            const flutter = this.noise.get(this.time * 1.4 + p.angle * 10, channelOffset + 1) * 0.03 * (1 + bloom);
            const finalAngle = p.angle + flutter + windAngle * 0.05;
            const len = maxPetalLen * p.lengthMul;
            const wid = maxPetalLen * p.widthMul * (0.65 + bloom * 0.75);
            this.drawTulipPetal(ctx, finalAngle, len, wid, hue + p.hueOffset, sat, light + p.lightOffset, bloom);
        }

        ctx.restore();
    }

    drawTulipPetal(ctx, angle, length, width, hue, sat, light, bloom) {
        ctx.save();
        ctx.rotate(angle);

        const grad = ctx.createLinearGradient(0, 0, 0, -length);
        grad.addColorStop(0, `hsla(${hue + 25}, ${sat}%, ${light - 8}%, 0.9)`);
        grad.addColorStop(0.4, `hsla(${hue}, ${sat}%, ${light}%, 0.85)`);
        grad.addColorStop(0.85, `hsla(${hue - 10}, ${sat + 10}%, ${light + 10}%, 0.85)`);
        grad.addColorStop(1, `hsla(${hue - 20}, ${sat + 15}%, ${light + 18}%, 0.95)`);

        ctx.fillStyle = grad;
        ctx.shadowBlur = 10 + bloom * 16;
        ctx.shadowColor = `hsla(${hue}, 100%, 65%, ${0.25 + bloom * 0.4})`;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-width * 1.1, -length * 0.3, -width * 0.9, -length * 0.85, 0, -length);
        ctx.bezierCurveTo(width * 0.9, -length * 0.85, width * 1.1, -length * 0.3, 0, 0);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = `hsla(${hue + 15}, ${sat}%, ${light + 15}%, 0.25)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -length * 0.85);
        ctx.stroke();

        ctx.restore();
    }

    // ----- One garden flower, fully assembled -----
    drawGardenFlower(flower, cw, ch, totalWind) {
        if (flower.growth < 0.01) return;

        const baseX = flower.xFrac * cw;
        const baseY = ch * 0.985;
        const stemH = flower.heightFrac * ch * flower.growth;
        const scale = 0.85 * flower.sizeVar * flower.growth;
        const channel = flower.id;

        const stemData = this.drawStem(baseX, baseY, stemH, totalWind, channel);
        const tip = stemData.tip;

        this.drawFlowerHead(tip.x, tip.y, flower.bloom, totalWind, scale, flower.hue, channel);
        this.drawPostGlow(tip.x, tip.y, flower.bloom, flower.hue);
    }

    // ----- Post-process Glow -----
    drawPostGlow(cx, cy, bloom, hue) {
        if (bloom < 0.05) return;
        const ctx = this.ctx;

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const r = 90 + bloom * 130;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `hsla(${hue}, 100%, 65%, ${bloom * 0.18})`);
        g.addColorStop(0.5, `hsla(${hue}, 100%, 55%, ${bloom * 0.08})`);
        g.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // ----- Screen flash for the fertilizer clap -----
    drawFertilizeFlash() {
        const elapsed = performance.now() - this.lastFlashTime;
        if (elapsed > 400) return;
        const ctx = this.ctx;
        const alpha = 0.12 * (1 - elapsed / 400);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255, 230, 180, ${alpha})`;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
    }

    // ----- HUD Overlay -----
    drawHUD() {
        const ctx = this.ctx;
        const cw = this.canvas.width;

        ctx.save();
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);

        ctx.font = '600 15px Inter, sans-serif';
        ctx.textAlign = 'left';

        const px = 20;
        const py = 22;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.roundRect(px - 10, py - 14, 190, 78, 10);
        ctx.fill();

        ctx.fillStyle = 'rgba(180, 255, 180, 0.95)';
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(120, 255, 120, 0.4)';
        ctx.fillText(`🌸 Garden: ${this.garden.length}/${this.maxGardenFlowers}`, px, py + 6);

        ctx.fillStyle = 'rgba(140, 200, 255, 0.95)';
        ctx.shadowColor = 'rgba(80, 150, 255, 0.4)';
        ctx.fillText(`Wind: ${this.windForce.toFixed(2)}`, px, py + 28);

        ctx.fillStyle = 'rgba(255, 210, 140, 0.95)';
        ctx.shadowColor = 'rgba(255, 180, 90, 0.4)';
        const sinceClap = (performance.now() - this.lastClapTime) / 1000;
        ctx.fillText(sinceClap < 2 ? '✨ Fertilized!' : 'Clap to fertilize', px, py + 50);

        ctx.restore();
    }

    // =============================================================
    // ANIMATION LOOP
    // =============================================================
    animate(timestamp) {
        const dt = this.lastTimestamp ? (timestamp - this.lastTimestamp) / 16.67 : 1;
        this.lastTimestamp = timestamp;
        this.time += 0.016 * dt;

        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const now = performance.now();

        // ---- Wind smoothing ----
        this.windForce += (this.targetWindForce - this.windForce) * 0.06 * dt;
        const naturalWind = this.noise.get(this.time * 0.7, 6) * 0.1;
        const totalWind = naturalWind + this.windForce * 0.16;

        // ---- Garden growth + bloom update ----
        const dtMs = dt * 16.67;
        for (const flower of this.garden) {
            const rate = flower.growthRate + flower.fertilizeBoost * 0.001;
            flower.growth = Math.min(1, flower.growth + rate * dtMs);
            flower.fertilizeBoost *= 0.98;

            // Ambient pulse once mature; boosted further by nearby open hands
            const ambient = flower.growth > 0.8
                ? 0.12 + 0.1 * (0.5 + 0.5 * this.noise.get(this.time * 0.5, flower.id + 2))
                : flower.growth * 0.08;

            let proximityTarget = 0;
            const tip = flower.tipPosition(cw, ch);
            for (const label of ['Left', 'Right']) {
                const state = this.handState[label];
                if (!state.present || state.isFist) continue;
                if (state.openness < 0.35) continue; // only an open hand nurtures bloom
                const d = Math.hypot(state.palmPixel.x - tip.x, state.palmPixel.y - tip.y);
                const radius = 150;
                if (d < radius) {
                    proximityTarget = Math.max(proximityTarget, 1 - d / radius);
                }
            }

            const targetBloom = Math.max(ambient, proximityTarget);
            flower.bloom += (targetBloom - flower.bloom) * 0.08 * dt;
        }

        // ---- Clear ----
        ctx.clearRect(0, 0, cw, ch);

        // ---- Hand skeletons ----
        for (let i = 0; i < this.handLandmarks.length; i++) {
            this.drawHandSkeleton(this.handLandmarks[i], this.handHandedness[i]);
        }

        // ---- Ambient particles ----
        for (const p of this.particles) {
            p.update(totalWind, dt);
            p.draw(ctx);
        }

        // ---- Burst particles (fertilizer / planting sparkle) ----
        for (let i = this.burstParticles.length - 1; i >= 0; i--) {
            const bp = this.burstParticles[i];
            bp.update(dt);
            if (bp.dead) {
                this.burstParticles.splice(i, 1);
            } else {
                bp.draw(ctx);
            }
        }

        // ---- Garden ----
        for (const flower of this.garden) {
            this.drawGardenFlower(flower, cw, ch, totalWind);
        }

        // ---- Fertilizer flash ----
        this.drawFertilizeFlash();

        // ---- HUD ----
        this.drawHUD();

        requestAnimationFrame((ts) => this.animate(ts));
    }
}

// =============================================================
// BOOT
// =============================================================
window.addEventListener('DOMContentLoaded', () => {
    new LivingGardenApp();
});
