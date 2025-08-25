"use strict";

// ====== DOM ======
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const camVideo  = document.getElementById("cam");

const centerOverlay = document.getElementById("centerOverlay");
const enableCamBtn  = document.getElementById("enableCamBtn");
const enableMicBtn  = document.getElementById("enableMicBtn");

const infoBtn   = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeInfo = document.getElementById("closeInfo");

const micBtn    = document.getElementById("micBtn");

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

// ====== Webcam → beweging ======
let camStream = null, camOn = false;
let motionCanvas = null, motionCtx = null, prevFrame = null;

const MOTION_SCALE = 4;
const BLOCK = 8;
const MOTION_THRESH = 28;

let motionIntensity = 0;  // 0..1
let motionCenterX  = 0.5; // 0..1 (links→rechts)

// ====== Microfoon → audio (RMS + spectrale centroid) ======
let micCtx = null, analyserTime = null, analyserFreq = null, timeBuf = null, freqBuf = null, micOn = false;
let audioLevel = 0;  // 0..1
let audioHue   = 200; // 200..330 (blauw → magenta)

function rms(buf){
  let s=0; for (let i=0;i<buf.length;i++){ const v=buf[i]; s+=v*v; }
  return Math.sqrt(s / buf.length);
}
function spectralCentroid(byteFreq, sampleRate, fftSize){
  let num=0, den=0;
  const binHz = sampleRate / fftSize;
  for (let i=0;i<byteFreq.length;i++){
    const mag = byteFreq[i];
    den += mag;
    num += mag * (i * binHz);
  }
  if (den < 1e-6) return 0;
  return num / den;
}

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
  } catch {
    alert("Camera-toegang geweigerd of niet beschikbaar.");
  }
}

async function enableMic(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false },
      video: false
    });
    // user gesture via click (micBtn or overlay) required for AudioContext
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = micCtx.createMediaStreamSource(stream);

    analyserTime = micCtx.createAnalyser();
    analyserTime.fftSize = 1024;
    analyserTime.smoothingTimeConstant = 0.9;

    analyserFreq = micCtx.createAnalyser();
    analyserFreq.fftSize = 2048;
    analyserFreq.smoothingTimeConstant = 0.85;

    src.connect(analyserTime);
    src.connect(analyserFreq);

    timeBuf = new Float32Array(analyserTime.fftSize);
    freqBuf = new Uint8Array(analyserFreq.frequencyBinCount);

    micOn = true;
    micBtn.classList.add("on");
  } catch {
    alert("Microfoon-toegang geweigerd of niet beschikbaar.");
  }
}

// ====== Analyse ======
const lerp = (a,b,t)=> a + (b-a)*t;

function analyzeMotion(){
  if (!camOn || !camVideo.videoWidth) {
    motionIntensity = lerp(motionIntensity, 0, 0.02);
    motionCenterX   = lerp(motionCenterX, 0.5, 0.02);
    return;
  }

  const mw = motionCanvas.width, mh = motionCanvas.height;
  motionCtx.drawImage(camVideo, 0, 0, mw, mh);
  const curr = motionCtx.getImageData(0, 0, mw, mh);

  let hits = 0, sumX = 0;

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
        sumX += (x + BLOCK/2) / mw; // 0..1
      }
    }
  }
  prevFrame.data.set(curr.data);

  const rawIntensity = Math.min(1, hits / ((mw*mh)/(BLOCK*BLOCK)) * 3.0);
  motionIntensity = lerp(motionIntensity, rawIntensity, 0.25);
  motionCenterX   = lerp(motionCenterX, hits ? (sumX/hits) : 0.5, hits ? 0.2 : 0.02);
}

function analyzeAudio(){
  if (!micOn || !analyserTime || !analyserFreq) {
    audioLevel = lerp(audioLevel, 0, 0.05);
    audioHue   = lerp(audioHue, 200, 0.02); // koelblauw
    return;
  }
  analyserTime.getFloatTimeDomainData(timeBuf);
  const rmsVal = rms(timeBuf);                      // ~0..0.4
  const leveled = Math.min(1, Math.max(0, (rmsVal - 0.01) * 8));
  audioLevel = lerp(audioLevel, leveled, 0.3);

  analyserFreq.getByteFrequencyData(freqBuf);
  const sc = spectralCentroid(freqBuf, micCtx.sampleRate, analyserFreq.fftSize); // Hz
  // 150..3000 Hz → hue 200..330
  const hue = 200 + Math.max(0, Math.min(1, (sc - 150) / (3000 - 150))) * 130;
  audioHue = lerp(audioHue, hue, 0.2);
}

// ====== Visuals ======
function drawBackground(){
  // tint achtergrond richting audio-hue
  const h = audioHue | 0;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `hsla(${h}, 55%, 10%, 0.12)`;
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function drawWaves(intensity, dir, hue){
  // intensity: 0..1, dir: -1..+1
  const w = canvas.width, h = canvas.height;
  const mid = h/2;

  const A1 = 20 + intensity * 180; // zichtbare amplitude
  const A2 = A1 * 0.55;
  const A3 = A1 * 0.3;

  const k1 = (2*Math.PI)/w, k2 = k1*0.75, k3 = k1*0.45;

  const base = 0.0010;
  const extra = 0.0022 * intensity;
  const sign = Math.sign(dir) || 1;
  const t = performance.now() * (base + extra) * (1 + 0.4*Math.abs(dir)) * sign;

  const c1 = `hsla(${hue}, 80%, 70%, 1)`;
  const c2 = `hsla(${hue}, 75%, 78%, .9)`;
  const c3 = `hsla(${hue}, 85%, 88%, .8)`;

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
let raf = 0;
function loop(){
  analyzeMotion();
  analyzeAudio();

  // combineer: 60% beweging, 40% audio
  const intensity = Math.min(1, 0.6*motionIntensity + 0.4*audioLevel);
  const dir = (motionCenterX - 0.5) * 2;
  const hue = audioHue;

  drawBackground();
  drawWaves(intensity, dir, hue);

  raf = requestAnimationFrame(loop);
}

// ====== UI ======
enableCamBtn.addEventListener("click", async ()=>{
  await enableCamera();
  // overlay pas weg als tenminste één input actief is:
  if (camOn || micOn) centerOverlay.style.display = "none";
});
enableMicBtn.addEventListener("click", async ()=>{
  await enableMic();
  if (camOn || micOn) centerOverlay.style.display = "none";
});
micBtn.addEventListener("click", async ()=>{
  if (!micOn) {
    await enableMic(); // user gesture → AudioContext mag starten
  } else {
    // mic uitzetten (pauze analyse, laat permissie-track lopen om simpeler te houden)
    micOn = false;
    micBtn.classList.remove("on");
    // optioneel: micCtx.suspend();
  }
});
infoBtn.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","false"));
closeInfo.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","true"));
document.addEventListener("keydown",(e)=>{
  if (e.key === "Escape") infoModal.setAttribute("aria-hidden","true");
});

// Start visuals meteen
loop();
