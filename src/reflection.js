// The desktop band is active only for these manufacturing materials.
export const REFLECTIVE_MATERIALS = new Set(['holographic','gold']);
export function staticSheen(box, width, height) {
  return { x:box.cx/width*100, y:box.cy/height*100, angle:115-box.rotation };
}
export function reflectedSheen(box, width, height, cursor) {
  const base=staticSheen(box,width,height);
  if (!cursor?.inside) return base;
  const radius=Math.max(240,Math.min(width,height)*.65), dx=(cursor.x-box.cx)/radius, dy=(cursor.y-box.cy)/radius;
  const k=Math.max(1,Math.hypot(dx,dy)), x=dx/k, y=dy/k;
  return { x:base.x+x*22, y:base.y+y*22, angle:base.angle+x*18-y*12 };
}
export function approachSheen(current, target, elapsed) {
  const k=1-Math.exp(-Math.min(64,Math.max(0,elapsed))/75);
  const next=Object.fromEntries(Object.keys(target).map(key=>[key,current[key]+(target[key]-current[key])*k]));
  const done=Object.keys(target).every(key=>Math.abs(target[key]-next[key])<.025);
  return { value:done ? {...target} : next, done };
}
