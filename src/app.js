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

// ====== Webcam → beweging ======
let camStream = null, camOn = false;
let motionCanvas = null, motionCtx = null, prevFrame = null;

const MOTION_SCALE = 4;
const BLOCK = 8;
const MOTION_THRESH = 28;

let motionIntensity = 0;   // 0..1
let motionCenterX  = 0.5;  // 0..1 links→rechts
let motionCenterY  = 0.5;  // 0..1 boven→onder

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

    initAudio(); audioOn = true; audioBtn.classList.add("on");
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
      if ((diffSum / n) > MOTION_THRESH) {
        hits++;
        sumX += (x + BLOCK/2) / mw;
        sumY += (y + BLOCK/2) / mh;
      }
    }
  }
  prevFrame.data.set(curr.data);

  const rawIntensity = Math.min(1, hits / ((mw*mh)/(BLOCK*BLOCK)) * 3.0);
  motionIntensity = lerp(motionIntensity, rawIntensity, 0.25);
  if (hits>0){
    motionCenterX = lerp(motionCenterX, sumX/hits, 0.2);
    motionCenterY = lerp(motionCenterY, sumY/hits, 0.2);
  } else {
    motionCenterX = lerp(motionCenterX, 0.5, 0.02);
    motionCenterY = lerp(motionCenterY, 0.5, 0.02);
  }
}

// ====== Audio feedback (synth) ======
let outCtx = null, osc = null, filt = null, gain = null, audioOn = false;
function initAudio(){
  if (outCtx) return;
  outCtx = new (window.AudioContext || window.webkitAudioContext)();
  osc = outCtx.createOscillator(); osc.type = "sine";
  filt = outCtx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 1400; filt.Q.value = 0.7;
  gain = outCtx.createGain(); gain.gain.value = 0.0001;
  osc.connect(filt).connect(gain).connect(outCtx.destination);
  osc.start(); outCtx.resume();
}
function setAudio(freq, vol){
  if (!outCtx) return;
  const now = outCtx.currentTime;
  osc.frequency.cancelScheduledValues(now);
  gain.gain.cancelScheduledValues(now);
  osc.frequency.linearRampToValueAtTime(freq, now + 0.05);
  gain.gain.linearRampToValueAtTime(vol,  now + 0.05);
}
function toggleAudio(){
  initAudio();
  if (!audioOn){ outCtx.resume(); audioOn = true; audioBtn.classList.add("on"); }
  else { setAudio(140, 0.0001); audioOn = false; audioBtn.classList.remove("on"); }
}

// ====== Visuals ======
function drawBackground(hue){
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `hsla(${hue}, 55%, 10%, 0.12)`;
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

/**
 * HORIZONTALE hoofdgolf exact op het midden (h/2).
 * - HandX bepaalt waar langs X de golf het sterkst is (lokale amplitude-boost)
 *   en beïnvloedt richting/snelheid.
 * - HandY bepaalt de grootte van de lokale boost, de kleur (hoger = warmer/lichter)
 *   en het audio-volume/toonhoogte.
 * - GEEN spiegeling.
 */
function drawHorizontalWave(handX, handY, intensity){
  const w = canvas.width, h = canvas.height;

  // baseline exact midden — visueel strak
  const mid = Math.floor(h/2) + 0.5;

  const xHandPx = handX * w;      // 0..w (geen spiegeling)
  const yInv    = 1 - handY;      // boven=1, onder=0

  // kleur (boven → warmer/lichter)
  const hue  = 200 + yInv*130 + (handX-0.5)*10;
  drawBackground(hue|0);

  // amplitude
  const baseA = 18 + intensity*70;     // overal iets leven
  const peakA = 70 + yInv*170;         // lokale piek (hoogte → groter)
  const sigma = w * 0.18;              // kolombreedte onder je hand

  // golfparameters
  const k = (2*Math.PI)/w;
  const speed = 0.001 + 0.0020*(0.3 + 0.7*intensity);
  const dirSign = Math.sign((handX-0.5)) || 1;   // links(-) / rechts(+)
  const t = performance.now() * (speed * (1 + 0.4*Math.abs((handX-0.5)*2))) * dirSign;

  // 3 lagen met lokale amplitude-boost rond xHandPx
  ctx.globalCompositeOperation = "lighter";

  // laag 1
  ctx.beginPath();
  for (let x=0; x<=w; x+=3){
    const dx = x - xHandPx;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma)); // 0..1
    const A = baseA + peakA*boost;
    const y = mid + A*Math.sin(k*x + t) + 0.35*A*Math.sin(k*x*0.5 + t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 6; ctx.strokeStyle = `hsla(${hue}, 80%, 70%, 1)`; ctx.stroke();

  // laag 2
  ctx.beginPath();
  for (let x=0; x<=w; x+=4){
    const dx = x - xHandPx;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = (baseA*0.55) + (peakA*0.55)*boost;
    const y = mid + A*Math.sin(k*0.75*x + t*0.85);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 3.5; ctx.strokeStyle = `hsla(${hue}, 75%, 78%, .9)`; ctx.stroke();

  // laag 3
  ctx.beginPath();
  for (let x=0; x<=w; x+=5){
    const dx = x - xHandPx;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = (baseA*0.3) + (peakA*0.3)*boost;
    const y = mid + A*Math.sin(k*0.45*x + t*0.65);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 2.2; ctx.strokeStyle = `hsla(${hue}, 85%, 88%, .8)`; ctx.stroke();

  // audio: hoger in beeld → hogere & luidere toon
  if (audioOn && outCtx){
    const baseFreq = 140;
    const pitchRange = 320;
    const bend = (handX-0.5) * 60; // kleine links/rechts bend
    const freq = baseFreq + yInv*pitchRange + bend;
    const vol  = Math.min(0.16, 0.02 + intensity*0.10 + yInv*0.10);
    setAudio(freq, vol);
  }
}

// ====== Loop ======
let raf = 0;
function loop(){
  analyzeMotion();
  drawHorizontalWave(motionCenterX, motionCenterY, motionIntensity);
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

// Start visuals
loop();
