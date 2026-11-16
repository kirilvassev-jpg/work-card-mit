import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
test('all browser scripts parse, and real static asset references exist',()=>{
  for(const file of readdirSync(root).filter(f=>/\.(html|js)$/.test(f))){
    const source=readFileSync(new URL(file,root),'utf8');
    const scripts=file.endsWith('.js')?[source]:[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m=>m[1]);
    scripts.forEach((s,i)=>assert.doesNotThrow(()=>new vm.Script(s,{filename:file+':'+i})));
    if(!file.endsWith('.html'))continue;
    assert.equal((source.match(/src="app-config.js"/g)||[]).length,1,file);
    assert.equal((source.match(/src="auth.js"/g)||[]).length,1,file);
    assert.ok(source.indexOf('app-config.js')<source.indexOf('auth.js'),file);
    const markup=source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'');
    for(const match of markup.matchAll(/(?:src|href)="([^"#?]+)"/g)){
      if(/^(https?:|data:)/.test(match[1]))continue;
      assert.ok(existsSync(new URL(match[1],root)),file+': '+match[1]);
    }
  }
});
