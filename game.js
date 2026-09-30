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
const mapStage=document.querySelector("#mapStage");

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

function isFinitePoint(p){
  return Number.isFinite(p.x)&&Number.isFinite(p.y);
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
  return roadSpec(road).lanes*LANE_WIDTH*zoom+6*zoom;
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
  const names={
    select:"เลือก / เลื่อน",
    road:"สร้างถนน",
    erase:"ลบถนน"
  };
  modeLabel.textContent=names[activeTool];
  mapStage.classList.toggle("road-mode",activeTool==="road");
  mapStage.classList.toggle("erase-mode",activeTool==="erase");
  roadBuilder.classList.toggle("active-builder",activeTool==="road");
  mobileRoadPanel.classList.toggle("visible",activeTool==="road");

  document.querySelectorAll(".tool[data-tool]").forEach((button)=>{
    button.classList.toggle("active",button.dataset.tool===activeTool);
  });
  document.querySelectorAll(".mobile-tool[data-tool]").forEach((button)=>{
    button.classList.toggle("active",button.dataset.tool===activeTool);
  });

  if(activeTool==="select"){
    mapMessage.textContent="กริดไม่มีขอบเขต";
  }else if(activeTool==="road"){
    mapMessage.textContent="สร้างถนน: แตะทีละจุด · รองรับทางเลี้ยวและการต่อแยก";
  }else{
    mapMessage.textContent="คลิก/แตะบนถนนเพื่อลบทั้งเส้น";
  }
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
  if(!isFinitePoint(point)) return;
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
  mapMessage.textContent="ลบ "+(roadSpec(road).label)+" แล้ว";
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
  const s=bounds();
  const range=visibleRange();
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const p of road.path){
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
    minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
  }
  const pad=Math.max(1,Math.ceil((roadSpec(road).lanes*LANE_WIDTH+8)/CELL));
  return maxX>=range.sx-pad&&minX<=range.ex+pad&&maxY>=range.sy-pad&&minY<=range.ey+pad&&s.w>0&&s.h>0;
}

function screenPoints(path){
  return path.map(worldCellToScreen);
}

function drawPolyline(points,width,strokeStyle,options={}){
  if(points.length<2) return;
  ctx.save();
  ctx.strokeStyle=strokeStyle;
  ctx.lineWidth=Math.max(.5,width);
  ctx.lineCap=options.lineCap||"round";
  ctx.lineJoin=options.lineJoin||"round";
  if(options.dash) ctx.setLineDash(options.dash);
  else ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(points[0].x,points[0].y);
  for(let i=1;i<points.length;i++) ctx.lineTo(points[i].x,points[i].y);
  ctx.stroke();
  ctx.restore();
}

function segmentNormal(a,b){
  const dx=b.x-a.x;
  const dy=b.y-a.y;
  const length=Math.hypot(dx,dy)||1;
  return {x:-dy/length,y:dx/length};
}

function drawSegmentMark(a,b,offset,width,strokeStyle,dash){
  const normal=segmentNormal(a,b);
  const ox=normal.x*offset;
  const oy=normal.y*offset;
  ctx.save();
  ctx.strokeStyle=strokeStyle;
  ctx.lineWidth=Math.max(.6,width);
  ctx.lineCap="butt";
  ctx.lineJoin="miter";
  ctx.setLineDash(dash||[]);
  ctx.beginPath();
  ctx.moveTo(a.x+ox,a.y+oy);
  ctx.lineTo(b.x+ox,b.y+oy);
  ctx.stroke();
  ctx.restore();
}

function drawRoadBed(road){
  if(!visibleRoad(road)) return;
  const points=screenPoints(road.path);
  const width=roadWidthPx(road);

  drawPolyline(points,width+4*zoom,"#13191f",{lineCap:"round",lineJoin:"round"});
  drawPolyline(points,width,"#303a43",{lineCap:"round",lineJoin:"round"});

  if(road.lanes>=3) drawPolyline(points,width-8*zoom,"#343e47",{lineCap:"round",lineJoin:"round"});
}

function drawJunctions(net){
  for(const junction of net.junctions){
    const roadsHere=roads.filter((road)=>junction.roadIds.includes(road.id));
    if(!roadsHere.length) continue;
    const radius=Math.max(...roadsHere.map((road)=>roadWidthPx(road)/2))+2*zoom;
    const p=worldCellToScreen(junction);
    ctx.beginPath();
    ctx.fillStyle="#303a43";
    ctx.arc(p.x,p.y,radius,0,Math.PI*2);
    ctx.fill();
  }
}

function drawLaneMarkings(road,junctionKeys){
  if(!visibleRoad(road)) return;
  const spec=roadSpec(road);
  const points=screenPoints(road.path);
  if(points.length<2) return;

  const laneW=LANE_WIDTH*zoom;
  const half=spec.lanes*laneW/2;
  const edgeOffset=Math.max(0,half+3*zoom);

  drawPolyline(points,Math.max(1,1.2*zoom),"#cad3da",{
    lineCap:"butt",lineJoin:"round"
  });
  if(spec.lanes>1){
    drawPolyline(points,Math.max(1,1.2*zoom),"#cad3da",{
      lineCap:"butt",lineJoin:"round"
    });
    // Edge markings are rendered as segment lines below so future junction
    // geometry can add gaps without changing the road centerline data.
  }

  for(let i=1;i<spec.lanes;i++){
    const offset=-half+i*laneW;
    let color="#aeb8c1";
    let width=Math.max(1,1.1*zoom);
    let dash=[Math.max(2,7*zoom),Math.max(3,9*zoom)];

    if(!spec.oneWay&&i===spec.lanes/2){
      color="#e8c35b";
      if(spec.lanes>=4){
        width=Math.max(1,1.3*zoom);
        dash=[];
        drawOffsetSeparatedCenter(points,offset,2.2*zoom,color,width,junctionKeys);
        continue;
      }
    }
    drawOffsetSegments(points,offset,width,color,dash,junctionKeys);
  }

  drawOffsetSegments(points,-edgeOffset,Math.max(.8,1*zoom),"#d5dde2",[],junctionKeys,true);
  drawOffsetSegments(points,edgeOffset,Math.max(.8,1*zoom),"#d5dde2",[],junctionKeys,true);

  if(spec.oneWay) drawDirectionArrows(road,points);
}

function drawOffsetSegments(points,offset,width,color,dash,junctionKeys,edge=false){
  for(let i=0;i<points.length-1;i++){
    const cellA=roadsPointForIndex(points,i);
    const cellB=roadsPointForIndex(points,i+1);
    let a={...points[i]},b={...points[i+1]};
    const nodeA=junctionKeys.has(pointKey(cellA));
    const nodeB=junctionKeys.has(pointKey(cellB));
    const dx=b.x-a.x,dy=b.y-a.y;
    const len=Math.hypot(dx,dy)||1;
    const gap=Math.min(len*.26,Math.max(2,7*zoom));
    const ux=dx/len,uy=dy/len;

    if(nodeA){a.x+=ux*gap;a.y+=uy*gap}
    if(nodeB){b.x-=ux*gap;b.y-=uy*gap}
    if(Math.hypot(b.x-a.x,b.y-a.y)<1) continue;
    drawSegmentMark(a,b,offset,width,color,dash);
  }
}

function roadsPointForIndex(screenPts,index){
  const source=screenPts===undefined?null:screenPts;
  if(source===null) return {x:0,y:0};
  return screenToGridForScreenPoint(source[index]);
}

function screenToGridForScreenPoint(p){
  const w=screenToWorld(p.x,p.y);
  return {x:Math.floor(w.x/CELL),y:Math.floor(w.y/CELL)};
}

function drawOffsetSeparatedCenter(points,offset,separation,color,width,junctionKeys){
  drawOffsetSegments(points,offset-separation,width,color,[],junctionKeys);
  drawOffsetSegments(points,offset+separation,width,color,[],junctionKeys);
}

function drawDirectionArrows(road,points){
  if(points.length<2||zoom<.09) return;
  const segmentCount=points.length-1;
  const stride=Math.max(1,Math.round(6));
  let indexes=[];
  for(let i=0;i<segmentCount;i+=stride) indexes.push(i);
  if(indexes.length===0) indexes=[0];
  if(segmentCount>4){
    const last=Math.floor((segmentCount-1)/2);
    if(!indexes.includes(last)) indexes.push(last);
  }
  for(const i of indexes){
    const a=points[i],b=points[i+1];
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<8*zoom) continue;
    const ux=dx/len,uy=dy/len;
    const px=-uy,py=ux;
    const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
    const size=Math.max(3.5,5*zoom);
    ctx.save();
    ctx.fillStyle="#d9e0e5";
    ctx.beginPath();
    ctx.moveTo(cx+ux*size*1.4,cy+uy*size*1.4);
    ctx.lineTo(cx-ux*size+px*size*.72,cy-uy*size+py*size*.72);
    ctx.lineTo(cx-ux*size-px*size*.72,cy-uy*size-py*size*.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function buildJunctionKeySet(net){
  return new Set(net.junctions.map((j)=>pointKey(j)));
}

function drawPreview(){
  if(activeTool!=="road"||buildingPath.length===0) return;
  let preview=buildingPath;
  if(hover){
    const last=buildingPath[buildingPath.length-1];
    if(last.x!==hover.x||last.y!==hover.y) preview=buildingPath.concat(expandOrthogonal(last,hover).slice(1));
  }
  const points=screenPoints(preview);
  drawPolyline(points,8*zoom,"#5ce1b566",{lineCap:"round",lineJoin:"round",dash:[8*zoom,7*zoom].map((v)=>Math.max(2,v))});
  const start=worldCellToScreen(buildingPath[0]);
  ctx.save();
  ctx.fillStyle="#8ff0c9";
  ctx.strokeStyle="#12362c";
  ctx.lineWidth=Math.max(1,1.5*zoom);
  ctx.beginPath();
  ctx.arc(start.x,start.y,Math.max(4,5*zoom),0,Math.PI*2);
  ctx.fill();ctx.stroke();
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
      const px=Math.round(camera.x+(x)*step)+.5;
      ctx.moveTo(px,0);ctx.lineTo(px,s.h);
    }
    for(let y=startY;y<=range.ey+1;y+=gridEvery){
      const py=Math.round(camera.y+(y)*step)+.5;
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
  const junctionKeys=buildJunctionKeySet(net);

  roads.forEach(drawRoadBed);
  drawJunctions(net);

  if(selectedRoadId){
    const selectedRoad=roads.find((road)=>road.id===selectedRoadId);
    if(selectedRoad&&visibleRoad(selectedRoad)){
      drawPolyline(screenPoints(selectedRoad.path),roadWidthPx(selectedRoad)+7*zoom,"#61d3a544",{});
    }
  }

  roads.forEach((road)=>drawLaneMarkings(road,junctionKeys));

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

document.querySelector("#zoomIn").onclick=()=>{const s=bounds();zoomAt(1.2,s.w/2,s.h/2)};
document.querySelector("#zoomOut").onclick=()=>{const s=bounds();zoomAt(.833,s.w/2,s.h/2)};
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
