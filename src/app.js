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

// Motion parameters
const MOTION_SCALE = 4;   // downsample factor (snel)
const BLOCK = 8;          // blokgrootte voor analyse
const MOTION_THRESH = 28; // drempel voor “er beweegt iets”
let motionIntensity = 0;  // 0..1 (exponentieel gedempt)
let motionCenterX = 0.5;  // 0..1 (links→rechts zwaartepunt)

// Easing helpers
const lerp = (a,b,t)=> a + (b-a)*t;
function smoothTo(v, target, amt){ return lerp(v, target, amt); }

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

    centerOverlay.style.display = "none";
  } catch {
    alert("Camera-toegang geweigerd of niet beschikbaar. De baai blijft kabbelen.");
  }
}

function analyzeMotion(){
  if (!camOn || !camVideo.videoWidth) {
    // langzame terugval naar rust
    motionIntensity = smoothTo(motionIntensity, 0, 0.02);
    return;
  }

  const mw = motionCanvas.width, mh = motionCanvas.height;
  motionCtx.drawImage(camVideo, 0, 0, mw, mh);
  const curr = motionCtx.getImageData(0, 0, mw, mh);

  let hits = 0, sumX = 0;

  // scan in blokken
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

  // update prev frame
  prevFrame.data.set(curr.data);

  // normaliseer intensiteit
  const rawIntensity = Math.min(1, hits / ((mw*mh)/(BLOCK*BLOCK)) * 3.0);
  motionIntensity = smoothTo(motionIntensity, rawIntensity, 0.25);

  // zwaartepunt
  if (hits > 0) {
    const cx = sumX / hits; // 0..1
    motionCenterX = smoothTo(motionCenterX, cx, 0.2);
  } else {
    motionCenterX = smoothTo(motionCenterX, 0.5, 0.02);
  }

  // spawn ripples op enkele willekeurige “hits”
  spawnRipplesFromMotion(curr, mw, mh, hits);
}

// ====== Rimpels ======
const ripples = [];
class Ripple {
  constructor(x, y){
    this.x = x; this.y = y;
    this.r = 6 + Math.random()*4;
    this.max = 160 + Math.random()*120;
    this.alpha = 0.6;
    this.line = 2;
  }
  step(){
    this.r += 2.2;
    this.alpha *= 0.985;
    this.line *= 0.995;
    return (this.r < this.max && this.alpha > 0.02);
  }
  draw(ctx){
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(178,247,239,${this.alpha})`;
    ctx.lineWidth = this.line;
    ctx.stroke();
  }
}

function spawnRipplesFromMotion(curr, mw, mh, hits){
  if (hits === 0) return;
  // Pak ~3 random posities met sterke verschillen
  const tries = 200; // aantal samples om hotspots te vinden
  const picks = [];
  for (let t=0; t<tries; t++){
    const x = (Math.random()*mw)|0;
    const y = (Math.random()*mh)|0;
    const i = (y*mw + x)*4;
    // gebruik luminantie als proxy voor detail; puur random is ook oké
    const lum = curr.data[i]*0.2126 + curr.data[i+1]*0.7152 + curr.data[i+2]*0.0722;
    if (lum > 30 && Math.random() < 0.02) {
      picks.push({x,y});
      if (picks.length >= 3) break;
    }
  }
  const scaleX = canvas.width / mw;
  const scaleY = canvas.height / mh;
  for (const p of picks){
    ripples.push(new Ripple(p.x*scaleX, p.y*scaleY));
  }
}

// ====== Visuals ======
function drawBackground(){
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(11,16,32,0.12)";
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function drawLayeredWaves(intensity, dir){
  // intensity: 0..1, dir: -1..+1 (links→rechts)
  const w = canvas.width, h = canvas.height;
  const mid = h/2;

  const A1 = lerp(18, 160, intensity); // amplitude groeit met beweging
  const A2 = A1 * 0.55;
  const A3 = A1 * 0.3;

  const k1 = (2*Math.PI)/w, k2 = k1*0.7, k3 = k1*0.4;

  // snelheid en richting: base speed + extra als er beweging is
  const base = 0.0014;
  const extra = 0.0012 * intensity;
  const sign = Math.sign(dir); // -1 (links), +1 (rechts), 0 (midden)
  const t = performance.now() * (base + extra) * (sign === 0 ? 1 : (1 + 0.3*Math.abs(dir))) * (sign || 1);

  const c1 = "#7bdff2", c2 = "#b2f7ef", c3 = "#eff7f6";

  ctx.beginPath();
  for (let x=0; x<=w; x+=4){
    const y = mid + A1*Math.sin(k1*x + t) + 0.35*A1*Math.sin(k1*x*0.5 + t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 5; ctx.strokeStyle = c1; ctx.globalCompositeOperation = "lighter"; ctx.stroke();

  ctx.beginPath();
  for (let x=0; x<=w; x+=5){
    const y = mid + A2*Math.sin(k2*x + t*0.85);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 3; ctx.strokeStyle = c2; ctx.stroke();

  ctx.beginPath();
  for (let x=0; x<=w; x+=6){
    const y = mid + A3*Math.sin(k3*x + t*0.65);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 2; ctx.strokeStyle = "#eff7f6cc"; ctx.stroke();
}

function drawRipples(){
  if (!ripples.length) return;
  ctx.globalCompositeOperation = "lighter";
  for (let i=ripples.length-1; i>=0; i--){
    const alive = ripples[i].step();
    ripples[i].draw(ctx);
    if (!alive) ripples.splice(i,1);
  }
}

let raf = 0;
function loop(){
  analyzeMotion();

  // map centers: 0..1 → -1..+1
  const dir = (motionCenterX - 0.5) * 2;

  drawBackground();
  drawLayeredWaves(motionIntensity, dir);
  drawRipples();

  raf = requestAnimationFrame(loop);
}

// ====== UI ======
enableCamBtn.addEventListener("click", enableCamera);
infoBtn.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","false"));
closeInfo.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","true"));
document.addEventListener("keydown",(e)=>{
  if (e.key === "Escape") infoModal.setAttribute("aria-hidden","true");
});

// Start visuals meteen (kabbelt autonoom); camera voegt interactie toe
loop();
