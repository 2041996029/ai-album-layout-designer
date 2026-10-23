import type { AssetRecord, AssetBytes, ImageVariant } from './types';
import { assertActive, ResourceError, sha256 } from './resource-port';
export const MAX_IMPORT_BYTES=25_000_000;
export const MAX_SOURCE_PIXELS=80_000_000;
const invalid=():never=>{throw new ResourceError('INVALID_IMAGE','Expected a decodable JPEG or PNG image.');};
/** Read bounded raster dimensions before asking the browser to allocate decoded pixels. */
export function inspectImage(bytes:Uint8Array):{width:number;height:number;mimeType:'image/png'|'image/jpeg'} {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let width=0,height=0,mimeType:'image/png'|'image/jpeg';
 if(bytes.length>=33&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
  if(view.getUint32(8)!==13||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')invalid();
  width=view.getUint32(16);height=view.getUint32(20);mimeType='image/png';
 }else if(bytes.length>4&&bytes[0]===255&&bytes[1]===216){
  mimeType='image/jpeg';let offset=2;
  while(offset+4<=bytes.length){
   if(bytes[offset++]!==255)invalid();while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];if(marker===0xd9||marker===0xda)break;
   if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
   if(offset+2>bytes.length)invalid();const size=view.getUint16(offset);
   if(size<2||offset+size>bytes.length)invalid();
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
    if(size<8)invalid();height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;
   }
   offset+=size;
  }
 }else return invalid();
 if(!width||!height)return invalid();
 if(width*height>MAX_SOURCE_PIXELS)throw new ResourceError('SOURCE_TOO_LARGE',`Image exceeds ${MAX_SOURCE_PIXELS} source pixels.`);
 return {width,height,mimeType};
}
export async function importImage(file:File,signal:AbortSignal):Promise<{record:AssetRecord}&AssetBytes> {
 assertActive(signal);
 if(file.size>MAX_IMPORT_BYTES)throw new ResourceError('IMPORT_TOO_LARGE',`Image exceeds ${MAX_IMPORT_BYTES} bytes.`);
 const original=new Uint8Array(await file.arrayBuffer());assertActive(signal);
 const header=inspectImage(original);
 let bitmap:ImageBitmap|undefined;let canvas:OffscreenCanvas|undefined;let previewCanvas:OffscreenCanvas|undefined;
 try{
  // Decoder applies EXIF once. Never add a second manual rotation.
  try{bitmap=await createImageBitmap(new Blob([new Uint8Array(original)],{type:header.mimeType}),{imageOrientation:'from-image'});}catch{assertActive(signal);return invalid();}
  assertActive(signal);
  const {width,height}=bitmap;
  if(width*height>MAX_SOURCE_PIXELS)throw new ResourceError('SOURCE_TOO_LARGE','Decoded image exceeds source pixel limit.');
  canvas=new OffscreenCanvas(width,height);const ctx=canvas.getContext('2d');if(!ctx)throw new ResourceError('CANVAS_UNAVAILABLE','Cannot normalize image.');ctx.drawImage(bitmap,0,0);
  // Canvas encoding strips EXIF and GPS and preserves PNG alpha.
  const normalized=new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer());assertActive(signal);
  const scale=Math.min(1,1600/Math.max(width,height));const previewWidth=Math.max(1,Math.round(width*scale)),previewHeight=Math.max(1,Math.round(height*scale));
  previewCanvas=new OffscreenCanvas(previewWidth,previewHeight);const previewContext=previewCanvas.getContext('2d');if(!previewContext)throw new ResourceError('CANVAS_UNAVAILABLE','Cannot preview image.');previewContext.drawImage(bitmap,0,0,previewWidth,previewHeight);
  const preview=new Uint8Array(await(await previewCanvas.convertToBlob({type:'image/png'})).arrayBuffer());assertActive(signal);
  const [originalHash,normalizedHash,previewHash]=await Promise.all([sha256(original),sha256(normalized),sha256(preview)]);assertActive(signal);
  const variant=(sha256:string,bytes:Uint8Array,width:number,height:number,mimeType:'image/png'|'image/jpeg'):ImageVariant=>Object.freeze({sha256,byteLength:bytes.length,width,height,mimeType});
  const record:AssetRecord=Object.freeze({id:`image-${originalHash}`,version:1,sha256:originalHash,width,height,mimeType:'image/png',source:Object.freeze({kind:'import',name:file.name}),license:Object.freeze({id:'user-provided',usable:true}),status:'ready',variants:Object.freeze({original:variant(originalHash,original,header.width,header.height,header.mimeType),normalized:variant(normalizedHash,normalized,width,height,'image/png'),preview:variant(previewHash,preview,previewWidth,previewHeight,'image/png')})});
  return {record,original,normalized,preview};
 }finally{bitmap?.close();if(canvas){canvas.width=1;canvas.height=1;}if(previewCanvas){previewCanvas.width=1;previewCanvas.height=1;}}
}
