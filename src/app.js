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
  // fysiek pixels × DPR
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width  = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(1,0,0,1,0,0); // reset transform
  ctx.scale(dpr,dpr);           // schaal zodat 1 eenheid = 1 css pixel
}
resize();
window.addEventListener("resize", resize);

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

// ====== Audio feedback ======
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

function drawHorizontalWave(handX, handY, intensity){
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const mid = h/2;  // altijd exact midden van het scherm

  const xHandPx = handX * w;
  const yInv    = 1 - handY; // boven=1, onder=0

  // kleur
  const hue  = 200 + yInv*130 + (handX-0.5)*10;
  drawBackground(hue|0);

  // amplitude
  const baseA = 18 + intensity*70;
  const peakA = 70 + yInv*170;
  const sigma = w * 0.18;

  // golf
  const k = (2*Math.PI)/w;
  const speed = 0.001 + 0.0020*(0.3 + 0.7*intensity);
  const dirSign = Math.sign((handX-0.5)) || 1;
  const t = performance.now() * (speed * (1 + 0.4*Math.abs((handX-0.5)*2))) * dirSign;

  ctx.globalCompositeOperation = "lighter";

  // hoofdgolf
  ctx.beginPath();
  for (let x=0; x<=w; x+=3){
    const dx = x - xHandPx;
    const boost = Math.exp(-(dx*dx)/(2*sigma*sigma));
    const A = baseA + peakA*boost;
    const y = mid + A*Math.sin(k*x + t) + 0.35*A*Math.sin(k*x*0.5 + t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 6; ctx.strokeStyle = `hsla(${hue}, 80%, 70%, 1)`; ctx.stroke();

  // audio
  if (audioOn && outCtx){
    const baseFreq = 140;
    const pitchRange = 320;
    const bend = (handX-0.5) * 60;
    const freq = baseFreq + yInv*pitchRange + bend;
    const vol  = Math.min(0.16, 0.02 + intensity*0.10 + yInv*0.10);
    setAudio(freq, vol);
  }
}

// ====== Loop ======
function loop(){
  analyzeMotion();
  drawHorizontalWave(motionCenterX, motionCenterY, motionIntensity);
  requestAnimationFrame(loop);
}

// ====== UI ======
enableCamBtn.addEventListener("click", enableCamera);
audioBtn.addEventListener("click", toggleAudio);
infoBtn.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","false"));
closeInfo.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","true"));
document.addEventListener("keydown",(e)=>{
  if (e.key === "Escape") infoModal.setAttribute("aria-hidden","true");
});

// Start
loop();
