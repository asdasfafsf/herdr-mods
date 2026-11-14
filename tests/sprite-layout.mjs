import assert from 'node:assert/strict';
import { spriteLayout } from '../mods/agents-plus/sprite-layout.js';
const sprite={width:300,height:300,content:[20,40,200,220],body:[40,60,160,180]};
for(const mirrored of [false,true]) for(const fitBody of [false,true]) {
  const art=spriteLayout({...sprite,mirrored},124,108,fitBody);
  const [sourceX,y,width,height]=fitBody?sprite.body:sprite.content;
  const x=mirrored?sprite.width-sourceX-width:sourceX, scale=art.width/sprite.width;
  assert.ok(x*scale+art.left>=-0.001);
  assert.ok((x+width)*scale+art.left<=124.001);
  assert.ok(y*scale+art.top>=-0.001);
  assert.ok(Math.abs((y+height)*scale+art.top-108)<0.001);
  assert.equal(art.width/art.height,sprite.width/sprite.height);
}
const rakko={width:274,height:274,content:[0,0,274,274],body:[43,34,203,210]};
assert.ok(spriteLayout(rakko,124,108,true).height>spriteLayout(rakko,124,108).height,'body fit makes Rakko visible at equal character height');
console.log('sprite layout: body/content fitting, facing symmetry, aspect and baseline passed');
