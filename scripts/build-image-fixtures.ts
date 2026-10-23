/** Reproducible decoder fixtures: four solid corner quadrants, EXIF inserted losslessly. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output='tests/fixtures/images';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
try{
 const page=await browser.newPage();
 for(const fixture of [{name:'orientation-6',width:300,height:200,orientation:6},{name:'orientation-8',width:300,height:200,orientation:8},{name:'transparent',width:32,height:32},{name:'landscape',width:2000,height:1000},{name:'portrait',width:1000,height:2000},{name:'extreme',width:10000,height:1}]){
  const jpeg='orientation' in fixture;
  const base64=await page.evaluate(({width,height,jpeg,transparent})=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;if(!transparent){const colors=['#ff0000','#00ff00','#0000ff','#ffff00'];for(let i=0;i<4;i++){ctx.fillStyle=colors[i];ctx.fillRect(i%2*width/2,Math.floor(i/2)*height/2,width/2,height/2);}}return canvas.toDataURL(jpeg?'image/jpeg':'image/png',1).split(',')[1];},{...fixture,jpeg,transparent:fixture.name==='transparent'});
  let bytes=Buffer.from(base64,'base64');
  if(jpeg){
   // APP1: Exif\0\0 + little-endian TIFF, one SHORT orientation IFD entry.
   const app1=Buffer.from([0xff,0xe1,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,fixture.orientation!,0,0,0,0,0,0,0]);
   bytes=Buffer.concat([bytes.subarray(0,2),app1,bytes.subarray(2)]);
  }
  await writeFile(`${output}/${fixture.name}.${jpeg?'jpg':'png'}`,bytes);
  await writeFile(`${output}/${fixture.name}.json`,JSON.stringify({...fixture,colors:['red','green','blue','yellow'],channelTolerance:jpeg?8:0},null,2)+'\n');
 }
 // Valid signature/IHDR dimensions only: importer must reject before decoder allocation.
 const huge=Buffer.alloc(33);huge.set([137,80,78,71,13,10,26,10]);huge.writeUInt32BE(13,8);huge.write('IHDR',12);huge.writeUInt32BE(80_000_001,16);huge.writeUInt32BE(1,20);huge[24]=8;huge[25]=6;await writeFile(`${output}/too-many-pixels.png`,huge);
}finally{await browser.close();}
