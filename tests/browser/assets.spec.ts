import { expect, test } from '@playwright/test';
test.beforeEach(async ({page})=>{await page.goto('/tests/browser/harness/');await page.waitForFunction(()=>!!(window as any).assets,undefined,{timeout:5000});});
for(const orientation of [6,8]) test(`EXIF ${orientation} normalizes exactly once and preserves original`, async ({page})=>{
 const result=await page.evaluate(async (orientation)=>{
  const a=(window as any).assets; const signal=new AbortController().signal;
  const bytes=new Uint8Array(await (await fetch(`/tests/fixtures/images/orientation-${orientation}.jpg`)).arrayBuffer());
  const first=await a.importImage(new File([bytes],'camera.jpg'),signal);
  const second=await a.importImage(new File([first.normalized],'normalized.png'),signal);
  const bitmap=await createImageBitmap(new Blob([first.normalized]));
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
  const colors=[[20,20],[180,20],[20,280],[180,280]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));
  return {size:[first.record.width,first.record.height],again:[second.record.width,second.record.height],hash:await a.sha256(bytes),original:first.record.variants.original.sha256,preserved:Array.from(first.original).join(',')===Array.from(bytes).join(','),colors};
 },orientation);
 expect(result.size).toEqual([200,300]);expect(result.again).toEqual(result.size);expect(result.preserved).toBe(true);expect(result.original).toBe(result.hash);
 const expected=orientation===6?[[0,0,255],[255,0,0],[255,255,0],[0,255,0]]:[[0,255,0],[255,255,0],[255,0,0],[0,0,255]];
 result.colors.forEach((color,i)=>color.slice(0,3).forEach((channel,j)=>expect(Math.abs(channel-expected[i][j])).toBeLessThanOrEqual(8)));
});
test('transparent pixels, preview bound, long aspect ratio and malformed inputs',async ({page})=>{
 const result=await page.evaluate(async()=>{
  const a=(window as any).assets;const signal=new AbortController().signal;
  const read=async(name:string)=>new File([await(await fetch(`/tests/fixtures/images/${name}`)).arrayBuffer()],name);
  const png=await a.importImage(await read('transparent.png'),signal);
  const bitmap=await createImageBitmap(new Blob([png.normalized]));const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
  const extreme=await a.importImage(await read('extreme.png'),signal);
  const landscape=await a.importImage(await read('landscape.png'),signal);
  const errors=[];for(const file of [new File([new Uint8Array(25_000_001)],'large.jpg'),new File([new Uint8Array([255,216,255,0])],'fake.jpg'),new File([new Uint8Array([137,80,78,71])],'bad.png'),await read('too-many-pixels.png')]){try{await a.importImage(file,signal);errors.push('accepted')}catch(e){errors.push((e as any).code)}}
  return {alpha:ctx.getImageData(0,0,1,1).data[3],extreme:[extreme.record.width,extreme.record.height],preview:landscape.record.variants.preview,errors};
 });
 expect(result.alpha).toBe(0);expect(result.extreme).toEqual([10000,1]);expect(Math.max(result.preview.width,result.preview.height)).toBe(1600);expect(result.errors).toEqual(['IMPORT_TOO_LARGE','INVALID_IMAGE','INVALID_IMAGE','SOURCE_TOO_LARGE']);
});
test('local fonts load real weights and reject missing, mismatched, unlicensed resources',async ({page})=>{
 const result=await page.evaluate(async()=>{
  const a=(window as any).assets;const manifest=await(await fetch('/fonts/manifest.json')).json();const record=manifest.fonts[0];const signal=new AbortController().signal;
  const files=new Map(record.faces.map((f:any)=>[f.id,f.file]));
  const port={read:async(id:string)=>new Uint8Array(await(await fetch(files.get(id) as string)).arrayBuffer())};
  const loaded=await a.loadFont(record,port,signal,'我们，。Á🙂');const unsupported=a.unsupportedGlyphs('我们，。Á🙂',loaded);const weights=[...new Set(loaded.faces.map((f:any)=>f.weight))];const family=loaded.family;
  loaded.dispose();const errors=[];
  for(const [r,p] of [[record,{read:async()=>{throw new Error('missing')}}],[record,{read:async()=>new Uint8Array([1,2,3])}],[{...record,license:{...record.license,usable:false}},port],[{...record,sha256:'0'.repeat(64)},port]]){try{await a.loadFont(r,p,signal,'A');errors.push('accepted')}catch(e){errors.push((e as any).code)}}
  const controller=new AbortController();controller.abort();try{await a.importImage(new File(['a'],'a.jpg'),controller.signal)}catch(e){errors.push((e as any).name)}
  return {unsupported,weights,family,errors};
 });
 expect(result.unsupported).toEqual([0x1f642]);expect(result.unsupported).not.toContain(0x6211);expect(result.unsupported).not.toContain(0x4eec);expect(result.weights.sort()).toEqual([400,700]);expect(result.family).toMatch(/^AlbumFont_[a-f0-9]{64}$/);expect(result.errors).toEqual(['RESOURCE_MISSING','HASH_MISMATCH','FONT_UNLICENSED','HASH_MISMATCH','AbortError']);
});

test('font cancellation and partial failure release all installed faces',async ({page})=>{
 const result=await page.evaluate(async()=>{
  const a=(window as any).assets;const {fonts:[record]}=await(await fetch('/fonts/manifest.json')).json();
  const baseline=document.fonts.size;const controller=new AbortController();
  const pending=a.loadFont(record,{read:()=>new Promise(()=>{})},controller.signal,'A');controller.abort();
  let aborted='';try{await pending}catch(e){aborted=(e as any).name}
  let reads=0;let failure='';try{await a.loadFont(record,{read:async(id:string)=>{reads++;if(reads>1)throw new Error('subset unavailable');const face=record.faces.find((f:any)=>f.id===id);return new Uint8Array(await(await fetch(face.file)).arrayBuffer())}},new AbortController().signal,'我们A')}catch(e){failure=(e as any).code}
  const loaded=await a.loadFont(record,{read:async(id:string)=>{const face=record.faces.find((f:any)=>f.id===id);return new Uint8Array(await(await fetch(face.file)).arrayBuffer())}},new AbortController().signal,'A');
  const installed=document.fonts.size;loaded.dispose();loaded.dispose();
  return {aborted,failure,baseline,installed,after:document.fonts.size};
 });
 expect(result.aborted).toBe('AbortError');expect(result.failure).toBe('RESOURCE_MISSING');expect(result.installed).toBeGreaterThan(result.baseline);expect(result.after).toBe(result.baseline);
});

test('decoder rejects corrupt raster data and accepts the exact byte limit',async({page})=>{
 const result=await page.evaluate(async()=>{
  const a=(window as any).assets;const signal=new AbortController().signal;
  const bytes=new Uint8Array(await(await fetch('/tests/fixtures/images/orientation-6.jpg')).arrayBuffer());
  const padded=new Uint8Array(25_000_000);padded.set(bytes);
  const imported=await a.importImage(new File([padded],'padded.jpg'),signal);
  const png=new Uint8Array(await(await fetch('/tests/fixtures/images/transparent.png')).arrayBuffer());
  // Keep complete IHDR but truncate IDAT: header is plausible, actual decoder must fail.
  let error='';try{await a.importImage(new File([png.slice(0,40)],'truncated.png'),signal)}catch(e){error=(e as any).code}
  return {original:imported.original.length,size:[imported.record.width,imported.record.height],error,normalizedType:a.inspectImage(imported.normalized).mimeType};
 });
 expect(result.original).toBe(25_000_000);expect(result.size).toEqual([200,300]);expect(result.error).toBe('INVALID_IMAGE');expect(result.normalizedType).toBe('image/png');
});

test('abort immediately after browser decode closes the image bitmap',async({page})=>{
 const result=await page.evaluate(async()=>{
  const a=(window as any).assets;const bytes=await(await fetch('/tests/fixtures/images/transparent.png')).arrayBuffer();
  const controller=new AbortController();const original=createImageBitmap;let closed=0;
  window.createImageBitmap=(async(...args:any[])=>{const bitmap=await (original as any)(...args);const close=bitmap.close.bind(bitmap);bitmap.close=()=>{closed++;close()};controller.abort();return bitmap;}) as any;
  let error='';try{await a.importImage(new File([bytes],'a.png'),controller.signal)}catch(e){error=(e as any).name}finally{window.createImageBitmap=original}
  return {closed,error};
 });
 expect(result).toEqual({closed:1,error:'AbortError'});
});
