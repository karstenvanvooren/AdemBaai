"use strict";

// ===== DOM =====
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn  = document.getElementById("stopBtn");
const calBtn   = document.getElementById("calBtn");

const paletteSel = document.getElementById("palette");
const reducedEl  = document.getElementById("reduced");
const contrastEl = document.getElementById("contrast");
const gainEl     = document.getElementById("gain");

// ===== Canvas DPI =====
function resize(){
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio||1));
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    canvas.style.width = "100vw"; canvas.style.height = "100vh";
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
}
resize();
addEventListener("resize", resize);

// ===== State =====
let running = false, raf = 0;
let audioCtx, analyser, timeData;

// Adem-envelope + baseline
let env = 0;
let baseline = 0.02;
let attack = 0.12;    // sneller omhoog
let release = 0.03;   // rustiger omlaag
let baselineFollow = 0.001; // traag meeschuiven met ruis

let breathGain = parseFloat(gainEl.value || "3.5");
let reduced = false;

// ===== Helpers =====
function rms(buf){
  let sum = 0;
  for (let i=0;i<buf.length;i++){ const s=buf[i]; sum += s*s; }
  return Math.sqrt(sum / buf.length);
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

// ===== UI bindings =====
function applyPalette(name){
  document.body.classList.remove("calm","focus","playful");
  document.body.classList.add(name);
  localStorage.setItem("ab_palette", name);
}
function applyReduced(on){
  reduced = on;
  localStorage.setItem("ab_reduced", on?"1":"0");
}
function applyContrast(on){
  document.body.classList.toggle("high-contrast", on);
  localStorage.setItem("ab_contrast", on?"1":"0");
}
function loadSettings(){
  const p = localStorage.getItem("ab_palette") || "calm";
  const r = localStorage.getItem("ab_reduced") === "1";
  const c = localStorage.getItem("ab_contrast") === "1";
  const g = parseFloat(localStorage.getItem("ab_gain") || "3.5");

  paletteSel.value = p; applyPalette(p);
  reducedEl.checked = r; applyReduced(r);
  contrastEl.checked = c; applyContrast(c);
  gainEl.value = g; breathGain = g;
}
loadSettings();

paletteSel.addEventListener("change", ()=> applyPalette(paletteSel.value));
reducedEl.addEventListener("change", ()=> applyReduced(reducedEl.checked));
contrastEl.addEventListener("change", ()=> applyContrast(contrastEl.checked));
gainEl.addEventListener("input", ()=>{
  breathGain = parseFloat(gainEl.value);
  localStorage.setItem("ab_gain", breathGain.toString());
});

// ===== Audio start/stop =====
async function start(){
  if (running) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false },
      video: false
    });
  } catch {
    alert("Geef microfoon-toegang en draai via Live Server (localhost).");
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.9;
  source.connect(analyser);
  timeData = new Float32Array(analyser.fftSize);

  // korte baseline-kalibratie
  calBtn.disabled = false;
  await calibrate(500);

  running = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;

  loop();
}

function stop(){
  if (!running) return;
  running = false;
  cancelAnimationFrame(raf);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  calBtn.disabled = true;
  if (audioCtx && audioCtx.state !== "closed") audioCtx.suspend();
}

async function calibrate(ms=1000){
  if (!analyser) return;
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    analyser.getFloatTimeDomainData(timeData);
    baseline = 0.9*baseline + 0.1*rms(timeData);
    await new Promise(r=>setTimeout(r, 16));
  }
}

// ===== Visuals =====
function paletteColors(){
  const s = getComputedStyle(document.body);
  return [s.getPropertyValue("--p1").trim(), s.getPropertyValue("--p2").trim(), s.getPropertyValue("--p3").trim()];
}

function drawBackground(){
  // zachte filmische fade
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = reduced ? "rgba(11,16,32,0.18)" : "rgba(11,16,32,0.12)";
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function drawLayeredWaves(amplitude){
  const w = canvas.width, h = canvas.height;
  const [c1,c2,c3] = paletteColors();

  const mid = h/2;
  const baseA = clamp(amplitude, 0, 1.2);
  const A1 = Math.min(140, baseA * 320);
  const A2 = A1 * 0.55;
  const A3 = A1 * 0.3;

  const k1 = (2*Math.PI)/w;
  const k2 = k1*0.7;
  const k3 = k1*0.4;

  const speed = reduced ? 0.0012 : 0.0018;
  const t = performance.now() * (speed + baseA*0.0005);

  // laag 1 (diep)
  ctx.beginPath();
  for (let x=0; x<=w; x+=4){
    const y = mid + A1 * Math.sin(k1*x + t) + 0.35*A1*Math.sin(k1*x*0.5 + t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 5;
  ctx.strokeStyle = c1;
  ctx.globalCompositeOperation = "lighter";
  ctx.stroke();

  // laag 2 (midden)
  ctx.beginPath();
  for (let x=0; x<=w; x+=5){
    const y = mid + A2 * Math.sin(k2*x + t*0.8);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = c2;
  ctx.stroke();

  // laag 3 (glow)
  ctx.beginPath();
  for (let x=0; x<=w; x+=6){
    const y = mid + A3 * Math.sin(k3*x + t*0.6);
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${c3}cc`; // iets transparant
  ctx.stroke();
}

function loop(){
  // adem meten
  analyser.getFloatTimeDomainData(timeData);
  const level = rms(timeData);

  // baseline traag volgen
  baseline = (1 - baselineFollow)*baseline + baselineFollow*level;

  // envelope met attack/release
  const x = Math.max(0, level - baseline);
  env = (x > env)
    ? env + attack * (x - env)
    : env + release * (x - env);

  const breath = Math.min(1.2, env * breathGain);

  drawBackground();
  drawLayeredWaves(breath);

  raf = requestAnimationFrame(loop);
}

// ===== Events =====
startBtn.addEventListener("click", start);
stopBtn .addEventListener("click", stop);
calBtn  .addEventListener("click", ()=>calibrate(1000));

document.addEventListener("keydown", (e)=>{
  if (e.key === "Enter") (running ? stop() : start());
  if (e.key.toLowerCase() === "r"){ reducedEl.checked = !reducedEl.checked; applyReduced(reducedEl.checked); }
  if (e.key.toLowerCase() === "h"){ contrastEl.checked = !contrastEl.checked; applyContrast(contrastEl.checked); }
  if (e.key.toLowerCase() === "c"){ calibrate(1000); }
});



