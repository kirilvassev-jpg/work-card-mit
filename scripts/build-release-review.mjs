import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {renderCompatibleRelease} from './build-compatible-release.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildReleaseReview(base,sourceCommit='local'){
  const release=await renderCompatibleRelease();
  if(base.main!==release.metadata.baselineCommit||base.tree!==release.metadata.baselineTree)throw Error('Production baseline moved; review before packaging');
  const files=new Map(release.files);
  const metadata={...release.metadata,sourceCommit};
  files.set('compat/release.json',Buffer.from(JSON.stringify(metadata,null,2)+'\n'));
  files.set('.github/check-compatible-release.mjs',await readFile(path.join(root,'scripts/check-compatible-release.mjs')));
  files.set('.github/workflows/compatible-release.yml',Buffer.from(`name: Compatible release checks
on:
  push:
    branches: [main, codex/compatible-release, codex/rollback-compatible-release]
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node .github/check-compatible-release.mjs
`));
  const hashes=Object.fromEntries([...files].map(([file,data])=>[file,createHash('sha256').update(data).digest('hex')]));
  const baselineGit=Object.fromEntries(base.entries.filter(entry=>entry.type==='blob').map(entry=>[entry.path,entry.sha]));
  files.set('.github/compatible-release-checks.json',Buffer.from(JSON.stringify({version:metadata.version,prefix:metadata.prefix,pages:metadata.changedRootPages,baselineCommit:base.main,sourceCommit,baselineGit,releaseHashes:hashes},null,2)+'\n'));
  const output=path.join(root,'.cache','release-review',metadata.version);
  const candidate=path.join(output,'candidate'),rollback=path.join(output,'rollback');
  await mkdir(output,{recursive:true});
  await cp(path.join(root,'.cache','compat-baseline'),candidate,{recursive:true});
  for(const [file,data] of files){const target=path.join(candidate,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);}
  await cp(candidate,rollback,{recursive:true});
  for(const file of metadata.changedRootPages)await writeFile(path.join(rollback,file),await readFile(path.join(root,'compat','baseline',file)));
  const entries=[];
  for(const [file,data] of files){
    const sha=createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
    if(baselineGit[file]===sha)continue;
    const existing=base.entries.find(entry=>entry.type==='blob'&&entry.sha===sha);
    entries.push(existing?{path:file,mode:'100644',type:'blob',sha}:{path:file,mode:'100644',type:'blob',content:data.toString('utf8')});
  }
  await writeFile(path.join(output,'upload.json'),JSON.stringify(entries));
  await writeFile(path.join(output,'rollback.json'),JSON.stringify(metadata.changedRootPages.map(file=>({path:file,mode:'100644',type:'blob',sha:baselineGit[file]}))));
  return {output,candidate,rollback,version:metadata.version,files:entries.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const base=JSON.parse(await readFile(path.join(root,'.cache','release-base.json'),'utf8'));
  console.log(JSON.stringify(await buildReleaseReview(base,process.argv[2]||'local')));
}
