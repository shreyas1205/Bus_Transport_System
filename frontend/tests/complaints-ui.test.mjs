import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync, types as t } from '@babel/core';

// In-memory component harness: mocks React hooks, API and sockets. No browser or database.
const source = readFileSync(new URL('../src/pages/Complaints.jsx', import.meta.url), 'utf8');
const code = transformSync(source, {
  parserOpts: { plugins: ['jsx'] },
  plugins: [() => ({ visitor: {
    ImportDeclaration(p) { p.remove(); },
    ExportDefaultDeclaration(p) { p.replaceWith(p.node.declaration); },
    MetaProperty(p) { p.replaceWith(t.identifier('environment')); },
    JSXElement: { exit(p) {
      const n = p.node;
      const name = n.openingElement.name.name;
      const props = n.openingElement.attributes.map(a => t.objectProperty(t.stringLiteral(a.name.name),
        !a.value ? t.booleanLiteral(true) : t.isJSXExpressionContainer(a.value) ? a.value.expression : a.value));
      const children = n.children.flatMap(c => t.isJSXText(c) ? (c.value.trim() ? [t.stringLiteral(c.value.trim())] : []) : t.isJSXExpressionContainer(c) ? (t.isJSXEmptyExpression(c.expression) ? [] : [c.expression]) : [c]);
      p.replaceWith(t.callExpression(t.identifier('element'), [ /^[a-z]/.test(name) ? t.stringLiteral(name) : t.identifier(name), t.objectExpression(props), ...children]));
    } }
  } })]
}).code;
const element = (type, props, ...children) => ({ type, props, children: children.flat(Infinity).filter(c => c !== false && c != null) });
function harness(role, api, component = 'Complaints', props) {
  const states = []; let cursor = 0; let mounted = false; const effects = []; const events = {}; const dependencies = [];
  const useState = initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; };
  const fn = new Function('useState', 'useEffect', 'useMemo', 'useAuth', 'api', 'io', 'element', 'environment', `${code}; return ${component};`)(
    useState, (effect, deps) => { const i = cursor++; if (!dependencies[i] || deps.some((d, n) => d !== dependencies[i][n])) { effects.push(effect); dependencies[i] = deps; } }, fn => fn(), () => ({user:{id:'u1',role}}), api,
    () => ({on: (name, cb) => { events[name] = cb; }, off() {}, disconnect() {}}), element, {env:{}});
  return { events, render() { cursor = 0; const tree = fn(props); mounted = true; effects.splice(0).forEach(f => f()); return tree; } };
}
const nodes = tree => typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)];
const find = (tree, type) => nodes(tree).find(n => n.type === type);
const text = tree => typeof tree !== 'object' ? String(tree) : tree.children.map(text).join(' ');
const cards = tree => nodes(tree).filter(n => typeof n.type === 'function' && n.type.name === 'ComplaintCard');
const tick = () => new Promise(resolve => setImmediate(resolve));
const records = [{id:'c1',subject:'Late bus',category:'BUS_DELAY',description:'Late at stop',status:'OPEN',user:{name:'Anita'},createdAt:'2026-10-20T09:00:00Z'}, {id:'c2',subject:'Seat repair',category:'BUS_CONDITION',description:'Broken seat',status:'REJECTED',user:{name:'Rahul'},createdAt:'2026-10-20T09:00:00Z'}];
let posted, patched, resolvePost, failGet = false;
const api = {
  async get(path) { assert.equal(path,'/complaints'); if(failGet) throw Error('offline'); return {data:records}; },
  post(path, body) { posted = {path,body}; return new Promise(resolve => {resolvePost = resolve;}); },
  async patch(path, body) { patched={path,body}; Object.assign(records[0],body); return {data:{...records[0]}}; }
};
const student = harness('STUDENT',api);
assert.match(text(student.render()),/Loading complaints/); await tick();
let tree = student.render(); assert.equal(cards(tree).length,2);
find(tree,'input').props.onChange({target:{value:'Pickup issue'}});
tree = student.render(); find(tree,'textarea').props.onChange({target:{value:'Missed pickup today'}});
tree = student.render(); const pending = find(tree,'form').props.onSubmit({preventDefault(){}});
assert.equal(find(student.render(),'button').props.disabled,true);
assert.deepEqual(posted,{path:'/complaints',body:{subject:'Pickup issue',category:'BUS_DELAY',description:'Missed pickup today'}});
resolvePost({}); await pending; await tick();
assert.match(text(student.render()),/Complaint submitted/); assert.equal(find(student.render(),'input').props.value,'');
console.log('PASS mocked student loading, submission payload, pending state, success, form reset and history');
const admin = harness('ADMIN',api); admin.render(); await tick(); tree = admin.render();
assert.equal(cards(tree).length,2);
for (const query of [' ANITA ', 'late', 'bus delay', 'BUS_DELAY']) {
 find(tree,'input').props.onChange({target:{value:query}}); tree=admin.render(); assert.equal(cards(tree).length,1);
}
find(tree,'select').props.onChange({target:{value:'REJECTED'}}); tree=admin.render(); assert.equal(cards(tree).length,0); assert.match(text(tree),/No complaints match/);
find(tree,'input').props.onChange({target:{value:''}}); tree=admin.render(); assert.equal(cards(tree)[0].props.complaint.id,'c2');
find(tree,'select').props.onChange({target:{value:'ALL'}}); tree=admin.render();
await cards(tree)[0].props.onSave('c1','RESOLVED','Bus timing corrected'); await tick();
assert.deepEqual(patched,{path:'/complaints/c1/status',body:{status:'RESOLVED',adminResponse:'Bus timing corrected'}});
student.events['complaint:update'](); await tick();
const cardProps = cards(student.render())[0].props;
const card = harness('STUDENT',api,'ComplaintCard',cardProps).render();
assert.match(text(card),/Bus timing corrected/);
assert.equal(nodes(card).find(n => typeof n.type === 'function' && n.type.name === 'StatusChip').props.status,'RESOLVED');
console.log('PASS mocked admin list, student/subject/category search, combined filters, update payload and student socket refresh');
failGet=true; const failure=harness('ADMIN',api); failure.render(); await tick();
assert.match(text(failure.render()),/Could not load complaints/); assert.match(text(failure.render()),/Retry/);
const badApi={...api, async post(){throw Error('offline');}, async patch(){throw Error('offline');}};
failGet=false; const bad=harness('STUDENT',badApi); bad.render(); await tick(); tree=bad.render();
find(tree,'input').props.onChange({target:{value:'Test'}}); tree=bad.render(); find(tree,'textarea').props.onChange({target:{value:'Details'}});
await find(bad.render(),'form').props.onSubmit({preventDefault(){}});
assert.match(text(bad.render()),/Could not submit/); assert.equal(find(bad.render(),'input').props.value,'Test');
const badAdmin=harness('ADMIN',badApi); badAdmin.render(); await tick(); await cards(badAdmin.render())[0].props.onSave('c1','OPEN','Retry');
assert.match(text(badAdmin.render()),/Could not update/);
console.log('PASS mocked list, submission and update error feedback; failed submission retains draft');
let saved;
const editor=harness('ADMIN',api,'ComplaintCard',{complaint:records[0],isAdmin:true,saving:false,busy:false,onSave:(...args)=>{saved=args;}});
tree=editor.render(); find(tree,'select').props.onChange({target:{value:'IN_PROGRESS'}});
tree=editor.render(); find(tree,'textarea').props.onChange({target:{value:'Investigating pickup timing'}});
find(editor.render(),'button').props.onClick();
assert.deepEqual(saved,['c1','IN_PROGRESS','Investigating pickup timing']);
const savingEditor=harness('ADMIN',api,'ComplaintCard',{complaint:records[0],isAdmin:true,saving:true,busy:true}).render();
assert.equal(find(savingEditor,'button').props.disabled,true);
assert.match(text(savingEditor),/Updating/);
console.log('PASS mocked admin response editor, selected status and update loading state');

const liveProps={complaint:{...records[0], adminResponse:'Existing response'},isAdmin:true,saving:false,busy:false,onSave:(...args)=>{saved=args;}};
const liveEditor=harness('ADMIN',api,'ComplaintCard',liveProps);
liveEditor.render(); tree=liveEditor.render();
assert.equal(find(tree,'button').props.disabled,true);
find(tree,'select').props.onChange({target:{value:'OPEN'}});
await find(liveEditor.render(),'button').props.onClick();
assert.equal(saved[2],undefined, 'Status-only save must omit unchanged response');
find(liveEditor.render(),'textarea').props.onChange({target:{value:'Unsaved local draft'}});
liveProps.complaint={...liveProps.complaint,status:'REJECTED',adminResponse:'Another admin response'};
liveEditor.render();
assert.equal(find(liveEditor.render(),'textarea').props.value,'Unsaved local draft');
console.log('PASS socket updates preserve dirty response; status-only save omits existing response; unchanged editor is disabled');
const layout=readFileSync(new URL('../src/components/Layout.jsx',import.meta.url),'utf8');
const nav=new Function(`${layout.slice(layout.indexOf('const nav ='),layout.indexOf('// ======================================================'))}; return nav;`)();
for(const role of ['ADMIN','STUDENT','PARENT','DRIVER','STAFF']) {
 const paths=nav.filter(item=>item[3].includes(role)).map(item=>item[0]);
 assert.equal(new Set(paths).size,paths.length,`${role} navigation contains duplicate routes`);
}
assert.equal((layout.match(/allowedNav\.map/g)||[]).length,1);
assert.match(layout,/logout/);
console.log('PASS sidebar route uniqueness for every role, single navigation render and logout retained');
