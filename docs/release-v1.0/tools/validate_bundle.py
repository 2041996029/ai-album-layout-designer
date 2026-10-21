"""Validate design artifacts only. Never starts product services or contacts providers."""
from pathlib import Path
from copy import deepcopy
from urllib.parse import urlsplit,unquote
from html.parser import HTMLParser
from collections import Counter
from datetime import datetime,timezone
import argparse,csv,hashlib,json,re,sys,unicodedata,zipfile
import yaml
from jsonschema import Draft202012Validator,FormatChecker,RefResolver
from openapi_spec_validator import OpenAPIV31SpecValidator
from pglast import parse_sql

P=Path(__file__).resolve().parents[1]
R=P.parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--source-only',action='store_true');parser.add_argument('--archive',type=Path);args=parser.parse_args()
def reject_constant(x):raise ValueError('Non-finite JSON constant: '+x)
def load(path):return json.loads(path.read_text(encoding='utf-8'),parse_constant=reject_constant)
def csvrows(path):return list(csv.DictReader(path.open(encoding='utf-8',newline='')))
def check(condition,message):
 if not condition:raise AssertionError(message)
def validator(path,fragment=None):
 data=load(path);schema=data
 if fragment:
  for key in fragment.split('/'):schema=schema[key]
 return Draft202012Validator(schema,resolver=RefResolver(base_uri=path.as_uri(),referrer=data),format_checker=FormatChecker())
def structural(name,value,fragment=None):
 if name=='config-values.json':
  for v in value:validator(P/'contracts/schemas/config.schema.json').validate(v)
  return
 mapping={'document.json':'document','document-opaque.json':'document','layout-request.json':'layout','export-options.json':'export','export-snapshot.json':'export','assignment-manifest.json':'layout','provider-contract.json':'provider','provider-unknown.json':'provider'}
 if name=='environment.json':v=validator(P/'operations/environment.schema.json')
 else:
  typ=mapping[name];fragments={'export-snapshot.json':'$defs/snapshot','assignment-manifest.json':'$defs/assignmentManifest','provider-unknown.json':'$defs/submitResult'}
  v=validator(P/'contracts/schemas'/f'{typ}.schema.json',fragments.get(name))
 v.validate(value)
def semantic(name,value):
 if name=='document.json':
  seen=set()
  def layers(items):
   total=0
   for layer in items:
    check(layer['id'] not in seen,'duplicate layer ID');seen.add(layer['id']);total+=1
    if layer['type']=='group':total+=layers(layer['children'])
    if layer['type']=='image':
     c=layer['crop'];check(c['x']+c['width']<=1+1e-9 and c['y']+c['height']<=1+1e-9,'crop exceeds normalized source')
   return total
  for key in ['front','back']:check(layers(value['cover'][key])<=100,'recursive cover layer budget')
  for spread in value['spreads']:
   check(spread['id'] not in seen,'duplicate spread ID');seen.add(spread['id']);check(layers(spread['layers'])<=100,'recursive spread layer budget')
 elif name=='layout-request.json':
  photos=value['photos'];ids=[x['assetId'] for x in photos];check(len(ids)==len(set(ids)),'duplicate input photo IDs')
  c=value['constraints'];check(c['minPhotosPerSpread']<=c['maxPhotosPerSpread'],'min exceeds max')
  for key in ['requiredAssetIds','excludedAssetIds','explicitRepeatAssetIds']:check(set(c.get(key,[]))<=set(ids),'policy references non-input ID')
  check(not set(c.get('requiredAssetIds',[]))&set(c.get('excludedAssetIds',[])),'required/excluded conflict')
  for item in photos:check(item['width']*item['height']<=80000000,'source pixel budget')
 elif name=='assignment-manifest.json':
  incoming=set(value['inputAssetIds']);counts=Counter(x['assetId'] for x in value['placements'])
  check(set(counts)<=incoming,'unexpected placement');check(set(value['unusedAssetIds'])==incoming-set(counts),'unused mismatch')
  repeated={x for x,n in counts.items() if n>1};check(set(value['repeatedAssetIds'])==repeated,'repeated mismatch')
  if value['selectionPolicy']=='all':check(set(counts)==incoming,'all requires complete placement')
  if value['duplicatePolicy']=='forbid':check(not repeated,'duplicates forbidden')
 elif name=='export-options.json':
  doc=load(P/'contracts/examples/document.json');known={x['id'] for x in doc['spreads']}
  if value['view']=='singlePage':known={x+':'+side for x in known for side in ['left','right']}
  if value['includeCover']:known|={'front','back'}
  check(set(value['pageIds'])<=known,'page not in document/view')
 elif name=='config-values.json':
  for c in value:
   k=c['kind']
   if k=='storage':
    prefix=c['basePrefix']
    for _ in range(3):prefix=unquote(prefix)
    check(not prefix.startswith('/') and '\\' not in prefix and not any(s in ['.','..',''] for s in prefix.split('/')),'decoded prefix traversal')
    if c['encryptionMode']=='kms':check('kmsKeyRef' in c,'missing KMS reference')
    if c['cdnMode']=='signed':check('downloadDomain' in c,'missing CDN domain')
   if k=='layout':check(c['minPhotosPerSpread']<=c['maxPhotosPerSpread'] and abs(sum(c['weights'].values())-1)<1e-8,'invalid layout limits/weights')
   if k=='queue':check(c['heartbeatSeconds']<c['leaseSeconds'] and len(c['retryBackoffSeconds'])==c['retryLimit'],'invalid lease/backoff')
   if k=='editor':check(c['autosaveIdleMs']<=c['autosaveMaxMs'],'invalid autosave time')
   if k=='aiRoute' and c['capability']=='textSuggestion':check(not c['enabled'],'optional textSuggestion not implemented')
 elif name=='environment.json':check(value['CONFIG_REFRESH_SECONDS']<=value['CONFIG_MAX_STALENESS_SECONDS'],'config refresh exceeds stale limit')

schemas=list((P/'contracts/schemas').glob('*.json'))+[P/'operations/environment.schema.json']
for file in schemas:Draft202012Validator.check_schema(load(file))
examples=P/'contracts/examples';positive=0
for file in examples.glob('*.json'):
 if file.name=='invalid-cases.json':continue
 value=load(file);structural(file.name,value);semantic(file.name,value);positive+=len(value) if file.name=='config-values.json' else 1
negative=load(examples/'invalid-cases.json')
for case in negative:
 value=deepcopy(load(examples/case['base']));cursor=value
 for key in case['path'][:-1]:cursor=cursor[key]
 cursor[case['path'][-1]]=case['value']
 try:
  structural(case['base'],value)
  if case['rejectionLevel']=='semantic':semantic(case['base'],value)
 except Exception as error:
  # A semantic case must have passed structural validation, tested independently.
  if case['rejectionLevel']=='semantic':structural(case['base'],value)
 else:raise AssertionError('invalid case unexpectedly accepted: '+case['id'])
# Unknown same-version fields/layers are preserved structurally; future layer export remains a runtime blocker.
opaque=load(examples/'document.json');opaque['spreads'][0]['layers'].append({'id':'opaque_01','type':'future_vector','custom':{'blend':'multiply'}})
structural('document-opaque.json',opaque);check(json.loads(json.dumps(opaque))==opaque,'opaque roundtrip')

api_path=P/'contracts/openapi.yaml';api=yaml.safe_load(api_path.read_text());OpenAPIV31SpecValidator(api,base_uri=api_path.as_uri()).validate()
operations={};refs=set();request_examples=0;documents={api_path:api}

def resolve_ref(uri,base):
 key=(base.as_uri(),uri)
 if key in refs:return
 refs.add(key);parts=urlsplit(uri)
 check(not parts.scheme and not parts.netloc,'remote reference not allowed in offline bundle: '+uri)
 file=(base.parent/unquote(parts.path)).resolve() if parts.path else base
 if file not in documents:documents[file]=yaml.safe_load(file.read_text()) if file.suffix in ['.yaml','.yml'] else load(file)
 data=documents[file]
 for fragment in unquote(parts.fragment).lstrip('/').split('/'):
  if fragment:data=data[fragment.replace('~1','/').replace('~0','~')]
 walk(data,file)
def walk(value,base):
 if isinstance(value,dict):
  if '$ref' in value:resolve_ref(value['$ref'],base)
  for k,v in value.items():
   if k!='$ref':walk(v,base)
 elif isinstance(value,list):
  for v in value:walk(v,base)
walk(api,api_path)
for path,methods in api['paths'].items():
 for method,op in methods.items():
  if method not in ['get','post','patch','put','delete']:continue
  oid=op['operationId'];check(oid not in operations,'duplicate operationId');operations[oid]=op
  check(op.get('x-module') in ['C2','C3','C4','C5','OPS'] and op.get('x-requirement-ids'),'missing API ownership/requirements')
  params=methods.get('parameters',[])+op.get('parameters',[]);found=[]
  for par in params:
   if '$ref' in par:
    par0=api
    for key in par['$ref'][2:].split('/'):par0=par0[key]
    par=par0
   if par.get('in')=='path':check(par.get('required') is True,'optional path parameter');found.append(par['name'])
  check(set(found)==set(re.findall(r'{([^}]+)}',path)),'path parameters mismatch '+oid)
  body=op.get('requestBody',{})
  for content in body.get('content',{}).values():
   values=[]
   if 'example' in content:values.append(content['example'])
   for e in content.get('examples',{}).values():
    if 'value' in e:values.append(e['value'])
   for example in values:
    Draft202012Validator(content['schema'],resolver=RefResolver(api_path.as_uri(),api),format_checker=FormatChecker()).validate(example);request_examples+=1

reqs=csvrows(P/'requirements.csv');reqmap={r['requirement_id']:r for r in reqs};check(len(reqmap)==49,'requirement count')
pages=csvrows(P/'ux/pages.csv');pagemap={r['page_id']:r for r in pages};check(len(pagemap)==65,'page count')
cases=csvrows(P/'testing/cases.csv');casemap={r['case_id']:r for r in cases};check(len(casemap)==73,'acceptance case count')
contractcases=csvrows(P/'testing/api-contract-cases.csv');check({r['operation_id'] for r in contractcases}==set(operations),'API case coverage')
plans={};task_count=0;step_count=0
for file in sorted((P.parent/'superpowers/plans').glob('2026-10-21-c[1-6]-*.md')):
 text=file.read_text();module='C'+re.search(r'-c([1-6])-',file.name).group(1)
 check(all(k in text for k in ['**For agentic workers:**','**Goal:**','**Architecture:**','**Tech Stack:**','**Spec:**','## Global Constraints','## Review Focus']),'plan header '+module)
 chunks=re.split(r'^#{2,3} Task (\d+):',text,flags=re.M);numbers=[int(chunks[i]) for i in range(1,len(chunks),2)]
 check(numbers==list(range(1,len(numbers)+1)),'plan numbering '+module);plans[module]=set(numbers);task_count+=len(numbers)
 for n in numbers:
  chunk=chunks[n*2]
  steps=re.findall(r'^- \[ \] \*\*Step ([1-5]):',chunk,re.M);check(steps==['1','2','3','4','5'],'5-step task '+module+str(n));step_count+=len(steps)
  check('**Files:**' in chunk and '**Interfaces:**' in chunk and 'expect(' in chunk and 'git commit -m' in chunk,'task contract '+module+str(n))
 for i in range(1,6):check(text.count('RF'+str(i))>=2,'unmapped Review Focus')
check(set(plans)=={'C1','C2','C3','C4','C5','C6'} and task_count==44 and step_count==220,'all-module plans')
for r in reqs:
 rid=r['requirement_id'];check((P/r['source']).exists(),'requirement source')
 for oid in filter(None,r['operation_ids'].split(';')):check(oid in operations and rid in operations[oid]['x-requirement-ids'],'requirement operation')
 if r['ui_scope']=='screen':check(r['page_ids'],'missing screen')
 else:check(rid=='APP-RESERVE','undeclared no-UI requirement')
 for pid in filter(None,r['page_ids'].split(';')):check(pid in pagemap and rid in pagemap[pid]['requirement_ids'].split(';'),'requirement page')
 for cid in r['acceptance_case_ids'].split(';'):check(cid in casemap and rid in casemap[cid]['requirement_ids'].split(';'),'requirement case')
 for task in r['plan_tasks'].split(';'):
  mod,num=task.split(':T');check(int(num) in plans[mod],'plan task ref')
check(set(x for op in operations.values() for x in op['x-requirement-ids'])==set(reqmap),'API requirement IDs')
for r in pages:
 for k in ['loading_state','empty_state','error_state','forbidden_state','offline_state','conflict_state']:check(r[k].strip(),'empty page state')
 for rid in r['requirement_ids'].split(';'):check(rid in reqmap,'unknown page requirement')
 for path in r['prototype_paths'].split(';'):check((P/'ux'/path).exists(),'missing page prototype')
perms=csvrows(P/'ux/permissions.csv');roles=['guest','owner','workspace_admin','designer','viewer','support','content','finance','ops','auditor']
check(len(perms)==54,'permission action count')
for r in perms:
 for role in roles:check(r[role] in ['ALLOW','DENY','SCOPED','CONDITIONAL'],'permission enum')
 for pid in r['page_ids'].split(';'):check(pid in pagemap,'permission page ref')

up=P/'database/001_initial.up.sql';down=P/'database/001_initial.down.sql';checks=P/'database/contract-checks.sql'
for file in [up,down,checks]:parse_sql('\n'.join(line for line in file.read_text().splitlines() if not line.startswith('\\')))
tables=set(re.findall(r'^CREATE TABLE (\w+) \(',up.read_text(),re.M));check(len(tables)==92,'DDL table count')
dictionary=set(re.findall(r'^### `(\w+)`', (P/'database/data-dictionary.md').read_text(),re.M));check(dictionary==tables,'data dictionary coverage')
erd=set(re.findall(r'^    (\w+) \{', (P/'database/erd.mmd').read_text(),re.M));check(erd==tables,'ERD table coverage')
for kind in ['privacy_export','config_test','reconciliation','backup_restore_drill']:check(up.read_text().count("'"+kind+"'")>=2,'job/snapshot kind parity')
check("format IN ('jpeg','png','pdf')" in up.read_text() and "format IN ('jpeg','png','pdf','json','zip')" in up.read_text(),'artifact format parity')
for file in [P/'operations/compose.review.yaml']:yaml.safe_load(file.read_text())
# Original content data is a design, not falsely published commercial assets.
filters=load(P/'content/filter-catalog.json');check([r['id'] for r in filters['items']]==[f'F{i:02}' for i in range(1,34)],'33 filter IDs')
check(filters['sourceCsvSha256']==hashlib.sha256((P.parent/'ai-album-v0.1/filters.csv').read_bytes()).hexdigest(),'source CSV hash')
seeds=load(P/'content/template-seeds.json')['templates'];check(len(seeds)==5 and {r['category'] for r in seeds}=={'wedding','travel','family','portrait','ink'},'five template categories')
for template in seeds:
 for slot in template['slots']:
  frame=slot['frame'];check(frame['width']>0 and frame['height']>0 and frame['x']>=0 and frame['y']>=0,'template frame')
  check(frame['x']+frame['width']<=template['pageSize']['width']*2 and frame['y']+frame['height']<=template['pageSize']['height'],'template bounds')
check(len(load(P/'content/style-presets.json')['items'])==3,'style draft count')

class Links(HTMLParser):
 def __init__(self):super().__init__();self.refs=[]
 def handle_starttag(self,tag,attrs):
  for k,v in attrs:
   if k in ['href','src'] and v:self.refs.append(v)
local_refs=0
detached_download_links=0
for file in list(P.rglob('*.md'))+list(P.rglob('*.html'))+[R/'README.md']+list((P.parent/'superpowers/plans').glob('*.md')):
 text=file.read_text();links=[]
 if file.suffix=='.md':links=re.findall(r'\[[^\]]+\]\(([^\s)]+)\)',text)
 else:
  h=Links();h.feed(text);links=h.refs
 for link in links:
  u=urlsplit(link)
  if u.scheme or not u.path:continue
  target=(file.parent/unquote(u.path)).resolve()
  if args.source_only and target.suffix in ['.pdf','.docx','.zip']:continue
  # A downloaded archive cannot contain itself. Only this exact release ZIP is external.
  if target==R/'docs/AI相册-全模块研发交付包-v1.0.zip' and not target.exists():
   detached_download_links+=1;continue
  check(target.exists(),'missing local link '+str(file.relative_to(R))+' -> '+link);local_refs+=1
sql_evidence=load(P/'verification/sql-execution.json')
check(sql_evidence['status']=='passed' and sql_evidence['negativeAssertions']==39,'SQL execution evidence')
for name,digest in sql_evidence['artifacts'].items():check(hashlib.sha256((P/'database'/name).read_bytes()).hexdigest()==digest,'SQL changed since execution')
# PDF/Word and source freshness are document checks, never app-render tests.
import fitz
from docx import Document
pdf=fitz.open(P/'AI相册-全模块研发手册-v1.0.pdf');pdf_pages=len(pdf)
check(pdf_pages>30,'handbook unexpectedly short')
pdf_text='\n'.join(page.get_text() for page in pdf)
for term in ['Task 10:','C6','AUTH-01','Config','opaque_id']:check(term in pdf_text,'handbook missing section '+term)
proto_pdf=fitz.open(P/'全部页面原型册-v1.0.pdf');check(len(proto_pdf)==19,'prototype PDF pages')
proto_ids=[int(re.search(r'P(\d{2})',page.get_text()).group(1)) for page in proto_pdf]
check(proto_ids==list(range(1,20)),'prototype book order')
word_file=P/'AI相册-全模块研发手册-v1.0.docx';check(zipfile.ZipFile(word_file).testzip() is None,'Word ZIP integrity')
check(len(Document(word_file).inline_shapes)==4,'Word embedded new screens')
source_record=load(P/'verification/handbook-sources.json')
for entry in source_record['sources']+source_record['outputs']:
 check(hashlib.sha256((R/entry['path']).read_bytes()).hexdigest()==entry['sha256'],'handbook source/output changed: '+entry['path'])
package_manifest=load(P/'manifest.json');manifest_files=0
if package_manifest.get('status')=='complete':
 check(bool(package_manifest['files']),'empty completed manifest')
 for entry in package_manifest['files']:
  target=(R/entry['path']).resolve();check(target.is_relative_to(R),'manifest path escape')
  check(target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==entry['sha256'],'manifest SHA mismatch '+entry['path']);manifest_files+=1
else:check(args.source_only,'manifest not yet completed')
archive_info=None
if args.archive:
 with zipfile.ZipFile(args.archive) as archive:
  check(archive.testzip() is None,'archive CRC');names=set(archive.namelist())
  check('ai-album-rd-v1.0/docs/release-v1.0/README.md' in names,'archive root')
  for file in P.rglob('*'):
   if file.is_file():
    member='ai-album-rd-v1.0/'+str(file.relative_to(R))
    check(member in names,'archive missing artifact')
    check(archive.read(member)==file.read_bytes(),'archive artifact differs '+member)
  for entry in package_manifest['files']:
   member='ai-album-rd-v1.0/'+entry['path']
   check(member in names,'archive missing manifest entry '+entry['path'])
   check(hashlib.sha256(archive.read(member)).hexdigest()==entry['sha256'],'archive manifest SHA mismatch '+entry['path'])
  archive_info={'files':len(names),'bytes':args.archive.stat().st_size,'sha256':hashlib.sha256(args.archive.read_bytes()).hexdigest()}
report={'status':'passed','scope':'All-module design contracts and documentation; no product implementation/live provider tests','requirements':len(reqs),'apiOperations':len(operations),'apiPaths':len(api['paths']),'transportSchemas':len(api['components']['schemas']),'resolvedReferences':len(refs),'validRequestExamples':request_examples,'businessSchemas':len(schemas),'positiveSchemaValues':positive,'negativeSchemaSemanticCases':len(negative),'pages':len(pages),'pageStates':len(pages)*6,'permissionActions':len(perms),'implementationTasks':task_count,'implementationSteps':step_count,'plannedBusinessAcceptanceCases':len(cases),'plannedApiContractCases':len(contractcases),'databaseTables':len(tables),'sqlNegativeAssertionsExecuted':sql_evidence['negativeAssertions'],'sqlServerVersion':sql_evidence['serverVersion'],'localReferencesChecked':local_refs,'handbookPdfPages':pdf_pages,'prototypePdfPages':19,'handbookSourceFiles':len(source_record['sources']),'manifestFilesVerified':manifest_files,'validationMode':'source_only' if args.source_only else 'full','archive':archive_info,'executedAtUtc':datetime.now(timezone.utc).isoformat(),'displayTimezone':'Asia/Shanghai','productImplementationStarted':False,'liveIntegrationsExecuted':False}
report['detachedDownloadLinksMissing']=detached_download_links
if not args.archive:(P/'verification/artifact-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
