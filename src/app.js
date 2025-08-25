"use strict";

// ====== DOM ======
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const camVideo  = document.getElementById("cam");

const centerOverlay = document.getElementById("centerOverlay");
const enableCamBtn  = document.getElementById("enableCamBtn");

const infoBtn   = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeInfo = document.getElementById("closeInfo");

const audioBtn  = document.getElementById("audioBtn");

// ====== Canvas DPI ======
function resize(){
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    canvas.style.width = "100vw"; canvas.style.height = "100vh";
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
}
resize(); addEventListener("resize", resize);

// ====== Webcam → beweging (frame differencing) ======
let camStream = null, camOn = false;
let motionCanvas = null, motionCtx = null, prevFrame = null;

const MOTION_SCALE = 4;
const BLOCK = 8;
const MOTION_THRESH = 28;

let motionIntensity = 0;        // 0..1 (hoeveel beweegt er)
let motionCenterX  = 0.5;       // 0..1 (links→rechts zwaartepunt)
let motionCenterY  = 0.5;       // 0..1 (boven→onder zwaartepunt)

const lerp = (a,b,t)=> a + (b-a)*t;

async function enableCamera(){
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:"user", width:{ideal:640}, height:{ideal:480} },
      audio: false
    });
    camVideo.srcObject = camStream;
    await camVideo.play().catch(()=>{});
    camOn = true;

    const w = Math.max(160, Math.floor(canvas.width / MOTION_SCALE));
    const h = Math.max(120, Math.floor(canvas.height / MOTION_SCALE));
    motionCanvas = document.createElement("canvas");
    motionCanvas.width = w; motionCanvas.height = h;
    motionCtx = motionCanvas.getContext("2d", { willReadFrequently:true });
    prevFrame = motionCtx.createImageData(w, h);

    // start audio na user gesture
    initAudio();
    audioOn = true;
    audioBtn.classList.add("on");

    centerOverlay.style.display = "none";
  } catch {
    alert("Camera-toegang geweigerd of niet beschikbaar.");
  }
}

function analyzeMotion(){
  if (!camOn || !camVideo.videoWidth) {
    motionIntensity = lerp(motionIntensity, 0, 0.02);
    motionCenterX   = lerp(motionCenterX, 0.5, 0.02);
    motionCenterY   = lerp(motionCenterY, 0.5, 0.02);
    return;
  }

  const mw = motionCanvas.width, mh = motionCanvas.height;
  motionCtx.drawImage(camVideo, 0, 0, mw, mh);
  const curr = motionCtx.getImageData(0, 0, mw, mh);

  let hits = 0, sumX = 0, sumY = 0;

  for (let y=0; y<mh; y+=BLOCK){
    for (let x=0; x<mw; x+=BLOCK){
      let diffSum = 0, n=0;
      for (let by=0; by<BLOCK && y+by<mh; by++){
        const row = (y+by)*mw*4;
        for (let bx=0; bx<BLOCK && x+bx<mw; bx++){
          const i = row + (x+bx)*4;
          const l1 = (prevFrame.data[i]*0.2126 + prevFrame.data[i+1]*0.7152 + prevFrame.data[i+2]*0.0722) || 0;
          const l2 = (curr.data[i]*0.2126 + curr.data[i+1]*0.7152 + curr.data[i+2]*0.0722);
          diffSum += Math.abs(l2 - l1);
          n++;
        }
      }
      const avg = diffSum / n;
      if (avg > MOTION_THRESH) {
        hits++;
        const cx = (x + BLOCK/2) / mw; // 0..1
        const cy = (y + BLOCK/2) / mh; // 0..1
        sumX += cx; sumY += cy;
      }
    }
  }
  prevFrame.data.set(curr.data);

  const rawIntensity = Math.min(1, hits / ((mw*mh)/(BLOCK*BLOCK)) * 3.0);
  motionIntensity = lerp(motionIntensity, rawIntensity, 0.25);

  if (hits > 0){
    motionCenterX = lerp(motionCenterX, sumX / hits, 0.2);
    motionCenterY = lerp(motionCenterY, sumY / hits, 0.2);
  } else {
    motionCenterX = lerp(motionCenterX, 0.5, 0.02);
    motionCenterY = lerp(motionCenterY, 0.5, 0.02);
  }
}

// ====== Audio feedback (synth, volgt beweging) ======
let outCtx = null, osc = null, filt = null, gain = null, audioOn = false;

function initAudio(){
  if (outCtx) return;
  outCtx = new (window.AudioContext || window.webkitAudioContext)();
  osc = outCtx.createOscillator();
  osc.type = "sine";
  filt = outCtx.createBiquadFilter();
  filt.type = "lowpass"; filt.frequency.value = 1400; filt.Q.value = 0.7;
  gain = outCtx.createGain();
  gain.gain.value = 0.0001;
  osc.connect(filt).connect(gain).connect(outCtx.destination);
  osc.start();
  outCtx.resume();
}

function setAudio(freq, vol){
  if (!outCtx || !osc || !gain) return;
  const now = outCtx.currentTime;
  osc.frequency.cancelScheduledValues(now);
  gain.gain.cancelScheduledValues(now);
  osc.frequency.linearRampToValueAtTime(freq, now + 0.05);
  gain.gain.linearRampToValueAtTime(vol,  now + 0.05);
}

function toggleAudio(){
  initAudio();
  if (!audioOn){
    outCtx.resume();
    audioOn = true;
    audioBtn.classList.add("on");
  } else {
    setAudio(140, 0.0001);
    audioOn = false;
    audioBtn.classList.remove("on");
  }
}

// ====== Visuals ======

// raster (3×3) + highlight van de cel met meeste beweging
function drawGrid(){
  const w = canvas.width, h = canvas.height;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;

  // verticale lijnen
  for (let i=1;i<=2;i++){
    const x = Math.floor((w/3)*i)+0.5;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  // horizontale lijnen
  for (let i=1;i<=2;i++){
    const y = Math.floor((h/3)*i)+0.5;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }

  // highlight cel
  const col = Math.min(2, Math.max(0, Math.floor(motionCenterX * 3)));
  const row = Math.min(2, Math.max(0, Math.floor(motionCenterY * 3)));
  const cellX = Math.floor((w/3) * col);
  const cellY = Math.floor((h/3) * row);
  ctx.fillStyle = "rgba(123,223,242,0.08)";
  ctx.fillRect(cellX, cellY, Math.ceil(w/3), Math.ceil(h/3));

  ctx.restore();
}

function drawBackground(hue, lightness){
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `hsla(${hue}, 55%, ${lightness}%, 0.12)`;
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function drawWaves(intensity, dir, hue, lightness, verticalOffset){
  // intensity: 0..1, dir: -1..+1
  const w = canvas.width, h = canvas.height;
  const mid = h/2 + verticalOffset; // verschuif golf omhoog/omlaag

  const A1 = 20 + intensity * 180; // duidelijke amplitude
  const A2 = A1 * 0.55;
  const A3 = A1 * 0.3;

  const k1 = (2*Math.PI)/w, k2 = k1*0.75, k3 = k1*0.45;

  const base = 0.0010;
  const extra = 0.0022 * intensity;
  const sign = Math.sign(dir) || 1;
  const t = performance.now() * (base + extra) * (1 + 0.4*Math.abs(dir)) * sign;

  const c1 = `hsla(${hue}, 80%, ${Math.min(92, lightness+30)}%, 1)`;
  const c2 = `hsla(${hue}, 75%, ${Math.min(95, lightness+36)}%, .9)`;
  const c3 = `hsla(${hue}, 85%, ${Math.min(98, lightness+42)}%, .8)`;

  ctx.beginPath();
  for (let x=0; x<=w; x+=4){
    const y = mid + A1*Math.sin(k1*x + t) + 0.35*A1*Math.sin(k1*x*0.5 + t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 6; ctx.strokeStyle = c1; ctx.globalCompositeOperation = "lighter"; ctx.stroke();

  ctx.beginPath();
  for (let x=0; x<=w; x+=5){
    const y = mid + A2*Math.sin(k2*x + t*0.85);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 3.5; ctx.strokeStyle = c2; ctx.stroke();

  ctx.beginPath();
  for (let x=0; x<=w; x+=6){
    const y = mid + A3*Math.sin(k3*x + t*0.65);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 2.2; ctx.strokeStyle = c3; ctx.stroke();
}

// ====== Loop ======
let hue = 200;           // basiskleur (blauw)
let bgLight = 10;        // achtergrond-lightness (in %)
let raf = 0;

function loop(){
  analyzeMotion();

  // ——— Raster mapping ———
  // x (0 links..1 rechts) → richting
  const dir = (motionCenterX - 0.5) * 2;

  // y (0 boven..1 onder): boven = lichter, hoger, luider; onder = donkerder, lager, zachter
  const vertical = (0.5 - motionCenterY) * 2; // +1 helemaal boven, -1 helemaal onder
  const verticalOffset = vertical * (canvas.height * 0.15); // verschuif golf ~15% vh
  const targetLight = 10 + (vertical * 12);  // achtergrond-lichtheid ±12%
  bgLight = lerp(bgLight, targetLight, 0.08);

  // intensiteit vooral uit beweging
  const intensity = motionIntensity;

  // kleurtoon draait licht mee op richting/intensiteit
  const targetHue = 200 + intensity * 100 + dir * 10;
  hue = lerp(hue, targetHue, 0.08);

  // audio: toonhoogte + volume volgen beweging en vertical
  if (audioOn && outCtx){
    const baseFreq = 140;
    const pitchRange = 320;
    const dirBend   = 60 * dir;
    const vBoost    = Math.max(0, vertical) * 0.08; // luider als je boven zit
    const freq = baseFreq + intensity * pitchRange + dirBend;
    const vol  = Math.min(0.16, 0.02 + intensity * 0.12 + vBoost);
    setAudio(freq, vol);
  }

  // tekenen
  drawBackground(hue|0, bgLight);
  drawWaves(intensity, dir, hue|0, 70 + vertical*8 /*lichte boost boven*/, verticalOffset);
  drawGrid(); // subtiel raster + highlight

  raf = requestAnimationFrame(loop);
}

// ====== UI ======
enableCamBtn.addEventListener("click", enableCamera);
audioBtn.addEventListener("click", toggleAudio);
infoBtn.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","false"));
closeInfo.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","true"));
document.addEventListener("keydown",(e)=>{
  if (e.key === "Escape") infoModal.setAttribute("aria-hidden","true");
});

// Start visuals meteen (autonoom); camera/audio maken 'm responsief
loop();
