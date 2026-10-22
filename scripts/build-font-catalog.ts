/** Lockfile-installed Fontsource subsets only. cmap comes from fontkit, never CSS ranges. */
import { create } from 'fontkit';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fontRecordHash } from '../packages/assets/src/font-identity';
import type { FontRecord, FontFaceRecord } from '../packages/assets/src/types';
const output='apps/web/public/fonts';await mkdir(output,{recursive:true});
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const fonts:FontRecord[]=[];const licenses:string[]=[];
for(const slug of ['noto-sans-sc','noto-serif-sc']){
 const root=`node_modules/@fontsource/${slug}`;const pkg=JSON.parse(await readFile(`${root}/package.json`,'utf8'));const meta=JSON.parse(await readFile(`${root}/metadata.json`,'utf8'));
 if(pkg.version!=='5.3.1'||meta.license.type!=='OFL-1.1')throw new Error('Unexpected font source or license');
 const faces:FontFaceRecord[]=[];
 for(const filename of (await readdir(`${root}/files`)).filter(f=>/-(400|700)-normal\.woff2$/.test(f)).sort()){
  const bytes=await readFile(`${root}/files/${filename}`);const sha256=hash(bytes);const weight=Number(filename.match(/-(400|700)-normal/)![1]) as 400|700;
  // Keep all publisher subsets: codePoints are measured from the actual file.
  const font=create(bytes);if(!('characterSet' in font))throw new Error('Unexpected font collection');
  if((font as unknown as {'OS/2':{usWeightClass:number}})['OS/2'].usWeightClass!==weight)throw new Error('Wrong actual font weight');
  const codePoints=[...font.characterSet].sort((a,b)=>a-b);
  const file=`${slug}-${sha256}.woff2`;await writeFile(`${output}/${file}`,bytes);
  faces.push({id:`font-${sha256}`,sha256,byteLength:bytes.length,file:`/fonts/${file}`,weight,style:'normal',codePoints});
 }
 const source={kind:'bundled' as const,name:`@fontsource/${slug}@${pkg.version} (${meta.version})`,url:meta.source};
 const license={id:'OFL-1.1',usable:true,source:'/fonts/OFL.txt',text:await readFile(`${root}/LICENSE`,'utf8')};
 const sha256=await fontRecordHash({faces,source,license});
 fonts.push({id:slug,version:1,sha256,family:meta.family,source,license,status:'ready',faces});
 licenses.push(`===== ${slug}, @fontsource ${pkg.version}, upstream ${meta.version} =====\n${await readFile(`${root}/LICENSE`,'utf8')}`);
}
await writeFile(`${output}/manifest.json`,JSON.stringify({assets:[],fonts},null,2)+'\n');
await writeFile(`${output}/OFL.txt`,licenses.join('\n\n'));
console.log(`Pinned ${fonts.length} families, ${fonts.reduce((n,f)=>n+f.faces.length,0)} faces; local files only.`);
