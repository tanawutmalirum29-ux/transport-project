const CELL=48;
const canvas=document.querySelector("#mapCanvas");
const stage=document.querySelector("#mapStage");
const ctx=canvas.getContext("2d");
const zoomLabel=document.querySelector("#zoomValue");
const scaleLabel=document.querySelector("#scaleLabel");
const cursor=document.querySelector("#cursorCoords");
const selectedLabel=document.querySelector("#selectedCell");
const viewportLabel=document.querySelector("#viewportLabel");
const gridToggle=document.querySelector("#gridToggle");
const majorToggle=document.querySelector("#majorToggle");

let dpr=1;
let zoom=1;
let camera={x:0,y:0};
let selected=null;
let hover=null;
let dragging=false;
let dragStart=null;
let pointers=new Map();
let pinch=null;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function bounds(){
  const r=stage.getBoundingClientRect();
  return {w:Math.max(1,r.width),h:Math.max(1,r.height)};
}

function centerView(redraw=true){
  const s=bounds();
  camera.x=s.w/2;
  camera.y=s.h/2;
  if(redraw) draw();
}

function resize(){
  const old=bounds();
  const oldCenter={x:old.w/2,y:old.h/2};
  const r=stage.getBoundingClientRect();
  dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.round(r.width*dpr));
  canvas.height=Math.max(1,Math.round(r.height*dpr));

  // Keep the same world point under the viewport center when the browser
  // changes CSS viewport size because of browser zoom, split-screen, rotation,
  // or device UI changes.
  const worldAtCenter=screenToWorld(oldCenter.x,oldCenter.y);
  camera.x=r.width/2-worldAtCenter.x*zoom;
  camera.y=r.height/2-worldAtCenter.y*zoom;

  draw();
  viewportLabel.textContent=Math.round(r.width)+" × "+Math.round(r.height);
}

function screenToWorld(x,y){
  return {x:(x-camera.x)/zoom,y:(y-camera.y)/zoom};
}

function cell(x,y){return{x:Math.floor(x/CELL),y:Math.floor(y/CELL)}}

function updateZoom(){
  const p=Math.round(zoom*100)+"%";
  zoomLabel.textContent=p;
  scaleLabel.textContent=p;
}

function zoomAt(f,x,y){
  const b=screenToWorld(x,y);
  zoom=clamp(zoom*f,.05,3);
  camera.x=x-b.x*zoom;
  camera.y=y-b.y*zoom;
  updateZoom();
  draw();
}

function visibleRange(){
  const s=bounds();
  const a=cell(...Object.values(screenToWorld(0,0)));
  const b=cell(...Object.values(screenToWorld(s.w,s.h)));
  return{sx:Math.min(a.x,b.x)-1,ex:Math.max(a.x,b.x)+1,sy:Math.min(a.y,b.y)-1,ey:Math.max(a.y,b.y)+1};
}

function draw(){
  const s=bounds();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,s.w,s.h);
  ctx.fillStyle="#081018";
  ctx.fillRect(0,0,s.w,s.h);
  const step=CELL*zoom;
  const range=visibleRange();

  ctx.fillStyle="#101a20";
  ctx.fillRect(camera.x+range.sx*step,camera.y+range.sy*step,(range.ex-range.sx+1)*step,(range.ey-range.sy+1)*step);

  if(gridToggle.checked){
    ctx.strokeStyle="#22303a";ctx.lineWidth=1;ctx.beginPath();
    for(let x=range.sx;x<=range.ex+1;x++){const px=Math.round(camera.x+x*step)+.5;ctx.moveTo(px,0);ctx.lineTo(px,s.h)}
    for(let y=range.sy;y<=range.ey+1;y++){const py=Math.round(camera.y+y*step)+.5;ctx.moveTo(0,py);ctx.lineTo(s.w,py)}
    ctx.stroke();
  }
  if(majorToggle.checked){
    ctx.strokeStyle="#354650";ctx.lineWidth=1;ctx.beginPath();
    const firstX=Math.ceil(range.sx/10)*10,firstY=Math.ceil(range.sy/10)*10;
    for(let x=firstX;x<=range.ex+1;x+=10){const px=Math.round(camera.x+x*step)+.5;ctx.moveTo(px,0);ctx.lineTo(px,s.h)}
    for(let y=firstY;y<=range.ey+1;y+=10){const py=Math.round(camera.y+y*step)+.5;ctx.moveTo(0,py);ctx.lineTo(s.w,py)}
    ctx.stroke();
  }

  const ox=camera.x,oy=camera.y;
  ctx.strokeStyle="#5c756d";ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(Math.round(ox)+.5,0);ctx.lineTo(Math.round(ox)+.5,s.h);
  ctx.moveTo(0,Math.round(oy)+.5);ctx.lineTo(s.w,Math.round(oy)+.5);ctx.stroke();

  if(hover){ctx.fillStyle="#61d3a526";ctx.fillRect(camera.x+hover.x*step,camera.y+hover.y*step,step,step)}
  if(selected){
    ctx.fillStyle="#61d3a53d";ctx.fillRect(camera.x+selected.x*step,camera.y+selected.y*step,step,step);
    ctx.strokeStyle="#8ff0c9";ctx.lineWidth=2;
    ctx.strokeRect(camera.x+selected.x*step+.5,camera.y+selected.y*step+.5,Math.max(0,step-1),Math.max(0,step-1));
  }
}

function pos(e){
  const r=canvas.getBoundingClientRect();
  return{x:e.clientX-r.left,y:e.clientY-r.top};
}
function updateHover(p){
  hover=cell(...Object.values(screenToWorld(p.x,p.y)));
  cursor.textContent="X "+hover.x+" · Y "+hover.y;
}
function down(e){
  canvas.setPointerCapture(e.pointerId);
  const p=pos(e);pointers.set(e.pointerId,p);
  if(pointers.size===2){
    const a=[...pointers.values()];
    pinch={dist:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),zoom,center:{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2},world:screenToWorld((a[0].x+a[1].x)/2,(a[0].y+a[1].y)/2)};
    dragging=false;return;
  }
  dragging=true;dragStart={p,startX:camera.x,startY:camera.y};canvas.classList.add("dragging");
}
function move(e){
  const p=pos(e);if(pointers.has(e.pointerId))pointers.set(e.pointerId,p);
  if(pointers.size>=2&&pinch){
    const a=[...pointers.values()],dist=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
    zoom=clamp(pinch.zoom*dist/pinch.dist,.05,3);
    camera.x=pinch.center.x-pinch.world.x*zoom;camera.y=pinch.center.y-pinch.world.y*zoom;
    updateZoom();draw();return;
  }
  updateHover(p);
  if(dragging){camera.x=dragStart.startX+p.x-dragStart.p.x;camera.y=dragStart.startY+p.y-dragStart.p.y}
  draw();
}
function up(e){
  const p=pos(e);pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;
  if(dragging&&dragStart&&Math.hypot(p.x-dragStart.p.x,p.y-dragStart.p.y)<6){
    const c=cell(...Object.values(screenToWorld(p.x,p.y)));selected=c;selectedLabel.textContent=c.x+", "+c.y;
  }
  if(!pointers.size){dragging=false;dragStart=null;canvas.classList.remove("dragging")}
  draw();
}
canvas.addEventListener("pointerdown",down);canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerup",up);canvas.addEventListener("pointercancel",up);
canvas.addEventListener("wheel",e=>{e.preventDefault();const p=pos(e);zoomAt(e.deltaY<0?1.12:.89,p.x,p.y)},{passive:false});
document.querySelector("#zoomIn").onclick=()=>{const s=bounds();zoomAt(1.2,s.w/2,s.h/2)};
document.querySelector("#zoomOut").onclick=()=>{const s=bounds();zoomAt(.833,s.w/2,s.h/2)};
document.querySelector("#zoomFit").onclick=()=>centerView();
document.querySelector("#mobileIn").onclick=()=>document.querySelector("#zoomIn").click();
document.querySelector("#mobileOut").onclick=()=>document.querySelector("#zoomOut").click();
document.querySelector("#mobileFit").onclick=()=>centerView();
gridToggle.onchange=draw;majorToggle.onchange=draw;
new ResizeObserver(resize).observe(stage);
window.visualViewport?.addEventListener("resize",resize);
window.visualViewport?.addEventListener("scroll",resize);
resize();
