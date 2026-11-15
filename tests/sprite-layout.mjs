import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spriteLayout } from '../mods/agents-plus/sprite-layout.js';
import { residentGeometry, villageLayout } from '../mods/agents-plus/village-spacing.js';
import { SPRITES } from '../mods/agents-plus/theme-assets.js';
import { CHIIKAWA_PACK } from '../mods/agents-plus/pack-chiikawa.js';
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

// Golden results were evaluated from 65b5c80's actual spriteLayout and metadata,
// not recalculated with the current implementation. Preserve every normal pose
// exactly, including all hopping/walking resources and every Cards thumbnail.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/village-proportions.json', import.meta.url), 'utf8'));
assert.equal(createHash('sha256').update(readFileSync(new URL('../mods/agents-plus/theme-assets.js', import.meta.url))).digest('hex'),
  baseline.sourceMetadataSha256, 'source body/content bounds are unchanged');
assert.deepEqual(CHIIKAWA_PACK.villageScale, { rakko: 0.8, kurimanju: 0.85, shisa: 0.75 }, 'only the reviewed outliers change');
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 0.001, message);
for (const count of [1, 12, 13, 24]) {
  const size = count > 12 ? 82 : 108;
  for (const [width, height] of [[2800, 1800], [1400, 900], [1100, 660], [1400, 360], [700, 300], [360, 660], [240, 180]]) {
    const layout = villageLayout(width, height, count, count, { width: 320, height: 340 });
    assert.equal(layout.size, size, 'restore original 108/82 size in every Scene/Split viewport');
    assert.equal(villageLayout(width, height, count).size, size, 'notice reservations cannot affect scale');
  }
}
for (const { width, height, body, sprites } of Object.values(baseline.layouts)) {
  for (const [name, expected] of Object.entries(sprites)) for (const mirrored of [false, true]) {
    const sprite = { ...SPRITES[name], mirrored }, before = expected[Number(mirrored)];
    const factor = body ? CHIIKAWA_PACK.villageScale[name] ?? 1 : 1;
    const art = spriteLayout(sprite, width, height, body, factor);
    if (factor === 1) assert.deepEqual(art, before, `${name}: exact 65b5c80 ${body ? 'Village' : 'Cards'} layout`);
    near(art.width, before.width * factor, `${name}: only the explicit resident scale changes artwork width`);
    near(art.height, before.height * factor, `${name}: source aspect ratio is preserved`);
    const [sourceX, y, w, h] = body && sprite.body || sprite.content || [0, 0, sprite.width, sprite.height];
    const x = mirrored ? sprite.width - sourceX - w : sourceX, scale = art.width / sprite.width;
    near(art.top + (y + h) * scale, height, `${name}: fitted foot baseline is unchanged`);
    near(art.left + (x + w / 2) * scale, width / 2, `${name}: body center is unchanged`);
  }
}
// Optional Rakko motion resources inherit their resident's factor. Their source
// body bounds differ, but both already share the same fitted body height.
for (const size of [108, 82]) {
  const factor = CHIIKAWA_PACK.villageScale.rakko;
  const geometry = residentGeometry([SPRITES.rakko, SPRITES['rakko-sword']], size, factor);
  for (const name of ['rakko', 'rakko-sword']) {
    const sprite = SPRITES[name], art = spriteLayout(sprite, size + 16, size, true, geometry.visualScale);
    near(sprite.body[3] * art.height / sprite.height, size * factor, `${name}: motion swaps retain fitted body height`);
  }
  near(geometry.selection.width, size * factor, 'selection follows the same resident factor');
  near(geometry.selection.left + geometry.selection.width / 2, (size + 16) / 2, 'selection remains centered at the actor origin');
  assert.equal(geometry.selection.top, size, 'selection and body share the foot baseline');
}
console.log('village proportions: exact 65b5c80 normal/Cards layouts, restored 108/82 size, targeted scale and motion baselines passed');
