"use strict";

// ====== DOM ======
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");

const centerOverlay = document.getElementById("centerOverlay");
const enableMicBtn  = document.getElementById("enableMicBtn");

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

// ====== Audio / adem ======
let analyser = null, timeData = null, audioCtx = null, hasMic = false;
let env = 0, baseline = 0.02;
const attack = 0.12, release = 0.03, baselineFollow = 0.001;
let breathGain = 3.5;

function rms(buf){
  let s=0; for (let i=0;i<buf.length;i++){ const v=buf[i]; s+=v*v; }
  return Math.sqrt(s / buf.length);
}

async function enableMic(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false },
      video: false
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.9;
    src.connect(analyser);
    timeData = new Float32Array(analyser.fftSize);

    // korte baseline-kalibratie
    const t0 = performance.now();
    while (performance.now() - t0 < 500) {
      analyser.getFloatTimeDomainData(timeData);
      baseline = 0.9*baseline + 0.1*rms(timeData);
      await new Promise(r=>setTimeout(r,16));
    }

    hasMic = true;
    // Verberg enkel de overlay; de mini-header blijft zichtbaar
    centerOverlay.style.display = "none";
  } catch {
    alert("Microfoon-toegang geweigerd of niet beschikbaar. De baai blijft wel doorlopen.");
  }
}

// ====== Visuals ======
function drawBackground(){
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(11,16,32,0.12)";
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function drawLayeredWaves(breath){
  const w = canvas.width, h = canvas.height;
  const mid = h/2;

  // basis amplitude
  const A1 = Math.min(140, breath * 320);
  const A2 = A1 * 0.55;
  const A3 = A1 * 0.3;

  const k1 = (2*Math.PI)/w, k2 = k1*0.7, k3 = k1*0.4;

  // snelheid licht afhankelijk van adem
  const t = performance.now() * (0.0018 + breath*0.0005);

  // kleuren (calm palette)
  const c1 = "#7bdff2", c2 = "#b2f7ef", c3 = "#eff7f6";

  // laag 1
  ctx.beginPath();
  for (let x=0; x<=w; x+=4){
    const y = mid + A1*Math.sin(k1*x + t) + 0.35*A1*Math.sin(k1*x*0.5 + t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 5; ctx.strokeStyle = c1; ctx.globalCompositeOperation = "lighter"; ctx.stroke();

  // laag 2
  ctx.beginPath();
  for (let x=0; x<=w; x+=5){
    const y = mid + A2*Math.sin(k2*x + t*0.85);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 3; ctx.strokeStyle = c2; ctx.stroke();

  // laag 3 (glow)
  ctx.beginPath();
  for (let x=0; x<=w; x+=6){
    const y = mid + A3*Math.sin(k3*x + t*0.65);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 2; ctx.strokeStyle = "#eff7f6cc"; ctx.stroke();
}

function computeBreath(){
  if (hasMic && analyser && timeData){
    analyser.getFloatTimeDomainData(timeData);
    const level = rms(timeData);
    baseline = (1 - baselineFollow)*baseline + baselineFollow*level;
    const x = Math.max(0, level - baseline);
    env = (x > env) ? env + attack*(x-env) : env + release*(x-env);
    return Math.min(1.2, env * breathGain);
  } else {
    // LFO fallback (zodat het altijd leeft)
    const t = performance.now() * 0.0012;
    const lfo = (Math.sin(t) + 1) * 0.25; // 0..0.5
    return lfo;
  }
}

let raf = 0;
function loop(){
  const breath = computeBreath();
  drawBackground();
  drawLayeredWaves(breath);
  raf = requestAnimationFrame(loop);
}

// ====== UI ======
enableMicBtn.addEventListener("click", enableMic);
infoBtn.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","false"));
closeInfo.addEventListener("click", ()=> infoModal.setAttribute("aria-hidden","true"));
document.addEventListener("keydown",(e)=>{
  if (e.key === "Escape") infoModal.setAttribute("aria-hidden","true");
});

// Start visuals meteen
loop();




