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

/* ===================== Webcam → beweging ===================== */
let camOn = false, motionCanvas, motionCtx, prevFrame;
const MOTION_SCALE = 4, BLOCK = 8, MOTION_THRESH = 28;
let motionIntensity = 0, motionCenterX = 0.5, motionCenterY = 0.5;

const lerp = (a,b,t)=> a + (b-a)*t;

async function enableCamera(){
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:"user" }, audio: false });
    camVideo.srcObject = stream;
    await camVideo.play().catch(()=>{});
    camOn = true;

    motionCanvas = document.createElement("canvas");
    motionCanvas.width  = Math.max(160, Math.floor(canvas.width / MOTION_SCALE));
    motionCanvas.height = Math.max(120, Math.floor(canvas.height / MOTION_SCALE));
    motionCtx = motionCanvas.getContext("2d", { willReadFrequently:true });
    prevFrame = motionCtx.createImageData(motionCanvas.width, motionCanvas.height);

    await initAudio(); // start Tone.js na user gesture
    centerOverlay.style.display = "none";
  } catch {
    alert("Camera-toegang geweigerd of niet beschikbaar.");
  }
}

function analyzeMotion(){
  if (!camOn || !camVideo.videoWidth) return;

  const mw = motionCanvas.width, mh = motionCanvas.height;
  motionCtx.drawImage(camVideo, 0, 0, mw, mh);
  const curr = motionCtx.getImageData(0, 0, mw, mh);

  let hits=0,sumX=0,sumY=0;
  for (let y=0; y<mh; y+=BLOCK){
    for (let x=0; x<mw; x+=BLOCK){
      let diffSum=0,n=0;
      for (let by=0; by<BLOCK && y+by<mh; by++){
        const row=(y+by)*mw*4;
        for (let bx=0; bx<BLOCK && x+bx<mw; bx++){
          const i=row+(x+bx)*4;
          const l1=(prevFrame.data[i]*0.2126 + prevFrame.data[i+1]*0.7152 + prevFrame.data[i+2]*0.0722)||0;
          const l2=(curr.data[i]*0.2126 + curr.data[i+1]*0.7152 + curr.data[i+2]*0.0722);
          diffSum += Math.abs(l2 - l1); n++;
        }
      }
      if ((diffSum/n) > MOTION_THRESH){
        hits++;
        sumX += (x + BLOCK/2) / mw;
        sumY += (y + BLOCK/2) / mh;
      }
    }
  }
  prevFrame.data.set(curr.data);

  const raw = Math.min(1, hits / ((mw*mh)/(BLOCK*BLOCK)) * 3.0);
  motionIntensity = lerp(motionIntensity, raw, 0.25);
  if (hits>0){
    motionCenterX = lerp(motionCenterX, sumX/hits, 0.2);
    motionCenterY = lerp(motionCenterY, sumY/hits, 0.2);
  } else {
    motionCenterX = lerp(motionCenterX, 0.5, 0.02);
    motionCenterY = lerp(motionCenterY, 0.5, 0.02);
  }
}

/* ===================== Audio (Tone.js Samplers) ===================== */
let audioReady = false, piano, violin;

async function initAudio(){
  if (audioReady) return;
  await Tone.start();

  // Piano (links) & Violin (rechts) — laadt alleen enkele kernsamples
  piano = new Tone.Sampler({
    urls: {
      C4: "pianoC4.wav",
      E4: "pianoE4.wav",
      G4: "pianoG4.wav",
      C5: "pianoC5.wav"
    },
    baseUrl: "./samples/piano/",
    attack: 0.005, release: 0.8
  }).toDestination();

  violin = new Tone.Sampler({
    urls: {
      C4: "violinC4.wav",
      E4: "violinE4.wav",
      G4: "violinG4.wav",
      C5: "violinC5.wav"
    },
    baseUrl: "./samples/violin/",
    attack: 0.01, release: 1.2
  }).toDestination();

  // zachte limiter tegen clipping
  const limiter = new Tone.Limiter(-1).toDestination();
  piano.connect(limiter);
  violin.connect(limiter);

  audioReady = true;
}

// Toonset van laag → hoog (chromatisch-ish maar muzikaal)
const SCALE = ["C4","D4","E4","G4","A4","C5","D5","E5","G5","A5"];

function yToNote(y){ // y=0 boven → hoogste noot
  const idx = Math.max(0, Math.min(SCALE.length-1, Math.round((1 - y) * (SCALE.length-1))));
  return SCALE[idx];
}

let lastTrig = 0;
function triggerFromMotion(){
  if (!audioReady) return;
  const now = Tone.now();

  // throttle zodat het muzikaal blijft
  const minGap = 0.18 + (1 - motionIntensity) * 0.35; // rustiger bij weinig beweging
  if (now - lastTrig < minGap) return;

  // instrumentkeuze
  const isPiano = (motionCenterX < 0.5);
  const synth = isPiano ? piano : violin;

  // noot & dynamiek
  const note = yToNote(motionCenterY);
  const vel  = Math.min(1, 0.25 + motionIntensity * 0.9); // 0..1
  const dur  = isPiano ? "8n" : "4n"; // viool iets langer

  try {
    synth.triggerAttackRelease(note, dur, now, vel);
    lastTrig = now;
  } catch(e) {
    // negeren als samples nog laden
  }
}

/* ===================== Visuals ===================== */
function drawBackground(hue){
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle=`hsla(${hue},55%,10%,0.12)`;
  ctx.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);
}

function drawHorizontalWave(){
  const w = canvas.clientWidth, h = canvas.clientHeight, mid = h/2;

  // handpositie
  const xHand = motionCenterX * w;
  const yInv  = 1 - motionCenterY; // boven=1

  // kleur (boven → warmer/lichter)
  const hue = 200 + yInv*130 + (motionCenterX-0.5)*10;
  drawBackground(hue|0);

  // amplitude
  const baseA = 18 + motionIntensity*70; // overal wat leven
  const peakA = 70 + yInv*170;           // lokale piek (hoger → groter)
  const sigma = w * 0.18;                // kolombreedte onder je hand

  // golfparameters
  const k = (2*Math.PI)/w;
  const speed = 0.001 + 0.0020*(0.3 + 0.7*motionIntensity);
  const dirSign = Math.sign((motionCenterX-0.5)) || 1;   // links(-) / rechts(+)
  const t = performance.now() * (speed * (1 + 0.4*Math.abs((motionCenterX-0.5)*2))) * dirSign;

  // 3 lagen met lokale amplitude-boost rond xHand
  ctx.globalCompositeOperation="lighter";

  // Laag 1
  ctx.beginPath();
  for (let x=0; x<=w; x+=3){
    const dx = x - xHand;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = baseA + peakA*boost;
    const y = mid + A*Math.sin(k*x + t) + 0.35*A*Math.sin(k*x*0.5 + t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth=6; ctx.strokeStyle=`hsla(${hue},80%,70%,1)`; ctx.stroke();

  // Laag 2
  ctx.beginPath();
  for (let x=0; x<=w; x+=4){
    const dx = x - xHand;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = (baseA*0.55) + (peakA*0.55)*boost;
    const y = mid + A*Math.sin(k*0.75*x + t*0.85);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth=3.5; ctx.strokeStyle=`hsla(${hue},75%,78%,.9)`; ctx.stroke();

  // Laag 3
  ctx.beginPath();
  for (let x=0; x<=w; x+=5){
    const dx = x - xHand;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = (baseA*0.3) + (peakA*0.3)*boost;
    const y = mid + A*Math.sin(k*0.45*x + t*0.65);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth=2.2; ctx.strokeStyle=`hsla(${hue},85%,88%,.8)`; ctx.stroke();
}

/* ===================== Loop ===================== */
function loop(){
  analyzeMotion();
  drawHorizontalWave();
  triggerFromMotion();
  requestAnimationFrame(loop);
}

/* ===================== UI ===================== */
enableCamBtn.addEventListener("click", enableCamera);
infoBtn.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","false"));
closeInfo.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","true"));
document.addEventListener("keydown",(e)=>{
  if (e.key==="Escape") infoModal.setAttribute("aria-hidden","true");
});

loop();
