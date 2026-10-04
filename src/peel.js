import { peelCurl } from "./placement.js";

const papers = new Map();
function paper(material) {
  const id = ["kraft", "holographic"].includes(material) ? material : "matte";
  if (!papers.has(id)) papers.set(id, new Promise(resolve => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null);
    image.src = new URL(`./art/back/back-${id}.jpg`, import.meta.url).href;
  }));
  return papers.get(id);
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
