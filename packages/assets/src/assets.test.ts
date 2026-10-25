import { describe, expect, it } from 'vitest';
import { inspectImage, MAX_IMPORT_BYTES, MAX_SOURCE_PIXELS, ResourceError, sha256, unsupportedGlyphs } from './index';
import { readFile } from 'node:fs/promises';
import { create } from 'fontkit';

describe('immutable image validation', () => {
  it('pins decimal byte and pixel capacity limits', () => {
    expect(MAX_IMPORT_BYTES).toBe(25_000_000);
    expect(MAX_SOURCE_PIXELS).toBe(80_000_000);
  });
  it('rejects unsupported magic and malformed PNG/JPEG before decode', () => {
    for (const bytes of [new Uint8Array(), new Uint8Array([255,216,255,0,0]),new Uint8Array([137,80,78,71,13,10,26,10])]) {
      expect(() => inspectImage(bytes)).toThrow(ResourceError);
    }
  });
  it('hashes the exact bytes', async () => {
    expect(await sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('glyph evidence', () => {
  it('uses actual cmap coverage and reports combining marks and emoji independently', () => {
    const font = { codePoints: new Set([0x6211,0x4eec,65]), family:'test',faces:[],dispose(){} };
    expect(unsupportedGlyphs('我们Á🙂🙂',font)).toEqual([0x301,0x1f642]);
  });
  it('catalog file hashes and cmap match every pinned local face', async () => {
    const manifest=JSON.parse(await readFile('apps/web/public/fonts/manifest.json','utf8'));
    expect(manifest.fonts).toHaveLength(2);
    for(const record of manifest.fonts){
      expect(record.license.usable).toBe(true);
      expect(record.license.text).toContain('SIL OPEN FONT LICENSE');
      expect(new Set(record.faces.map((face:any)=>face.weight))).toEqual(new Set([400,700]));
      for(const face of record.faces){
        const bytes=new Uint8Array(await readFile(`apps/web/public${face.file}`));
        expect(await sha256(bytes)).toBe(face.sha256);
        const font=create(Buffer.from(bytes));if(!('characterSet' in font))throw new Error('Unexpected font collection');
        expect([...font.characterSet].sort((a,b)=>a-b)).toEqual(face.codePoints);
      }
    }
  });
});

describe('header pixel boundary',()=>{
  const png=(width:number,height:number)=>{
    const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10]);
    const view=new DataView(bytes.buffer);view.setUint32(8,13);bytes.set(new TextEncoder().encode('IHDR'),12);
    view.setUint32(16,width);view.setUint32(20,height);return bytes;
  };
  it('permits exactly 80MP at header inspection and rejects 80,000,001 pixels',()=>{
    expect(inspectImage(png(10000,8000))).toEqual({width:10000,height:8000,mimeType:'image/png'});
    expect(()=>inspectImage(png(80_000_001,1))).toThrow(expect.objectContaining({code:'SOURCE_TOO_LARGE'}));
    expect(()=>inspectImage(png(0,1))).toThrow(expect.objectContaining({code:'INVALID_IMAGE'}));
  });
});
