import {
  ROAD_SPECS,
  ROAD_STORAGE_KEY,
  pointKey,
  expandOrthogonal,
  normalizePath,
  createRoad,
  buildRoadNetwork,
  findRoadAtPoint
} from "./road-network.js";
import {
  buildSmoothCenterline,
  offsetPolyline,
  polylineLength,
  pointAlongPolyline
} from "./road-geometry.js";

const CELL=48;
const LANE_WIDTH=10;

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
const modeLabel=document.querySelector("#modeLabel");
const mapMessage=document.querySelector("#mapMessage");
const roadBuilder=document.querySelector("#roadBuilder");
const roadStatus=document.querySelector("#roadStatus");
const mobileRoadPanel=document.querySelector("#mobileRoadPanel");
const mobileRoadStatus=document.querySelector("#mobileRoadStatus");
const finishRoad=document.querySelector("#finishRoad");
const mobileFinishRoad=document.querySelector("#mobileFinishRoad");
const roadCount=document.querySelector("#roadCount");
const segmentCount=document.querySelector("#segmentCount");
const junctionCount=document.querySelector("#junctionCount");

let dpr=1;
let zoom=1;
let camera={x:0,y:0};
let selected=null;
let selectedRoadId=null;
let hover=null;

let activeTool="select";
let selectedRoadType="two-2";
let buildingPath=[];
let roads=[];
let roadSequence=0;

let dragging=false;
let dragStart=null;
let pointers=new Map();
let pinch=null;
let multiTouch=false;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function bounds(){
  const r=stage.getBoundingClientRect();
  return {w:Math.max(1,r.width),h:Math.max(1,r.height)};
}

function worldCellToScreen(p){
  const step=CELL*zoom;
  return {
    x:camera.x+(p.x+0.5)*step,
    y:camera.y+(p.y+0.5)*step
  };
}

function screenToWorld(x,y){
  return {x:(x-camera.x)/zoom,y:(y-camera.y)/zoom};
}

function cellFromWorld(p){
  return {x:Math.floor(p.x/CELL),y:Math.floor(p.y/CELL)};
}

function cellFromScreen(x,y){
  return cellFromWorld(screenToWorld(x,y));
}

function loadRoads(){
  try{
    const raw=localStorage.getItem(ROAD_STORAGE_KEY);
    if(!raw) return;
    const data=JSON.parse(raw);
    if(!Array.isArray(data)) return;

    roads=data.map((r)=>{
      if(!r||!Array.isArray(r.path)||r.path.length<2) return null;
      const spec=ROAD_SPECS[r.type]||ROAD_SPECS["two-2"];
      return createRoad(String(r.id||newRoadId()),spec.id,r.path);
    }).filter(Boolean);
  }catch(error){
    console.warn("Could not load saved roads:",error);
    roads=[];
  }
}

function saveRoads(){
  try{
    localStorage.setItem(ROAD_STORAGE_KEY,JSON.stringify(roads));
  }catch(error){
    console.warn("Could not save roads:",error);
  }
}

function newRoadId(){
  roadSequence+=1;
  return "road-"+Date.now().toString(36)+"-"+roadSequence;
}

function network(){
  return buildRoadNetwork(roads);
}

function roadSpec(road){
  return ROAD_SPECS[road.type]||ROAD_SPECS["two-2"];
}

function roadWidthPx(road){
  return roadSpec(road).lanes*LANE_WIDTH*zoom+8*zoom;
}

function laneWorldOffsets(road){
  const spec=roadSpec(road);
  const laneW=LANE_WIDTH*zoom;
  const half=spec.lanes*laneW/2;
  return Array.from({length:spec.lanes},(_,i)=>-half+(i+0.5)*laneW);
}

function roadCenterline(road,pathOverride=null){
  const path=pathOverride||road.path;
  const points=(path||[]).map(worldCellToScreen);
  return buildSmoothCenterline(points,CELL*zoom*0.34,9);
}

function updateStats(){
  const net=network();
  roadCount.textContent=String(roads.length);
  segmentCount.textContent=String(net.edges.length);
  junctionCount.textContent=String(net.junctions.length);
}

function formatPoint(p){
  return "X "+p.x+" · Y "+p.y;
}

function updateRoadStatus(){
  const text=buildingPath.length
    ? "กำลังวางจาก "+formatPoint(buildingPath[buildingPath.length-1])+" · แตะจุดต่อไปเพื่อสร้างช่วง · กดจบเมื่อเสร็จ"
    : "เลือกจุดแรกเพื่อเริ่มสร้างถนน";

  roadStatus.textContent=text;
  mobileRoadStatus.textContent=buildingPath.length
    ? "ต่อจาก "+formatPoint(buildingPath[buildingPath.length-1])+" · แตะจุดต่อไป · กดจบ"
    : "แตะจุดแรกเพื่อเริ่ม · แตะจุดต่อไปเพื่อสร้าง · กดจบ";
}

function updateModeUI(){
  const names={select:"เลือก / เลื่อน",road:"สร้างถนน",erase:"ลบถนน"};
  modeLabel.textContent=names[activeTool];

  document.querySelector("#mapStage").classList.toggle("road-mode",activeTool==="road");
  document.querySelector("#mapStage").classList.toggle("erase-mode",activeTool==="erase");
  roadBuilder.classList.toggle("active-builder",activeTool==="road");
  mobileRoadPanel.classList.toggle("visible",activeTool==="road");

  document.querySelectorAll(".tool[data-tool]").forEach((button)=>{
    button.classList.toggle("active",button.dataset.tool===activeTool);
  });
  document.querySelectorAll(".mobile-tool[data-tool]").forEach((button)=>{
    button.classList.toggle("active",button.dataset.tool===activeTool);
  });

  if(activeTool==="select") mapMessage.textContent="กริดไม่มีขอบเขต";
  else if(activeTool==="road") mapMessage.textContent="สร้างถนน: ทางเลี้ยวจะโค้งต่อเนื่องและเชื่อมกับ junction";
  else mapMessage.textContent="คลิก/แตะบนถนนเพื่อลบทั้งเส้น";

  updateRoadStatus();
  draw();
}

function setTool(tool){
  if(tool!==activeTool) buildingPath=[];
  activeTool=tool;
  updateModeUI();
}

function setRoadType(type){
  if(!ROAD_SPECS[type]) return;
  selectedRoadType=type;
  document.querySelectorAll(".road-type[data-road-type]").forEach((button)=>{
    button.classList.toggle("active",button.dataset.roadType===type);
  });
  updateRoadStatus();
  draw();
}

function finishBuilding(){
  if(activeTool!=="road") return;

  if(buildingPath.length>=2){
    const spec=ROAD_SPECS[selectedRoadType];
    const path=normalizePath(buildingPath);

    if(path.length>=2){
      const signature=path.map(pointKey).join("|");
      const reverse=spec.oneWay ? "" : [...path].reverse().map(pointKey).join("|");
      const duplicate=roads.some((road)=>{
        if(road.type!==spec.id) return false;
        const sig=(road.path||[]).map(pointKey).join("|");
        return sig===signature||(reverse&&sig===reverse);
      });

      if(!duplicate){
        roads.push(createRoad(newRoadId(),spec.id,path));
        saveRoads();
      }
    }
  }

  buildingPath=[];
  selectedRoadId=null;
  updateStats();
  updateRoadStatus();
  draw();
}

function cancelBuilding(){
  if(buildingPath.length){
    buildingPath=[];
    updateRoadStatus();
    draw();
  }
}

function addRoadPoint(p){
  const point={x:Math.trunc(p.x),y:Math.trunc(p.y)};
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y)) return;

  if(!buildingPath.length){
    buildingPath=[point];
    updateRoadStatus();
    draw();
    return;
  }

  const last=buildingPath[buildingPath.length-1];
  if(last.x===point.x&&last.y===point.y) return;

  const route=expandOrthogonal(last,point);
  for(let i=1;i<route.length;i++) buildingPath.push(route[i]);

  selected=null;
  selectedRoadId=null;
  updateRoadStatus();
  draw();
}

function eraseRoadAt(p){
  const road=findRoadAtPoint(roads,p);
  if(!road) return false;

  roads=roads.filter((item)=>item.id!==road.id);
  if(selectedRoadId===road.id) selectedRoadId=null;
  saveRoads();
  updateStats();
  mapMessage.textContent="ลบ "+roadSpec(road).label+" แล้ว";
  draw();
  return true;
}

function centerView(){
  const s=bounds();
  camera.x=s.w/2;
  camera.y=s.h/2;
  draw();
}

function resize(){
  const old=bounds();
  const oldCenter={x:old.w/2,y:old.h/2};
  const r=stage.getBoundingClientRect();

  dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.round(r.width*dpr));
  canvas.height=Math.max(1,Math.round(r.height*dpr));

  const worldAtCenter=screenToWorld(oldCenter.x,oldCenter.y);
  camera.x=r.width/2-worldAtCenter.x*zoom;
  camera.y=r.height/2-worldAtCenter.y*zoom;

  draw();
  viewportLabel.textContent=Math.round(r.width)+" × "+Math.round(r.height);
}

function updateZoom(){
  const p=Math.round(zoom*100)+"%";
  zoomLabel.textContent=p;
  scaleLabel.textContent=p;
}

function zoomAt(f,x,y){
  const before=screenToWorld(x,y);
  zoom=clamp(zoom*f,.05,3);
  camera.x=x-before.x*zoom;
  camera.y=y-before.y*zoom;
  updateZoom();
  draw();
}

function visibleRange(){
  const s=bounds();
  const a=cellFromScreen(0,0);
  const b=cellFromScreen(s.w,s.h);
  return {
    sx:Math.min(a.x,b.x)-2,
    ex:Math.max(a.x,b.x)+2,
    sy:Math.min(a.y,b.y)-2,
    ey:Math.max(a.y,b.y)+2
  };
}

function visibleRoad(road){
  if(!road.path?.length) return false;
  const range=visibleRange();
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;

  for(const p of road.path){
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
    minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
  }

  const pad=Math.max(1,Math.ceil((roadSpec(road).lanes*LANE_WIDTH+12)/CELL));
  return maxX>=range.sx-pad&&minX<=range.ex+pad&&maxY>=range.sy-pad&&minY<=range.ey+pad;
}

function drawPolyline(points,width,strokeStyle,options={}){
  if(points.length<2) return;
  ctx.save();
  ctx.strokeStyle=strokeStyle;
  ctx.lineWidth=Math.max(0.5,width);
  ctx.lineCap=options.lineCap||"round";
  ctx.lineJoin=options.lineJoin||"round";
  ctx.setLineDash(options.dash||[]);
  ctx.beginPath();
  ctx.moveTo(points[0].x,points[0].y);
  for(let i=1;i<points.length;i++) ctx.lineTo(points[i].x,points[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawRoadBed(road){
  if(!visibleRoad(road)) return;
  const points=roadCenterline(road);
  const width=roadWidthPx(road);

  drawPolyline(points,width+6*zoom,"#11171d",{});
  drawPolyline(points,width+2*zoom,"#59616a",{});
  drawPolyline(points,width,"#343c44",{});

  // Slightly darker inner asphalt makes the carriageway read as a surface
  // rather than a single flat line, especially on large displays.
  drawPolyline(points,Math.max(1,width-4*zoom),"#303840",{});
}

function drawJunctionPatches(net){
  for(const junction of net.junctions){
    const roadsHere=roads.filter((road)=>junction.roadIds.includes(road.id));
    if(!roadsHere.length) continue;

    const radius=Math.max(...roadsHere.map((road)=>roadWidthPx(road)/2))+9*zoom;
    const p=worldCellToScreen(junction);

    ctx.save();
    ctx.fillStyle="#10161b";
    ctx.beginPath();
    ctx.arc(p.x,p.y,radius+3*zoom,0,Math.PI*2);
    ctx.fill();

    ctx.fillStyle="#343c44";
    ctx.beginPath();
    ctx.arc(p.x,p.y,radius,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

function drawLaneLine(points,offset,width,color,dash){
  if(points.length<2) return;
  drawPolyline(offsetPolyline(points,offset),width,color,{lineCap:"butt",lineJoin:"round",dash});
}

function drawLaneMarkings(road){
  if(!visibleRoad(road)) return;

  const spec=roadSpec(road);
  const centerline=roadCenterline(road);
  const laneW=LANE_WIDTH*zoom;
  const half=spec.lanes*laneW/2;
  const edgeOffset=Math.max(0,half-1.8*zoom);
  const dash=[Math.max(3,8*zoom),Math.max(4,11*zoom)];

  drawLaneLine(centerline,-edgeOffset,Math.max(0.8,1.15*zoom),"#d6dde2",[]);
  drawLaneLine(centerline,edgeOffset,Math.max(0.8,1.15*zoom),"#d6dde2",[]);

  if(spec.oneWay){
    for(let i=1;i<spec.lanes;i++){
      const offset=-half+i*laneW;
      drawLaneLine(centerline,offset,Math.max(0.8,1*zoom),"#b8c1c8",dash);
    }
  }else{
    for(let i=1;i<spec.lanes;i++){
      const offset=-half+i*laneW;

      if(spec.lanes===2){
        // One solid double-yellow centerline is the separator between
        // opposing traffic directions.
        drawLaneLine(centerline,offset,Math.max(1,1.15*zoom),"#e6bf52",[]);
      }else if(i===spec.lanes/2){
        // Wider divided road: two closely spaced yellow center lines.
        drawLaneLine(centerline,offset-1.35*zoom,Math.max(0.9,1*zoom),"#e6bf52",[]);
        drawLaneLine(centerline,offset+1.35*zoom,Math.max(0.9,1*zoom),"#e6bf52",[]);
      }else{
        drawLaneLine(centerline,offset,Math.max(0.8,1*zoom),"#b8c1c8",dash);
      }
    }
  }

  if(spec.oneWay) drawDirectionArrows(road,centerline);
}

function drawDirectionArrows(road,centerline){
  const spec=roadSpec(road);
  if(zoom<0.22||centerline.length<2) return;

  const laneW=LANE_WIDTH*zoom;
  const half=spec.lanes*laneW/2;
  const spacing=clamp(170*zoom,48,220);

  for(let lane=0;lane<spec.lanes;lane++){
    const offset=-half+(lane+0.5)*laneW;
    const line=offsetPolyline(centerline,offset);
    const total=polylineLength(line);
    const start=Math.min(spacing*.6,total*.25);

    for(let d=start;d<total;d+=spacing){
      const at=pointAlongPolyline(line,d);
      if(!at) continue;

      const size=clamp(5.5*zoom,3.5,9);
      const ux=at.dir.x,uy=at.dir.y;
      const px=-uy,py=ux;
      const p=at.point;

      ctx.save();
      ctx.fillStyle="#dce3e7";
      ctx.beginPath();
      ctx.moveTo(p.x+ux*size*1.5,p.y+uy*size*1.5);
      ctx.lineTo(p.x-ux*size+px*size*.72,p.y-uy*size+py*size*.72);
      ctx.lineTo(p.x-ux*size-px*size*.72,p.y-uy*size-py*size*.72);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

function buildJunctionKeySet(net){
  return new Set(net.junctions.map((j)=>pointKey(j)));
}

function drawSelectedRoad(){
  if(!selectedRoadId) return;
  const road=roads.find((item)=>item.id===selectedRoadId);
  if(!road||!visibleRoad(road)) return;
  drawPolyline(roadCenterline(road),roadWidthPx(road)+9*zoom,"#61d3a54d",{});
}

function drawPreview(){
  if(activeTool!=="road"||buildingPath.length===0) return;

  let preview=buildingPath;
  if(hover){
    const last=buildingPath[buildingPath.length-1];
    if(last.x!==hover.x||last.y!==hover.y){
      preview=buildingPath.concat(expandOrthogonal(last,hover).slice(1));
    }
  }

  const spec=ROAD_SPECS[selectedRoadType];
  const centerline=roadCenterline({path:preview,type:spec.id,lanes:spec.lanes,oneWay:spec.oneWay});
  const width=spec.lanes*LANE_WIDTH*zoom+8*zoom;

  drawPolyline(centerline,width+5*zoom,"#0f171d",{});
  drawPolyline(centerline,width,"#5fe0b0aa",{dash:[9*zoom,7*zoom].map((v)=>Math.max(3,v))});

  const start=worldCellToScreen(buildingPath[0]);
  ctx.save();
  ctx.fillStyle="#9af4d0";
  ctx.strokeStyle="#14372e";
  ctx.lineWidth=Math.max(1,1.5*zoom);
  ctx.beginPath();
  ctx.arc(start.x,start.y,Math.max(4,5*zoom),0,Math.PI*2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function draw(){
  const s=bounds();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,s.w,s.h);
  ctx.fillStyle="#081018";
  ctx.fillRect(0,0,s.w,s.h);

  const step=CELL*zoom;
  const range=visibleRange();

  if(gridToggle.checked){
    let gridEvery=1;
    if(step<2) gridEvery=5;
    else if(step<4) gridEvery=2;

    ctx.strokeStyle="#22303a";
    ctx.lineWidth=1;
    ctx.beginPath();

    const startX=Math.ceil(range.sx/gridEvery)*gridEvery;
    const startY=Math.ceil(range.sy/gridEvery)*gridEvery;

    for(let x=startX;x<=range.ex+1;x+=gridEvery){
      const px=Math.round(camera.x+x*step)+.5;
      ctx.moveTo(px,0);ctx.lineTo(px,s.h);
    }
    for(let y=startY;y<=range.ey+1;y+=gridEvery){
      const py=Math.round(camera.y+y*step)+.5;
      ctx.moveTo(0,py);ctx.lineTo(s.w,py);
    }
    ctx.stroke();
  }

  if(majorToggle.checked){
    ctx.strokeStyle="#354650";
    ctx.lineWidth=1;
    ctx.beginPath();

    const firstX=Math.ceil(range.sx/10)*10;
    const firstY=Math.ceil(range.sy/10)*10;

    for(let x=firstX;x<=range.ex+1;x+=10){
      const px=Math.round(camera.x+x*step)+.5;
      ctx.moveTo(px,0);ctx.lineTo(px,s.h);
    }
    for(let y=firstY;y<=range.ey+1;y+=10){
      const py=Math.round(camera.y+y*step)+.5;
      ctx.moveTo(0,py);ctx.lineTo(s.w,py);
    }
    ctx.stroke();
  }

  // World origin is a coordinate reference, never a world boundary.
  ctx.strokeStyle="#5c756d";
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(Math.round(camera.x)+.5,0);
  ctx.lineTo(Math.round(camera.x)+.5,s.h);
  ctx.moveTo(0,Math.round(camera.y)+.5);
  ctx.lineTo(s.w,Math.round(camera.y)+.5);
  ctx.stroke();

  const net=network();

  roads.forEach(drawRoadBed);
  roads.forEach(drawLaneMarkings);
  drawJunctionPatches(net);
  drawSelectedRoad();

  if(hover){
    const hp=worldCellToScreen(hover);
    ctx.fillStyle=activeTool==="erase"?"#e9787844":"#61d3a526";
    ctx.fillRect(hp.x-step/2,hp.y-step/2,step,step);
  }

  if(selected){
    const sp=worldCellToScreen(selected);
    ctx.fillStyle="#61d3a53d";
    ctx.fillRect(sp.x-step/2,sp.y-step/2,step,step);
    ctx.strokeStyle="#8ff0c9";
    ctx.lineWidth=2;
    ctx.strokeRect(sp.x-step/2+.5,sp.y-step/2+.5,Math.max(0,step-1),Math.max(0,step-1));
  }

  drawPreview();
}

function pos(e){
  const r=canvas.getBoundingClientRect();
  return {x:e.clientX-r.left,y:e.clientY-r.top};
}

function updateHover(p){
  hover=cellFromScreen(p.x,p.y);
  cursor.textContent=formatPoint(hover);
}

function pointerDown(e){
  const p=pos(e);
  pointers.set(e.pointerId,p);

  if(pointers.size===2){
    const a=[...pointers.values()];
    pinch={
      dist:Math.max(1,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)),
      zoom,
      center:{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2},
      world:screenToWorld((a[0].x+a[1].x)/2,(a[0].y+a[1].y)/2)
    };
    multiTouch=true;
    dragging=false;
    dragStart=null;
    return;
  }

  if(e.pointerType==="mouse"&&e.button!==0) return;

  if(activeTool==="select"){
    canvas.setPointerCapture?.(e.pointerId);
    dragging=true;
    dragStart={p,startX:camera.x,startY:camera.y};
    canvas.classList.add("dragging");
  }
}

function pointerMove(e){
  const p=pos(e);
  if(pointers.has(e.pointerId)) pointers.set(e.pointerId,p);

  if(pointers.size>=2&&pinch){
    const a=[...pointers.values()];
    const dist=Math.max(1,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y));
    zoom=clamp(pinch.zoom*dist/pinch.dist,.05,3);
    camera.x=pinch.center.x-pinch.world.x*zoom;
    camera.y=pinch.center.y-pinch.world.y*zoom;
    updateZoom();
    draw();
    return;
  }

  updateHover(p);

  if(activeTool==="select"&&dragging&&dragStart){
    camera.x=dragStart.startX+p.x-dragStart.p.x;
    camera.y=dragStart.startY+p.y-dragStart.p.y;
  }

  draw();
}

function pointerUp(e){
  const p=pos(e);
  const statePointers=pointers.size;
  pointers.delete(e.pointerId);

  if(statePointers>=2||multiTouch){
    if(pointers.size===0){
      pinch=null;
      multiTouch=false;
    }
    draw();
    return;
  }

  if(activeTool==="select"){
    if(dragging&&dragStart&&Math.hypot(p.x-dragStart.p.x,p.y-dragStart.p.y)<6){
      const c=cellFromScreen(p.x,p.y);
      selected=c;
      selectedRoadId=findRoadAtPoint(roads,c)?.id||null;
      selectedLabel.textContent=c.x+", "+c.y;
    }
    dragging=false;
    dragStart=null;
    canvas.classList.remove("dragging");
  }else if(activeTool==="road"){
    addRoadPoint(cellFromScreen(p.x,p.y));
  }else if(activeTool==="erase"){
    const c=cellFromScreen(p.x,p.y);
    selected=c;
    selectedLabel.textContent=c.x+", "+c.y;
    if(!eraseRoadAt(c)) mapMessage.textContent="ไม่พบถนนในช่องนี้";
  }

  draw();
}

canvas.addEventListener("pointerdown",pointerDown);
canvas.addEventListener("pointermove",pointerMove);
canvas.addEventListener("pointerup",pointerUp);
canvas.addEventListener("pointercancel",pointerUp);

canvas.addEventListener("wheel",(e)=>{
  e.preventDefault();
  const p=pos(e);
  zoomAt(e.deltaY<0?1.12:.89,p.x,p.y);
},{passive:false});

canvas.addEventListener("contextmenu",(e)=>e.preventDefault());

document.querySelectorAll("[data-tool]").forEach((button)=>{
  button.addEventListener("click",()=>setTool(button.dataset.tool));
});

document.querySelectorAll("[data-road-type]").forEach((button)=>{
  button.addEventListener("click",()=>setRoadType(button.dataset.roadType));
});

finishRoad.addEventListener("click",finishBuilding);
mobileFinishRoad.addEventListener("click",finishBuilding);

document.addEventListener("keydown",(e)=>{
  if(e.key==="Escape") cancelBuilding();
  if(e.key==="Enter"&&activeTool==="road") finishBuilding();
});

document.querySelector("#zoomIn").onclick=()=>{
  const s=bounds();
  zoomAt(1.2,s.w/2,s.h/2);
};

document.querySelector("#zoomOut").onclick=()=>{
  const s=bounds();
  zoomAt(.833,s.w/2,s.h/2);
};

document.querySelector("#zoomFit").onclick=centerView;
document.querySelector("#mobileIn").onclick=()=>document.querySelector("#zoomIn").click();
document.querySelector("#mobileOut").onclick=()=>document.querySelector("#zoomOut").click();
document.querySelector("#mobileFit").onclick=centerView;

gridToggle.onchange=draw;
majorToggle.onchange=draw;

new ResizeObserver(resize).observe(stage);
window.visualViewport?.addEventListener("resize",resize);
window.visualViewport?.addEventListener("scroll",resize);

loadRoads();
updateStats();
updateModeUI();
resize();
