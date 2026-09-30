const EPS=0.000001;

function same(a,b){
  return Math.abs(a.x-b.x)<EPS&&Math.abs(a.y-b.y)<EPS;
}

function distance(a,b){
  return Math.hypot(b.x-a.x,b.y-a.y);
}

function unit(a,b){
  const d=distance(a,b);
  return d<EPS ? {x:0,y:0} : {x:(b.x-a.x)/d,y:(b.y-a.y)/d};
}

function pushPoint(out,p){
  if(!out.length||!same(out[out.length-1],p)) out.push({x:p.x,y:p.y});
}

function isTurn(a,b,c){
  const inDir=unit(a,b);
  const outDir=unit(b,c);
  const dot=inDir.x*outDir.x+inDir.y*outDir.y;
  const cross=inDir.x*outDir.y-inDir.y*outDir.x;
  return Math.abs(cross)>0.01&&dot>-0.99;
}

export function buildSmoothCenterline(points,radius=0.28,samplesPerTurn=8){
  if(!Array.isArray(points)||points.length<2) return [];
  const out=[];
  const maxRadius=Math.max(0,radius);

  pushPoint(out,{...points[0]});

  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1];
    if(!isTurn(a,b,c)){
      pushPoint(out,{...b});
      continue;
    }

    const inLength=distance(a,b);
    const outLength=distance(b,c);
    const r=Math.min(maxRadius,inLength*0.45,outLength*0.45);
    if(r<EPS){
      pushPoint(out,{...b});
      continue;
    }

    const inDir=unit(a,b);
    const outDir=unit(b,c);
    const entry={x:b.x-inDir.x*r,y:b.y-inDir.y*r};
    const exit={x:b.x+outDir.x*r,y:b.y+outDir.y*r};

    pushPoint(out,entry);

    const steps=Math.max(3,Math.trunc(samplesPerTurn));
    for(let s=1;s<steps;s++){
      const t=s/steps;
      const mt=1-t;
      pushPoint(out,{
        x:mt*mt*entry.x+2*mt*t*b.x+t*t*exit.x,
        y:mt*mt*entry.y+2*mt*t*b.y+t*t*exit.y
      });
    }
    pushPoint(out,exit);
  }

  pushPoint(out,{...points[points.length-1]});
  return out;
}

export function offsetPolyline(points,offset){
  if(!Array.isArray(points)||points.length===0) return [];
  return points.map((p,i)=>{
    const prev=points[Math.max(0,i-1)];
    const next=points[Math.min(points.length-1,i+1)];
    const dir=unit(prev,next);
    return {x:p.x-dir.y*offset,y:p.y+dir.x*offset};
  });
}

export function polylineLength(points){
  let total=0;
  for(let i=1;i<points.length;i++) total+=distance(points[i-1],points[i]);
  return total;
}

export function pointAlongPolyline(points,distanceAlong){
  if(!points.length) return null;
  if(points.length===1) return {point:{...points[0]},dir:{x:1,y:0}};
  let remaining=Math.max(0,distanceAlong);

  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    const len=distance(a,b);
    if(len<EPS) continue;
    if(remaining<=len){
      const t=remaining/len;
      return {
        point:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},
        dir:unit(a,b)
      };
    }
    remaining-=len;
  }

  return {
    point:{...points[points.length-1]},
    dir:unit(points[points.length-2],points[points.length-1])
  };
}
