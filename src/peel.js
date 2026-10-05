import { peelCurl } from "./placement.js";

const papers = new Map();
function paper(material) {
  const id = ["kraft","holographic","gold","riso","vintage","clear","pixel","washi","sakura"].includes(material) ? material : "matte";
  if (!papers.has(id)) papers.set(id, ["clear","pixel","washi","sakura"].includes(id) ? Promise.resolve(paperSurface(id)) : new Promise(resolve => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null);
    image.src = new URL(`./art/back/back-${id}.jpg`, import.meta.url).href;
  }));
  return papers.get(id);
}

function paperSurface(id) {
  const canvas=document.createElement("canvas"); canvas.width=512; canvas.height=640;
  const x=canvas.getContext("2d"), tones={clear:["#edf1f3","#c5d3db"],pixel:["#f5f0e6","#f5f0e6"],washi:["#fbf6ec","#f3e9dc"],sakura:["#fbeef0","#f8e3e6"]};
  const gradient=x.createRadialGradient(164,224,12,256,320,430);
  gradient.addColorStop(0,tones[id][0]);gradient.addColorStop(1,tones[id][1]);x.fillStyle=gradient;x.fillRect(0,0,512,640);
  if(id==="pixel") {
    const colors=["#f5f0e6","#cddce8","#f4dbe7","#f7f0d4"];
    for(let y=0;y<640;y+=12) for(let a=0;a<512;a+=12) { x.fillStyle=colors[(a/12+2*(y/12))%4];x.globalAlpha=.38;x.fillRect(a,y,12,12); }
  } else if(id==="washi") {
    x.strokeStyle="rgba(186,151,116,.12)";x.lineWidth=1;
    for(let i=0;i<210;i++) {
      const a=(i*137)%512,b=(i*211)%640;x.beginPath();x.moveTo(a,b);x.lineTo(a+12+(i%7)*4,b+(i%5-2)*9);x.stroke();
    }
  } else if(id==="sakura") {
    x.fillStyle="#e9b7c0";x.globalAlpha=.65;
    for(let i=0;i<8;i++) { x.beginPath();x.ellipse(35+(i*139)%442,35+(i*223)%570,4+i%3,8+i%4,i*.7,0,Math.PI*2);x.fill(); }
  } else {
    const band=x.createLinearGradient(0,0,512,640);band.addColorStop(0,"transparent");band.addColorStop(.4,"transparent");band.addColorStop(.5,"rgba(255,255,255,.4)");band.addColorStop(.6,"transparent");band.addColorStop(1,"transparent");x.fillStyle=band;x.fillRect(0,0,512,640);
  }
  x.globalAlpha=1;return canvas;
}

/* One composited surface avoids WebKit's independent 3D layers and their visible seams. */
export function createPeelSurface(image, material, width, height) {
  const canvas = document.createElement("canvas"), back = document.createElement("canvas");
  const faces = [document.createElement("canvas"), document.createElement("canvas")];
  canvas.dataset.material = material; canvas.dataset.backing = "loading";
  const pad = Math.ceil(Math.max(width, height) * .55), dpr = Math.min(2, devicePixelRatio || 1);
  const w = width + pad * 2, h = height + pad * 2;
  canvas.width = Math.ceil(w*dpr); canvas.height = Math.ceil(h*dpr);
  Object.assign(canvas.style, {position:"absolute",left:-pad+"px",top:-pad+"px",width:w+"px",height:h+"px",pointerEvents:"none"});
  back.width = Math.ceil(width*dpr); back.height = Math.ceil(height*dpr);
  faces.forEach(face => { face.width=back.width; face.height=back.height; });
  const bx = back.getContext("2d"), x = canvas.getContext("2d");
  let latest;
  const backing = texture => {
    bx.clearRect(0,0,back.width,back.height);
    bx.fillStyle="#f1ecdf"; bx.fillRect(0,0,back.width,back.height);
    if (texture) bx.drawImage(texture,0,0,back.width,back.height);
    bx.globalCompositeOperation="destination-in"; bx.drawImage(image,0,0,back.width,back.height); bx.globalCompositeOperation="source-over";
  };
  const polygon = points => {
    x.beginPath(); points.forEach(([px,py],i) => i ? x.lineTo(px,py) : x.moveTo(px,py)); x.closePath();
  };
  const draw = pose => {
    latest=pose;
    const curl = peelCurl(pose,width,height), {dlx,dly}=curl;
    x.setTransform(dpr,0,0,dpr,pad*dpr,pad*dpr); x.clearRect(-pad,-pad,w,h);
    if (!curl.strips.length) return curl;
    const reach=(Math.abs(dlx)*width+Math.abs(dly)*height)/2, seam=reach-curl.length;
    const gx=width/2+dlx*seam, gy=height/2+dly*seam;
    const bend=Math.min(200,Math.min(1,pose.progress)*260)*Math.PI/180;
    faces.forEach((face,i) => {
      const fx=face.getContext("2d"); fx.setTransform(dpr,0,0,dpr,0,0); fx.clearRect(0,0,width,height);
      fx.drawImage(i ? back : image,0,0,width,height);
      const shade=fx.createLinearGradient(gx,gy,gx+dlx*curl.length,gy+dly*curl.length);
      for (let n=0;n<=16;n++) shade.addColorStop(n/16,`rgba(45,35,25,${.025+.22*(1-Math.abs(Math.cos(bend*n/16)))})`);
      fx.globalCompositeOperation="source-atop"; fx.fillStyle=shade; fx.fillRect(0,0,width,height); fx.globalCompositeOperation="source-over";
    });
    for (const band of curl.strips) {
      const cos=Math.cos(band.angle*Math.PI/180);
      const a=1+(cos-1)*dlx*dlx, b=(cos-1)*dlx*dly, d=1+(cos-1)*dly*dly;
      x.save();
      x.transform(a,b,b,d,band.ox+band.x-a*band.ox-b*band.oy,band.oy+band.y-b*band.ox-d*band.oy);
      polygon(band.paintClip); x.clip();
      x.drawImage(faces[cos<0 ? 1 : 0],0,0,width,height);
      x.restore();
    }
    return curl;
  };
  backing(null);
  paper(material).then(texture => { canvas.dataset.backing=texture ? "loaded" : "fallback"; backing(texture); if (latest && canvas.isConnected) draw(latest); });
  return {canvas,draw};
}
