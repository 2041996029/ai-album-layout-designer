// Isolated research probe. Reads pinned upstream source; no product implementation.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const base=process.argv[2]||__dirname;
const out=process.argv[3]||path.join(base,'results');
fs.mkdirSync(out,{recursive:true});
const layoutRoot=path.join(base,'justified-layout');
const binderRoot=path.join(base,'Photo-Book-Binder');
const justified=require(path.join(layoutRoot,'lib/index.js'));
const commit=p=>cp.execFileSync('git',['-C',p,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(commit(layoutRoot),'9d4db49cdbf45604c63a8b25293650af4fe952ab');
assert.equal(commit(binderRoot),'b9c10ad8a9911e65d4cee8c5289519de29d0aa0f');
const ratios=[1.5,.67,1,2,1.33,.75,1.8,1,1.25,.67,1.5,2];
function checkGeometry(input,g,w){
 const eps=1e-6;
 assert.equal(g.boxes.length,input.length,'omitted photos');
 g.boxes.forEach((b,i)=>{
  for(const v of [b.left,b.top,b.width,b.height])assert(Number.isFinite(v));
  assert(b.width>0&&b.height>0);
  assert(b.left>=-eps&&b.top>=-eps);
  assert(b.left+b.width<=w+eps,'horizontal overflow');
  assert(b.top+b.height<=g.containerHeight+eps,'vertical overflow');
  assert(Math.abs(b.width/b.height-input[i])<eps,'aspect ratio changed');
  for(let j=0;j<i;j++){
   const q=g.boxes[j];
   const dx=Math.min(b.left+b.width,q.left+q.width)-Math.max(b.left,q.left);
   const dy=Math.min(b.top+b.height,q.top+q.height)-Math.max(b.top,q.top);
   assert(!(dx>eps&&dy>eps),'overlap');
  }
 });
}
const layouts=[];
for(const width of [320,600,1060])for(const count of [1,7,50,200,500]){
 const input=Array.from({length:count},(_,i)=>ratios[i%ratios.length]);
 const config={containerWidth:width,containerPadding:16,boxSpacing:8,targetRowHeight:width/4,showWidows:true};
 const g=justified(input,config);checkGeometry(input,g,width);
 layouts.push({width,count,boxes:g.boxes.length,containerHeight:g.containerHeight,status:'passed'});
}
const sceneConfig={containerWidth:700,containerPadding:24,boxSpacing:12,targetRowHeight:150,showWidows:true};
const sample=justified(ratios,sceneConfig);checkGeometry(ratios,sample,700);
fs.writeFileSync(path.join(out,'justified-geometry.json'),JSON.stringify({ratios,config:sceneConfig,result:sample},null,2));
const falseWidows=justified(ratios,{...sceneConfig,targetRowHeight:160,showWidows:false});
const limitRows=justified(ratios,{...sceneConfig,maxNumRows:1});

// Extract only the inspected pure imposition function; do not evaluate the browser app.
const upstream=fs.readFileSync(path.join(binderRoot,'app.js'),'utf8');
const start=upstream.indexOf('function buildImposition() {');
const end=upstream.indexOf('\nfunction showPrintModal()',start);
assert(start>=0&&end>start);
const fn=upstream.slice(start,end);
const signatures=[];
for(const numLagen of [1,2,6,20])for(const blaetter of [2,3,4,5,6,7,8]){
 const context=vm.createContext({S:{numLagen,blaetter},PDF_H:148.5});
 const result=vm.runInContext(fn+'\nbuildImposition()',context,{timeout:1000});
 const ids=result.flatMap(p=>p.slots.map(s=>s.pageIdx));
 const expected=numLagen*blaetter*4;
 const integerPages=ids.every(Number.isInteger);
 const unique=new Set(ids).size;
 const inRange=ids.every(i=>i>=0&&i<expected);
 const valid=integerPages&&inRange&&ids.length===expected&&unique===expected;
 signatures.push({numLagen,blaetter,expectedPages:expected,pdfSides:result.length,assignedSlots:ids.length,uniquePages:unique,integerPages,inRange,status:valid?'passed':'failed'});
 if(numLagen===1&&blaetter===4)fs.writeFileSync(path.join(out,'binder-imposition.json'),JSON.stringify({numLagen,blaetter,result},null,2));
}
assert(signatures.filter(s=>s.blaetter%2===0).every(s=>s.status==='passed'));
assert(signatures.filter(s=>s.blaetter%2===1).every(s=>s.status==='failed'));
const summary={
 date:'2026-10-21',scope:'Isolated algorithm probes only, not end-to-end product export or supplier API testing',
 sources:[{repo:'flickr/justified-layout',commit:commit(layoutRoot),packageVersion:'4.1.0',licenseFile:'MIT',packageJsonLicense:'ISC'},{repo:'Kubimeter/Photo-Book-Binder',commit:commit(binderRoot),licenseFile:'MIT'}],
 justified:{cases:layouts.length,passed:layouts.length,invariants:['count','finite positive dimensions','no overlap','within geometry container','aspect ratios preserved'],layouts,omissionOptions:{showWidowsFalse:{input:ratios.length,output:falseWidows.boxes.length},maxNumRowsOne:{input:ratios.length,output:limitRows.boxes.length}}},
 binder:{cases:signatures.length,passed:signatures.filter(s=>s.status==='passed').length,failed:signatures.filter(s=>s.status==='failed').length,uiStep:2,findings:'Even sheets pass tested page-set invariants. Odd sheets fail; UI step is 2, but source input and JSON loading do not validate evenness.',signatures},
 limitations:['No real photographs used','No browser UI or native PDF exporter executed','No print folding proof','No production load or visual beauty evaluation','Zine not invoked due non-commercial license; Mojing inaccessible']
};
fs.writeFileSync(path.join(out,'evaluation-results.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({justified:summary.justified.cases+' passed',omissionOptions:summary.justified.omissionOptions,binder:{cases:summary.binder.cases,passed:summary.binder.passed,failed:summary.binder.failed},sourceSHAs:summary.sources.map(x=>x.commit)},null,2));
