import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {parse}=require('@babel/parser');
for(const name of ['Fleet','Routes'])parse(fs.readFileSync('frontend-changes/'+name+'.jsx','utf8'),{sourceType:'module',plugins:['jsx']});
const source=fs.readFileSync('frontend-changes/Fleet.jsx','utf8');
let rows=[{id:'test',status:'ACTIVE'}],confirmed=true,calls=0,error='';
const context=vm.createContext({busy:false,user:{role:'ADMIN'},window:{confirm:()=>confirmed},api:{patch:async(_,data)=>{calls++;return {data:{id:'test',...data}}},delete:async()=>{calls++}},setBusy:()=>{},setError:v=>error=v,setNotice:()=>{},setVehicles:fn=>rows=fn(rows)});
vm.runInContext(source.slice(source.indexOf('  async function manage'),source.indexOf("  if(user?.role")),context);
await context.manage(rows[0],'INACTIVE');assert.equal(rows[0].status,'INACTIVE');
await context.manage(rows[0],'ACTIVE');assert.equal(rows[0].status,'ACTIVE');
confirmed=false;await context.manage(rows[0],'DELETE');assert.equal(calls,2);assert.equal(rows.length,1);
confirmed=true;context.api.delete=async()=>{throw {response:{data:{message:'Deactivate instead'}}}};await context.manage(rows[0],'DELETE');assert.equal(rows.length,1);assert.equal(error,'Deactivate instead');
context.api.delete=async()=>{};await context.manage(rows[0],'DELETE');assert.equal(rows.length,0);
console.log('PASS: both staged JSX files parse; mocked fleet state updates, confirmation cancellation, deletion rejection and successful removal. Not a browser test.');

