"use strict";

// DOM refs
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn  = document.getElementById("stopBtn");

// Canvas sizing (scherp op high-DPI)
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

// Audio state
let running = false, raf = 0;
let audioCtx, analyser, timeData;

function rms(buf){
  let sum = 0;
  for (let i=0;i<buf.length;i++){ const s = buf[i]; sum += s*s; }
  return Math.sqrt(sum / buf.length);
}

async function start(){
  if (running) return;
  // vraag alleen de microfoon (camera komt later)
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:false },
      video: false
    });
  } catch (e) {
    alert("Geef microfoon-toegang en zorg dat je via http://localhost draait (Live Server).");
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.85;
  source.connect(analyser);
  timeData = new Float32Array(analyser.fftSize);

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

function drawWave(amplitude){
  const w = canvas.width, h = canvas.height;
  // zachte achtergrond-fade (geen flitsen)
  ctx.fillStyle = "rgba(11,16,32,0.12)";
  ctx.fillRect(0,0,w,h);

  // parameters
  const mid = h/2;
  const A = Math.min(120, amplitude * 300); // adem → pixel amplitude
  const k = (2*Math.PI) / w;                // golflengte
  const t = performance.now() * 0.002;      // fase/snelheid

  ctx.beginPath();
  for (let x=0; x<=w; x+=4){
    const y = mid + A * Math.sin(k*x + t);
    if (x===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#7bdff2";
  ctx.stroke();
}

function loop(){
  analyser.getFloatTimeDomainData(timeData);
  // eenvoudige baseline: haal ~ruis weg en schaal
  const level = Math.max(0, rms(timeData) - 0.015) * 4;
  drawWave(level);
  raf = requestAnimationFrame(loop);
}

// UI events
startBtn.addEventListener("click", start);
stopBtn .addEventListener("click", stop);

