"use strict";

/* ===================== DOM ===================== */
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const camVideo  = document.getElementById("cam");

const centerOverlay = document.getElementById("centerOverlay");
const enableCamBtn  = document.getElementById("enableCamBtn");

const infoBtn   = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeInfo = document.getElementById("closeInfo");

const debugBtn  = document.getElementById("debugBtn");

/* ===================== Beschikbare noten (zorg dat deze .wav echt bestaan!) ===================== */
const NOTES = ["C4","E4","G4","C5"]; 
// Voeg hier noten bij als je extra .wav toevoegt, bv: "A4","D5", ...

/* ===================== Canvas / DPI ===================== */
function resize(){
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width  = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr,dpr);
}
resize();
addEventListener("resize", resize);

/* ===================== Debug toggle ===================== */
let DEBUG = false;
function setDebug(on){
  DEBUG = on;
  camVideo.style.display = DEBUG ? "block" : "none";
  debugBtn?.classList.toggle("on", DEBUG);
}
setDebug(false);

debugBtn?.addEventListener("click", ()=> setDebug(!DEBUG));
document.addEventListener("keydown", (e)=> {
  if (e.key.toLowerCase() === "d") setDebug(!DEBUG);
});

/* ===================== Handtracking (MediaPipe) ===================== */
let motionCenterX = 0.5, motionCenterY = 0.5, motionIntensity = 0;
const lerp = (a,b,t)=> a+(b-a)*t;

// moving averages voor extra smoothing
const xHist=[], yHist=[];
function smooth(val, hist, n=5){
  hist.push(val); if(hist.length>n) hist.shift();
  return hist.reduce((a,b)=>a+b,0)/hist.length;
}

let hands, camera;
let prevY = 0.5;
let lastHandLandmarks = null; // voor debug tekenen

async function enableCamera(){
  // Start camera stream
  const camStream = await navigator.mediaDevices.getUserMedia({ video: {facingMode:"user"}, audio:false });
  camVideo.srcObject = camStream;
  await camVideo.play().catch(()=>{});

  // MediaPipe Hands (selfie/spiegel)
  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  hands.setOptions({
    selfieMode: true,          // MediaPipe levert gespiegelde x
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  hands.onResults(results => {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0){
      const hand = results.multiHandLandmarks[0];
      lastHandLandmarks = hand;

      const palm = hand[9]; // midden hand
      const sx = smooth(palm.x, xHist, 5);
      const sy = smooth(palm.y, yHist, 5);

      motionCenterX = lerp(motionCenterX, sx, 0.25);
      motionCenterY = lerp(motionCenterY, sy, 0.25);

      // intensiteit: hand-spread (duim-pink) + snelheid in Y
      const thumb = hand[4], pinky = hand[20];
      const dx = thumb.x - pinky.x, dy = thumb.y - pinky.y;
      const spread = Math.min(1, Math.hypot(dx,dy) * 3.0);

      const vy = Math.abs(sy - prevY); prevY = sy;
      const speedBoost = Math.min(1, vy * 8);

      motionIntensity = lerp(motionIntensity, Math.min(1, spread*0.8 + speedBoost*0.4), 0.25);
    } else {
      lastHandLandmarks = null;
      motionCenterX = lerp(motionCenterX, 0.5, 0.05);
      motionCenterY = lerp(motionCenterY, 0.5, 0.05);
      motionIntensity = lerp(motionIntensity, 0.1, 0.05);
    }
  });

  // Camera helper die frames naar MediaPipe stuurt
  camera = new Camera(camVideo, {
    onFrame: async () => { await hands.send({image: camVideo}); },
    width: 640, height: 480
  });
  camera.start();

  await initAudio();
  centerOverlay.style.display = "none";
}

/* ===================== Audio (Tone.js Samplers, .wav) ===================== */
let audioReady = false, piano, violin;

async function initAudio(){
  if (audioReady) return;
  await Tone.start();

  // Bouw de urls objecten dynamisch vanuit NOTES
  const urlsPiano  = Object.fromEntries(NOTES.map(n => [n, `piano${n}.wav`]));
  const urlsViolin = Object.fromEntries(NOTES.map(n => [n, `violin${n}.wav`]));

  piano = new Tone.Sampler({
    urls: urlsPiano,
    baseUrl: "./samples/piano/",
    attack: 0.004, release: 0.9
  }).toDestination();

  violin = new Tone.Sampler({
    urls: urlsViolin,
    baseUrl: "./samples/violin/",
    attack: 0.01, release: 1.4
  }).toDestination();

  const limiter = new Tone.Limiter(-1).toDestination();
  piano.connect(limiter); violin.connect(limiter);

  audioReady = true;
}

// kies uitsluitend uit beschikbare NOTES
function yToAvailableNote(y){
  // y=0 (boven) → hoogste index; y=1 (onder) → laagste index
  const idx = Math.max(0, Math.min(NOTES.length-1, Math.round((1 - y) * (NOTES.length-1))));
  return NOTES[idx];
}

let lastTrig = 0;
function triggerSound(){
  if (!audioReady) return;
  const now = Tone.now();

  const minGap = 0.18 + (1 - motionIntensity) * 0.35; // throttle
  if (now - lastTrig < minGap) return;

  const note = yToAvailableNote(motionCenterY); // ✅ alleen bestaande noten
  const vel  = Math.min(1, 0.25 + motionIntensity * 0.9);
  const left = motionCenterX < 0.5; // MediaPipe is al selfie

  try{
    if (left) piano.triggerAttackRelease(note, "8n", now, vel);
    else      violin.triggerAttackRelease(note, "4n", now, vel);
    lastTrig = now;
  }catch(e){}
}

/* ===================== Visuals ===================== */
function clearCanvas(){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const dpr = window.devicePixelRatio || 1;
  ctx.scale(dpr,dpr);
}

function drawBackground(hue){
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle=`hsla(${hue},55%,10%,0.06)`; // subtiele tint bovenop body-bg
  ctx.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);
}

// debug: landmarks tekenen
function drawLandmarks(hand){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(255,200,0,0.9)";
  for (const lm of hand){
    const lx = lm.x * w;       
    const ly = lm.y * h;
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI*2);
    ctx.fill();
  }
  const palm = hand[9];
  const px = palm.x * w;       
  const py = palm.y * h;
  ctx.fillStyle = "rgba(255,0,0,0.85)";
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

let phase = 0;         // stabiele fase
let lastTime = performance.now();
let lastDir = 1;

function drawWave(){
  const now = performance.now();
  const dt  = Math.min(0.05, (now - lastTime)/1000);
  lastTime = now;

  const w = canvas.clientWidth, h = canvas.clientHeight, mid = h/2;

  const xHand = motionCenterX * w;
  const yInv  = 1 - motionCenterY;

  // stabiele richting (flip niet rond midden)
  const offset = motionCenterX - 0.5;
  let dirSign = Math.sign(offset);
  if (Math.abs(offset) < 0.04) dirSign = lastDir; else lastDir = dirSign || lastDir;

  // snelheid (cps) → fase integreren
  const freq = 0.6 + 1.8 * motionIntensity;
  phase += (freq * Math.PI * 2 * dirSign) * dt;

  const hue = 200 + yInv*130 + offset*10;

  clearCanvas();
  drawBackground(hue|0);

  const baseA = 16 + motionIntensity*68;
  const peakA = 64 + yInv*160;
  const sigma = w * 0.18;

  const k1 = (2*Math.PI)/w;
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";

  // laag 1
  ctx.beginPath();
  for (let x=0; x<=w; x+=3){
    const dx = x - xHand;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = baseA + peakA*boost;
    const y = mid + A*Math.sin(k1*x + phase) + 0.35*A*Math.sin(k1*x*0.5 + phase*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 6; ctx.strokeStyle = `hsla(${hue}, 80%, 70%, 1)`; ctx.stroke();

  // laag 2
  ctx.beginPath();
  for (let x=0; x<=w; x+=4){
    const dx = x - xHand;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = (baseA*0.55) + (peakA*0.55)*boost;
    const y = mid + A*Math.sin(k1*0.75*x + phase*0.85);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 3.5; ctx.strokeStyle = `hsla(${hue}, 75%, 78%, .9)`; ctx.stroke();

  // laag 3
  ctx.beginPath();
  for (let x=0; x<=w; x+=5){
    const dx = x - xHand;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = (baseA*0.3) + (peakA*0.3)*boost;
    const y = mid + A*Math.sin(k1*0.45*x + phase*0.65);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 2.2; ctx.strokeStyle = `hsla(${hue}, 85%, 88%, .8)`; ctx.stroke();

  // debug landmarks bovenop de golf
  if (DEBUG && lastHandLandmarks) drawLandmarks(lastHandLandmarks);
}

/* ===================== Loop ===================== */
function loop(){
  drawWave();
  triggerSound();
  requestAnimationFrame(loop);
}

/* ===================== UI ===================== */
enableCamBtn.addEventListener("click", enableCamera);
infoBtn.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","false"));
closeInfo.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","true"));
document.addEventListener("keydown",(e)=>{
  if (e.key==="Escape") infoModal.setAttribute("aria-hidden","true");
});

/* Start */
loop();
