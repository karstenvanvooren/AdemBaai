"use strict";

// DOM
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn  = document.getElementById("stopBtn");

// Canvas scherpte
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

// ===== Audio state =====
let running = false, raf = 0;
let audioCtx, analyser, timeData;

// Envelope + baseline
let env = 0;           // volgt je adem (glad)
let baseline = 0.02;   // langzaam meebewegende ruisvloer
const attack = 0.15;   // sneller omhoog
const release = 0.02;  // trager omlaag
const baselineFollow = 0.001; // heel traag meeschuiven

// Gain voor mapping (voelbaar effect zonder te schreeuwen)
const breathGain = 3.5;

// RMS helper
function rms(buf){
  let sum = 0;
  for (let i=0;i<buf.length;i++){ const s = buf[i]; sum += s*s; }
  return Math.sqrt(sum / buf.length);
}

async function start(){
  if (running) return;
  let stream;
  try {
    // BELANGRIJK: filters UIT, anders verdwijnt ademgeluid.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    });
  } catch (e) {
    alert("Microfoon-toegang nodig. Start via http://localhost (Live Server) en geef toestemming.");
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;                 // iets hogere resolutie
  analyser.smoothingTimeConstant = 0.9;    // rustiger
  source.connect(analyser);
  timeData = new Float32Array(analyser.fftSize);

  // mini-kalibratie: paar honderd ms ruisvloer inschatten
  baseline = 0.02; env = 0;
  const tStart = performance.now();
  while (performance.now() - tStart < 500) {
    analyser.getFloatTimeDomainData(timeData);
    baseline = 0.9*baseline + 0.1*rms(timeData);
    await new Promise(r=>setTimeout(r, 16));
  }

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
  if (audioCtx && audioCtx.state !== "closed") audioCtx.suspend();
}

function loop(){
  // 1) meet RMS
  analyser.getFloatTimeDomainData(timeData);
  const level = rms(timeData); // ~0..0.4

  // 2) update baseline heel traag (past zich aan kamerruis aan)
  baseline = (1 - baselineFollow) * baseline + baselineFollow * level;

  // 3) adem-schakeling: we halen baseline weg en volgen met envelope
  //    Attack sneller, release trager → adem voelt “organisch”
  const x = Math.max(0, level - baseline);
  const a = attack, r = release;
  env = (x > env) ? (env + a*(x - env)) : (env + r*(x - env));

  // 4) map naar een prettig bereik
  const breath = Math.min(1.2, env * breathGain);

  drawWave(breath);
  raf = requestAnimationFrame(loop);
}

function drawWave(amplitude){
  const w = canvas.width, h = canvas.height;

  // Zachte achtergrond
  ctx.fillStyle = "rgba(11,16,32,0.12)";
  ctx.fillRect(0,0,w,h);

  // Golfparameters: amplitude, snelheid iets op adem laten meeschommelen
  const mid = h/2;
  const A = Math.min(140, amplitude * 320);
  const k = (2*Math.PI) / w;
  const t = performance.now() * (0.0018 + amplitude*0.0007);

  // Extra: twee fasen voor rijkere golf
  ctx.beginPath();
  for (let x=0; x<=w; x+=3){
    const y = mid
      + A * Math.sin(k*x + t)
      + 0.35*A * Math.sin(k*x*0.5 + t*0.6);
    if (x===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#7bdff2";
  ctx.stroke();

  // subtiele “glow”
  ctx.beginPath();
  for (let x=0; x<=w; x+=6){
    const y = mid + A * Math.sin(k*x + t);
    if (x===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(178,247,239,0.6)";
  ctx.stroke();
}

// UI
startBtn.addEventListener("click", start);
stopBtn .addEventListener("click", stop);


