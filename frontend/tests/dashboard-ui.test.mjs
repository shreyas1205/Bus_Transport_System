import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {transformSync, types as t} from '@babel/core';
import {parse} from '@babel/parser';
import postcss from 'postcss';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const sourceRoot = new URL('../src/', import.meta.url);
function checkSyntax(directory) {
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    const url = new URL(entry.name + (entry.isDirectory()?'/':''), directory);
    if (entry.isDirectory()) checkSyntax(url);
    else if (/\.(jsx?|css)$/.test(entry.name)) {
      const source = readFileSync(url,'utf8');
      if (entry.name.endsWith('.css')) postcss.parse(source, {from:url.pathname});
      else parse(source, {sourceType:'module', plugins:['jsx']});
    }
  }
}
checkSyntax(sourceRoot);
console.log('PASS syntax parsing for all active frontend JavaScript, JSX and CSS');

const source = readFileSync(new URL('pages/Dashboard.jsx',sourceRoot),'utf8');
const ast = parse(source, {sourceType:'module',plugins:['jsx']});
const component = ast.program.body.find(n=>t.isExportNamedDeclaration(n)&&n.declaration?.id?.name==='RouteOverview').declaration;
const code = transformSync(source.slice(component.start,component.end), {
  configFile:false, babelrc:false, parserOpts:{plugins:['jsx']},
  plugins:[()=>({visitor:{
    JSXElement:{exit(p) {
      const n=p.node;
      const props=n.openingElement.attributes.map(a=>t.objectProperty(t.stringLiteral(a.name.name),
        !a.value?t.booleanLiteral(true):t.isJSXExpressionContainer(a.value)?a.value.expression:a.value));
      p.replaceWith(t.callExpression(t.memberExpression(t.identifier('React'),t.identifier('createElement')),
        [t.stringLiteral(n.openingElement.name.name),t.objectExpression(props),...children(n.children)]));
    }},
    JSXFragment:{exit(p) {
      p.replaceWith(t.callExpression(t.memberExpression(t.identifier('React'),t.identifier('createElement')),
        [t.memberExpression(t.identifier('React'),t.identifier('Fragment')),t.nullLiteral(),...children(p.node.children)]));
    }}
  }})]
}).code;
function children(nodes) {
  return nodes.flatMap(n=>t.isJSXText(n)?(n.value.trim()||!n.value.includes('\n')?[t.stringLiteral(n.value)]:[]):
    t.isJSXExpressionContainer(n)?(t.isJSXEmptyExpression(n.expression)?[]:[n.expression]):[n]);
}
const RouteOverview=new Function('React',`${code}; return RouteOverview;`)(React);
const render=route=>renderToStaticMarkup(React.createElement(RouteOverview,{route}));
const route={id:'demo',code:'HOD-DEMO-R1',name:'Main campus shuttle',assignedBus:{registrationNo:'KA-01-AB-1234'},assignedDriver:{name:'Ananya Rao'}};
let html=render({...route,eta:[{etaMinutes:null},{etaMinutes:18},{etaMinutes:3.2}]});
assert.match(html,/>HOD-DEMO-R1<\/span>/);
assert.match(html,/<dt>Bus<\/dt><dd>KA-01-AB-1234<\/dd>/);
assert.match(html,/<dt>Driver<\/dt><dd>Ananya Rao<\/dd>/);
assert.match(html,/>4 <small>min<\/small>/);
assert.match(render({...route,eta:[{etaMinutes:0},{etaMinutes:4}]}),/>Arriving</);
for(const eta of [undefined,[],[{etaMinutes:null}],[{etaMinutes:-1},{etaMinutes:NaN},{etaMinutes:Infinity},{etaMinutes:undefined}]]) {
  assert.match(render({...route,eta}),/>Unavailable</);
}
html=render({code:'LONG-ROUTE-CODE-123456789',name:'Route with a long descriptive name'});
assert.match(html,/Unassigned bus/);
assert.match(html,/Unassigned driver/);
assert.match(html,/LONG-ROUTE-CODE-123456789/);
console.log('PASS route rendering: full code, labeled assignments, nearest valid ETA, zero, rounding, unavailable and unassigned states');
