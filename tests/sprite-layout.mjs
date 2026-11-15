import assert from 'node:assert/strict';
import { spriteLayout } from '../mods/agents-plus/sprite-layout.js';
import { villageLayout } from '../mods/agents-plus/village-spacing.js';
import { SPRITES } from '../mods/agents-plus/theme-assets.js';
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

// Source dimensions and body/content bounds stay intact: artwork decorations
// receive the same uniform scale as their character, including wide resources.
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 0.001, message);
for (const count of [1, 12, 13, 24]) {
  const beforeSize = count > 12 ? 82 : 108;
  const full = villageLayout(1400, 900, count);
  assert.ok(full.size / beforeSize >= 0.75 && full.size / beforeSize <= 0.8,
    'large scenes reduce the nominal body size by 20–25%');
  assert.equal(villageLayout(2800, 1800, count).size, full.size, 'large windows cannot enlarge artwork past the cap');
  for (const [width, height] of [[1400, 900], [1100, 660], [1400, 360], [700, 300], [360, 660], [240, 180]]) {
    const layout = villageLayout(width, height, count, count, { width: 320, height: 340 });
    assert.ok(layout.size >= 48 && layout.size <= full.size, 'small panes keep bounded, usable artwork');
    assert.ok(layout.size <= Math.max(48, width * 0.18) + 0.5, 'narrow panes cap the body by viewport width');
    assert.ok(layout.size <= Math.max(48, height * 0.2) + 0.5, 'short splits cap the body by viewport height');
    assert.equal(layout.size, villageLayout(width, height, count).size, 'scrolling for notices cannot inflate artwork');
    for (const [name, sprite] of Object.entries(SPRITES)) for (const mirrored of [false, true]) {
      const source = { ...sprite, mirrored }, art = spriteLayout(source, layout.size + 16, layout.size, true);
      const before = spriteLayout(source, beforeSize + 16, beforeSize, true);
      const scale = art.width / sprite.width;
      near(art.width / art.height, sprite.width / sprite.height, `${name}: source aspect ratio`);
      near(art.width / before.width, art.height / before.height, `${name}: uniform artwork reduction`);
      assert.ok(scale < before.width / sprite.width, `${name}: character and decorations both shrink`);
      if (width === 1400 && height === 900) assert.ok(art.width / before.width >= 0.75 && art.width / before.width <= 0.8,
        `${name}: visible artwork, including width-limited sprites, shrinks by 20–25%`);
      const [, y, , h] = sprite.body || sprite.content || [0, 0, sprite.width, sprite.height];
      near(art.top + (y + h) * scale, layout.size, `${name}: body baseline follows new size`);
    }
  }
}
assert.ok(villageLayout(1400, 300, 4).size < villageLayout(1400, 900, 4).size, 'Split height affects artwork even in a wide window');
assert.ok(villageLayout(360, 900, 4).size < villageLayout(1400, 900, 4).size, 'narrow Scene width affects artwork');
console.log('village scale: 20–25% artwork reduction, viewport caps, source ratios and body baselines passed');
