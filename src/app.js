"use strict";
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

function resize(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener("resize", resize);

let running=false, raf=0;
function loop(){
  ctx.fillStyle = "rgba(11,16,32,0.1)";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  raf = requestAnimationFrame(loop);
}

startBtn.addEventListener("click", ()=>{
  if (running) return;
  running = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  loop();
});
stopBtn.addEventListener("click", ()=>{
  if (!running) return;
  running = false;
  cancelAnimationFrame(raf);
  startBtn.disabled = false;
  stopBtn.disabled = true;
});
