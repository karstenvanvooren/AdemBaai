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

/* ===================== Beschikbare noten ===================== */
const NOTES = ["C4","E4","G4","C5"]; 

/* ===================== Split + hysterese ===================== */
const SPLIT_X = 0.5;
const HYST = 0.06;
function sideWithHysteresis(x, prevSide){
  if (prevSide === "left"){
    if (x > SPLIT_X + HYST) return "right";
    return "left";
  }
  if (prevSide === "right"){
    if (x < SPLIT_X - HYST) return "left";
    return "right";
  }
  return (x < SPLIT_X) ? "left" : "right";
}

/* ===================== Canvas / DPI ===================== */
function resize(){
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width  = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
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
camVideo.addEventListener("click", ()=> setDebug(false));
document.addEventListener("keydown", (e)=> {
  if (e.key && e.key.toLowerCase() === "d") setDebug(!DEBUG);
});

/* ===================== Handtracking ===================== */
let hands, camera;
let motionCenterX = 0.5, motionCenterY = 0.5, motionIntensity = 0.6;

const detectedHands = [];
let lastHandLandmarksList = [];
let singleHandSide = null; 
const smoothBuf = { x: [], y: [] };
function smoothPush(buf, val, max=6){
  buf.push(val); if (buf.length > max) buf.shift();
  return buf.reduce((a,b)=>a+b,0)/buf.length;
}

async function enableCamera(){
  const camStream = await navigator.mediaDevices.getUserMedia({ video: {facingMode:"user"}, audio:false });
  camVideo.srcObject = camStream;
  await camVideo.play().catch(()=>{});

  hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
  hands.setOptions({
    selfieMode: true,
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  hands.onResults(results => {
    detectedHands.length = 0;
    lastHandLandmarksList.length = 0;

    const lms = results.multiHandLandmarks || [];
    for (const handLm of lms){
      lastHandLandmarksList.push(handLm);
      const palm = handLm[9];
      detectedHands.push({ x: palm.x, y: palm.y, landmarks: handLm });
    }

    if (detectedHands.length){
      let avgX = 0, avgY = 0;
      for (const h of detectedHands){ avgX += h.x; avgY += h.y; }
      avgX /= detectedHands.length;
      avgY /= detectedHands.length;

      const sx = smoothPush(smoothBuf.x, avgX);
      const sy = smoothPush(smoothBuf.y, avgY);

      motionCenterX += (sx - motionCenterX) * 0.22;
      motionCenterY += (sy - motionCenterY) * 0.22;
      motionIntensity += (0.85 - motionIntensity) * 0.15;
    } else {
      motionCenterX += (0.5 - motionCenterX) * 0.06;
      motionCenterY += (0.5 - motionCenterY) * 0.06;
      motionIntensity += (0.15 - motionIntensity) * 0.06;
    }
  });

  camera = new Camera(camVideo, {
    onFrame: async () => { await hands.send({image: camVideo}); },
    width: 640, height: 480
  });
  camera.start();

  await initAudio();
  centerOverlay.style.display = "none";
}

/* ===================== Audio ===================== */
let audioReady = false, piano, violin;
const lastTrig = { left: 0, right: 0 };
const MIN_GAP = { left: 0.25, right: 0.25 };

async function initAudio(){
  if (audioReady) return;
  await Tone.start();

  const urlsPiano  = Object.fromEntries(NOTES.map(n => [n, `piano${n}.wav`]));
  const urlsViolin = Object.fromEntries(NOTES.map(n => [n, `violin${n}.wav`]));

  piano = new Tone.Sampler({ urls: urlsPiano, baseUrl: "./samples/piano/", attack: 0.005, release: 0.9 }).toDestination();
  violin= new Tone.Sampler({ urls: urlsViolin, baseUrl: "./samples/violin/", attack: 0.01,  release: 1.2 }).toDestination();

  const limiter = new Tone.Limiter(-1).toDestination();
  piano.connect(limiter); violin.connect(limiter);

  audioReady = true;
}

function yToAvailableNote(y){
  const idx = Math.max(0, Math.min(NOTES.length-1, Math.round((1 - y) * (NOTES.length-1))));
  return NOTES[idx];
}

function getPerSideHands(){
  const res = { left: null, right: null };
  if (detectedHands.length >= 2){
    const sorted = detectedHands.slice().sort((a,b)=>a.x - b.x);
    res.left = sorted[0];
    res.right = sorted[sorted.length-1];
    singleHandSide = null;
  } else if (detectedHands.length === 1){
    const h = detectedHands[0];
    singleHandSide = sideWithHysteresis(h.x, singleHandSide);
    res[singleHandSide] = h;
  }
  return res;
}

function triggerSounds(){
  if (!audioReady) return;
  const now = Tone.now();
  const { left, right } = getPerSideHands();

  if (left){
    const note = yToAvailableNote(left.y);
    if (now - lastTrig.left > MIN_GAP.left){
      piano.triggerAttackRelease(note, "8n", now, 0.8);
      lastTrig.left = now;
    }
  }
  if (right){
    const note = yToAvailableNote(right.y);
    if (now - lastTrig.right > MIN_GAP.right){
      violin.triggerAttackRelease(note, "8n", now, 0.8);
      lastTrig.right = now;
    }
  }
}

/* ===================== Visuals (golf) ===================== */
let phase = 0, lastTime = performance.now(), lastDir = 1;

function drawLandmarks(){
  if (!DEBUG || lastHandLandmarksList.length === 0) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.save();
  ctx.fillStyle = "rgba(255,200,0,0.9)";
  for (const hand of lastHandLandmarksList){
    for (const lm of hand){
      ctx.beginPath();
      ctx.arc(lm.x*w, lm.y*h, 3, 0, Math.PI*2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawWave(){
  const now = performance.now();
  const dt  = Math.min(0.05, (now - lastTime)/1000);
  lastTime = now;

  const w = canvas.clientWidth, h = canvas.clientHeight, mid = h/2;
  const xHand = motionCenterX * w;
  const yInv  = 1 - motionCenterY;

  const offset = motionCenterX - 0.5;
  let dirSign = Math.sign(offset);
  if (Math.abs(offset) < 0.04) dirSign = lastDir; else lastDir = dirSign || lastDir;

  const freq = 0.6 + 1.8 * motionIntensity;
  phase += (freq * Math.PI * 2 * dirSign) * dt;

  const hue = 200 + yInv*130 + offset*10;

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const dpr = window.devicePixelRatio || 1;
  ctx.scale(dpr,dpr);

  ctx.fillStyle=`hsla(${hue},55%,10%,0.06)`;
  ctx.fillRect(0,0,w,h);

  const baseA = 20, peakA = 100, sigma = w*0.2;
  const k1 = (2*Math.PI)/w;

  ctx.beginPath();
  for (let x=0; x<=w; x+=3){
    const dx = x - xHand;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = baseA + peakA*boost;
    const y = mid + A*Math.sin(k1*x + phase);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth=5; ctx.strokeStyle=`hsla(${hue},80%,70%,1)`; ctx.stroke();

  drawLandmarks();
}

/* ===================== Loop ===================== */
function loop(){
  drawWave();
  triggerSounds();
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
