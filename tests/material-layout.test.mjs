import test from 'node:test';
import assert from 'node:assert/strict';
import {fitMaterialCard} from '../src/ui-math.js';
const base = {stageWidth:760,stageHeight:574,cardWidth:216,cardHeight:216*380/560,hintBottom:16,infoTop:410};
const fits = (input, fit) => {
  const half=input.cardHeight*fit.scale*1.18/2;
  assert.ok(fit.cy-half>=fit.top-1e-9);
  assert.ok(fit.cy+half<=fit.bottom+1e-9);
  assert.ok(input.cardWidth*fit.scale<=Math.min(300,input.stageWidth*.5)+1e-9);
};
test('normal reveal keeps the preferred centre and caps card width', () => {
  const fit=fitMaterialCard(base);assert.equal(fit.cy,base.stageHeight*.42);assert.equal(base.cardWidth*fit.scale,300);fits(base,fit);
});
test('short stages and taller info shrink uniformly between hint and buttons', () => {
  for(const stageHeight of [426,300,180]) {
    const input={...base,stageWidth:676,stageHeight,hintBottom:26,infoTop:stageHeight-150};
    const fit=fitMaterialCard(input);fits(input,fit);assert.ok(fit.scale>=0);assert.ok(fit.scale<300/base.cardWidth);
  }
});
test('zero space and zero-size cards remain finite without a negative scale', () => {
  for(const input of [{...base,stageWidth:0,stageHeight:0,infoTop:0,hintBottom:0},{...base,infoTop:30,hintBottom:90},{...base,cardWidth:0,cardHeight:0}]) {
    const fit=fitMaterialCard(input);assert.equal(fit.scale,0);assert.ok(Object.values(fit).every(Number.isFinite));
  }
});
test('narrow windows fit the width while preserving the original card aspect', () => {
  const input={...base,stageWidth:120},fit=fitMaterialCard(input);fits(input,fit);
  assert.equal(input.cardWidth*fit.scale,60);
  assert.ok(Math.abs((input.cardWidth*fit.scale)/(input.cardHeight*fit.scale)-input.cardWidth/input.cardHeight)<1e-12);
});
