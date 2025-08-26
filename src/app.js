"use strict";

const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const camVideo = document.getElementById("cam");

const enableCamBtn = document.getElementById("enableCamBtn");
const centerOverlay = document.getElementById("centerOverlay");

const infoBtn = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeInfo = document.getElementById("closeInfo");

/* ===== Canvas DPI ===== */
function resize(){
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr,dpr);
}
resize();
addEventListener("resize", resize);

/* ===== Motion vars ===== */
let motionCenterX = 0.5;
let motionCenterY = 0.5;
let motionIntensity = 0; // gebaseerd op handspread
const lerp = (a,b,t)=> a+(b-a)*t;

/* ===== Mediapipe Hands ===== */
let hands, camera;

async function enableCamera(){
  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  hands.onResults(results => {
    if (results.multiHandLandmarks.length > 0){
      const hand = results.multiHandLandmarks[0];
      const palm = hand[9]; // midden hand
      // X,Y zijn al genormaliseerd 0–1
      motionCenterX = lerp(motionCenterX, palm.x, 0.2);
      motionCenterY = lerp(motionCenterY, palm.y, 0.2);

      // intensiteit = afstand tussen duim en pink
      const thumb = hand[4], pinky = hand[20];
      const dx = thumb.x - pinky.x, dy = thumb.y - pinky.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      motionIntensity = lerp(motionIntensity, Math.min(1, dist*3), 0.2);
    } else {
      motionCenterX = lerp(motionCenterX, 0.5, 0.05);
      motionCenterY = lerp(motionCenterY, 0.5, 0.05);
      motionIntensity = lerp(motionIntensity, 0, 0.05);
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

/* ===== Audio (Tone.js) ===== */
let piano, violin, audioReady = false;

async function initAudio(){
  if (audioReady) return;
  await Tone.start();

  piano = new Tone.Sampler({
    urls: {
      C4: "pianoC4.wav", E4: "pianoE4.wav",
      G4: "pianoG4.wav", C5: "pianoC5.wav"
    },
    baseUrl: "./samples/piano/"
  }).toDestination();

  violin = new Tone.Sampler({
    urls: {
      C4: "violinC4.wav", E4: "violinE4.wav",
      G4: "violinG4.wav", C5: "violinC5.wav"
    },
    baseUrl: "./samples/violin/"
  }).toDestination();

  audioReady = true;
}

const SCALE = ["C4","D4","E4","G4","A4","C5","D5","E5","G5","A5"];
function yToNote(y){
  const idx = Math.max(0, Math.min(SCALE.length-1, Math.round((1 - y) * (SCALE.length-1))));
  return SCALE[idx];
}

let lastTrig = 0;
function triggerSound(){
  if (!audioReady) return;
  const now = Tone.now();
  const minGap = 0.2 + (1-motionIntensity)*0.4;
  if (now - lastTrig < minGap) return;

  const note = yToNote(motionCenterY);
  const vel = 0.3 + motionIntensity*0.7;

  if (motionCenterX < 0.5){
    piano.triggerAttackRelease(note, "8n", now, vel);
  } else {
    violin.triggerAttackRelease(note, "4n", now, vel);
  }
  lastTrig = now;
}

/* ===== Visuals ===== */
function drawBackground(hue){
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle=`hsla(${hue},55%,10%,0.12)`;
  ctx.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);
}

function drawWave(){
  const w=canvas.clientWidth, h=canvas.clientHeight, mid=h/2;
  const xHand = motionCenterX * w;
  const yInv = 1 - motionCenterY;
  const hue = 200 + yInv*130 + (motionCenterX-0.5)*10;
  drawBackground(hue|0);

  const baseA=18+motionIntensity*70;
  const peakA=70+yInv*170;
  const sigma=w*0.18;
  const k=(2*Math.PI)/w;
  const speed=0.001+0.0020*(0.3+0.7*motionIntensity);
  const dirSign=Math.sign((motionCenterX-0.5))||1;
  const t=performance.now()*(speed*(1+0.4*Math.abs((motionCenterX-0.5)*2)))*dirSign;

  ctx.globalCompositeOperation="lighter";
  ctx.beginPath();
  for (let x=0;x<=w;x+=3){
    const dx=x-xHand;
    const boost=Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A=baseA+peakA*boost;
    const y=mid+A*Math.sin(k*x+t)+0.35*A*Math.sin(k*x*0.5+t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth=6; ctx.strokeStyle=`hsla(${hue},80%,70%,1)`; ctx.stroke();
}

/* ===== Loop ===== */
function loop(){
  drawWave();
  triggerSound();
  requestAnimationFrame(loop);
}

/* ===== UI ===== */
enableCamBtn.addEventListener("click", enableCamera);
infoBtn.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","false"));
closeInfo.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","true"));
document.addEventListener("keydown", e=>{
  if (e.key==="Escape") infoModal.setAttribute("aria-hidden","true");
});

loop();
