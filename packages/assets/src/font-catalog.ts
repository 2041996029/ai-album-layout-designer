import { create } from 'fontkit';
import { fontRecordHash } from './font-identity';
import type { FontRecord, LoadedFont } from './types';
import type { ResourcePort } from './resource-port';
import { assertActive, ResourceError, sha256 } from './resource-port';
/** Coverage is actual cmap evidence, including combining marks as their own Unicode scalars. */
export function unsupportedGlyphs(text:string,font:LoadedFont):number[] {
 return [...new Set(Array.from(text,c=>c.codePointAt(0)!))].filter(cp=>cp!==10&&cp!==13&&!font.codePoints.has(cp));
}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
 assertActive(signal);
 return new Promise<T>((resolve,reject)=>{
  const aborted=()=>{cleanup();reject(signal.reason??new DOMException('Aborted','AbortError'));};
  const cleanup=()=>signal.removeEventListener('abort',aborted);
  signal.addEventListener('abort',aborted,{once:true});
  promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
 });
}
/** Optional text restricts local subset reads. Omit to load the complete pinned family. */
export async function loadFont(record:FontRecord,port:ResourcePort,signal:AbortSignal,text?:string):Promise<LoadedFont> {
 assertActive(signal);
 if(!record.license.usable||record.status==='unlicensed')throw new ResourceError('FONT_UNLICENSED',`Font ${record.id} is not licensed for use.`);
 if(record.status!=='ready'||!record.faces.length)throw new ResourceError('RESOURCE_MISSING',`Font ${record.id} is unavailable.`);
 if(await fontRecordHash(record)!==record.sha256)throw new ResourceError('HASH_MISMATCH',`Font ${record.id} version identity does not match its manifest.`);
 assertActive(signal);
 if(![400,700].every(weight=>record.faces.some(face=>face.weight===weight)))throw new ResourceError('FONT_WEIGHT_MISSING','Both real 400 and 700 faces are required.');
 const needed=text===undefined?undefined:new Set(Array.from(text,c=>c.codePointAt(0)!));
 const faces=record.faces.filter(face=>!needed||face.codePoints.some(cp=>needed.has(cp)));
 const family=`AlbumFont_${record.sha256}`;const browserFaces:FontFace[]=[];let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;signal.removeEventListener('abort',dispose);for(const face of browserFaces)document.fonts.delete(face);};
 try{
  const weightCoverage=new Map<number,Set<number>>([[400,new Set()],[700,new Set()]]);
  for(const face of faces){
   assertActive(signal);let bytes:Uint8Array;
   try{bytes=await abortable(port.read(face.id,'font'),signal);}catch(error){assertActive(signal);throw new ResourceError('RESOURCE_MISSING',`Cannot read font subset ${face.id}: ${String(error)}`);}
   assertActive(signal);
   if(await sha256(bytes)!==face.sha256)throw new ResourceError('HASH_MISMATCH',`Font subset ${face.id} does not match its pinned SHA-256.`);
   let parsed:ReturnType<typeof create>;
   try{parsed=create(bytes as Buffer);}catch{throw new ResourceError('INVALID_FONT',`Cannot parse font subset ${face.id}.`);}
   if(!('characterSet' in parsed))throw new ResourceError('INVALID_FONT','Font collections are not supported.');
   const actual=[...parsed.characterSet].sort((a,b)=>a-b);
   if(actual.length!==face.codePoints.length||actual.some((cp,index)=>cp!==face.codePoints[index]))throw new ResourceError('FONT_CMAP_MISMATCH',`Font subset ${face.id} cmap differs from manifest.`);
   const weight=(parsed as unknown as {'OS/2':{usWeightClass:number}})['OS/2'].usWeightClass;
   if(weight!==face.weight)throw new ResourceError('FONT_WEIGHT_MISMATCH',`Font subset ${face.id} has weight ${weight}.`);
   for(const cp of actual)weightCoverage.get(face.weight)!.add(cp);
   const browserFace=new FontFace(family,new Uint8Array(bytes).buffer,{weight:String(face.weight),style:'normal',unicodeRange:actual.map(cp=>`U+${cp.toString(16)}`).join(',')});
   browserFaces.push(browserFace);
   await abortable(browserFace.load(),signal);assertActive(signal);
  }
  for(const face of browserFaces)document.fonts.add(face);
  await abortable(document.fonts.ready,signal);assertActive(signal);
  // A family promises both explicit weights; coverage must hold in each.
  const codePoints=new Set([...weightCoverage.get(400)!].filter(cp=>weightCoverage.get(700)!.has(cp)));
  signal.addEventListener('abort',dispose,{once:true});
  return {family,faces,codePoints,dispose};
 }catch(error){dispose();throw error;}
}
