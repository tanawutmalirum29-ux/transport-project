export const ROAD_SPECS = Object.freeze({
  "two-2": {id:"two-2",label:"2 เลนสวนทาง",oneWay:false,lanes:2,lanesPerDirection:1},
  "two-4": {id:"two-4",label:"4 เลนสวนทาง",oneWay:false,lanes:4,lanesPerDirection:2},
  "one-1": {id:"one-1",label:"ทางเดียว 1 เลน",oneWay:true,lanes:1,lanesPerDirection:1},
  "one-2": {id:"one-2",label:"ทางเดียว 2 เลน",oneWay:true,lanes:2,lanesPerDirection:2},
  "one-3": {id:"one-3",label:"ทางเดียว 3 เลน",oneWay:true,lanes:3,lanesPerDirection:3}
});

export const ROAD_STORAGE_KEY = "transport-project.roads.v2";

export function pointKey(p){
  return p.x + "," + p.y;
}

export function directedKey(a,b){
  return pointKey(a) + ">" + pointKey(b);
}

export function samePoint(a,b){
  return a.x===b.x && a.y===b.y;
}

export function stepDirection(a,b){
  return {x:Math.sign(b.x-a.x),y:Math.sign(b.y-a.y)};
}

export function isAdjacent(a,b){
  return Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
}

export function dedupePath(points){
  const out=[];
  for(const p of points){
    const q={x:Math.trunc(p.x),y:Math.trunc(p.y)};
    if(!out.length || !samePoint(out[out.length-1],q)) out.push(q);
  }
  return out;
}

export function expandOrthogonal(a,b){
  const start={x:Math.trunc(a.x),y:Math.trunc(a.y)};
  const end={x:Math.trunc(b.x),y:Math.trunc(b.y)};
  const out=[start];
  if(start.x===end.x && start.y===end.y) return out;

  const dx=Math.abs(end.x-start.x);
  const dy=Math.abs(end.y-start.y);
  const horizontalFirst=dx>=dy;
  const bend=horizontalFirst
    ? {x:end.x,y:start.y}
    : {x:start.x,y:end.y};

  if(!samePoint(start,bend)){
    const sx=Math.sign(bend.x-start.x);
    const sy=Math.sign(bend.y-start.y);
    let x=start.x,y=start.y;
    while(x!==bend.x || y!==bend.y){
      if(x!==bend.x) x+=sx;
      else y+=sy;
      out.push({x,y});
    }
  }
  if(!samePoint(bend,end)){
    const sx=Math.sign(end.x-bend.x);
    const sy=Math.sign(end.y-bend.y);
    let x=bend.x,y=bend.y;
    while(x!==end.x || y!==end.y){
      if(x!==end.x) x+=sx;
      else y+=sy;
      out.push({x,y});
    }
  }
  return out;
}

export function normalizePath(points){
  const clean=dedupePath(points);
  if(clean.length<2) return clean;
  const out=[clean[0]];
  for(let i=1;i<clean.length;i++){
    const expanded=expandOrthogonal(out[out.length-1],clean[i]);
    for(let j=1;j<expanded.length;j++) out.push(expanded[j]);
  }
  return out;
}

export function pathSignature(path){
  return path.map(pointKey).join("|");
}

export function reverseSignature(path){
  return [...path].reverse().map(pointKey).join("|");
}

export function createRoad(id,type,path){
  const spec=ROAD_SPECS[type] || ROAD_SPECS["two-2"];
  const normalized=normalizePath(path);
  return {
    id,
    type:spec.id,
    oneWay:spec.oneWay,
    lanes:spec.lanes,
    path:normalized
  };
}

export function buildRoadNetwork(roads){
  const nodes=new Map();
  const edgeMap=new Map();
  let edgeSeq=0;

  const ensureNode=(p)=>{
    const key=pointKey(p);
    if(!nodes.has(key)){
      nodes.set(key,{id:key,x:p.x,y:p.y,incoming:[],outgoing:[],roadIds:[]});
    }
    return nodes.get(key);
  };

  const addRoadId=(node,id)=>{
    if(!node.roadIds.includes(id)) node.roadIds.push(id);
  };

  const addEdge=(from,to,road)=>{
    const key=directedKey(from,to);
    let edge=edgeMap.get(key);
    const spec=ROAD_SPECS[road.type] || ROAD_SPECS["two-2"];
    const lanes=spec.oneWay ? spec.lanes : spec.lanesPerDirection;
    if(!edge){
      edge={
        id:"edge-" + (++edgeSeq),
        from:pointKey(from),
        to:pointKey(to),
        fromPoint:{...from},
        toPoint:{...to},
        laneCount:lanes,
        roadIds:[road.id],
        roadTypes:[road.type]
      };
      edgeMap.set(key,edge);
    }else{
      edge.laneCount=Math.max(edge.laneCount,lanes);
      if(!edge.roadIds.includes(road.id)) edge.roadIds.push(road.id);
      if(!edge.roadTypes.includes(road.type)) edge.roadTypes.push(road.type);
    }
    return edge;
  };

  for(const road of roads){
    const path=normalizePath(road.path || []);
    if(path.length<2) continue;
    for(const p of path) addRoadId(ensureNode(p),road.id);

    for(let i=0;i<path.length-1;i++){
      const a=path[i],b=path[i+1];
      if(!isAdjacent(a,b)) continue;
      const from=ensureNode(a),to=ensureNode(b);
      const forward=addEdge(a,b,road);
      if(!from.outgoing.includes(forward.id)) from.outgoing.push(forward.id);
      if(!to.incoming.includes(forward.id)) to.incoming.push(forward.id);
      addRoadId(from,road.id); addRoadId(to,road.id);

      if(!road.oneWay){
        const reverse=addEdge(b,a,road);
        if(!to.outgoing.includes(reverse.id)) to.outgoing.push(reverse.id);
        if(!from.incoming.includes(reverse.id)) from.incoming.push(reverse.id);
      }
    }
  }

  const edges=[...edgeMap.values()];
  const edgeById=new Map(edges.map(e=>[e.id,e]));
  const turns=[];
  for(const node of nodes.values()){
    for(const incomingId of node.incoming){
      const incoming=edgeById.get(incomingId);
      for(const outgoingId of node.outgoing){
        const outgoing=edgeById.get(outgoingId);
        if(!incoming || !outgoing || incoming.from===outgoing.to) continue;
        const a=incoming.fromPoint,b=incoming.toPoint,c=outgoing.toPoint;
        const inDir=stepDirection(a,b),outDir=stepDirection(b,c);
        const dot=inDir.x*outDir.x+inDir.y*outDir.y;
        const cross=inDir.x*outDir.y-inDir.y*outDir.x;
        const turnType=dot===1 ? "straight" : dot===-1 ? "u-turn" : cross>0 ? "right" : "left";
        turns.push({
          id:node.id + ":" + incoming.id + ">" + outgoing.id,
          nodeId:node.id,
          incomingEdgeId:incoming.id,
          outgoingEdgeId:outgoing.id,
          type:turnType
        });
      }
    }
  }

  return {
    nodes:[...nodes.values()],
    edges,
    turns,
    junctions:[...nodes.values()].filter(n=>n.incoming.length+n.outgoing.length>2).map(n=>({
      id:n.id,
      x:n.x,
      y:n.y,
      roadIds:n.roadIds
    }))
  };
}

export function findRoadAtPoint(roads,p){
  for(let i=roads.length-1;i>=0;i--){
    const road=roads[i];
    if((road.path||[]).some(q=>q.x===p.x && q.y===p.y)) return road;
  }
  return null;
}
