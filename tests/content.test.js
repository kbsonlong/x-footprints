const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('fallback, enrichment, SPA navigation and unrelated route', () => {
  const messages = [], callbacks = [], timers = [];
  const location = {pathname:'/alice/status/1',origin:'https://x.com',href:'https://x.com/alice/status/1'};
  let activeId = '1';
  const article = { querySelector: s => s.includes('tweetText') ? {innerText:`post ${activeId}`} : {innerText:'author'} };
  const doc = {title:'Page title',querySelectorAll: () => [{closest: s => s === 'a[href]' ? {href:`https://x.com/alice/status/${activeId}`} : article}]};
  const context = {location, document:doc, URL, Date, JSON, setTimeout: fn => {timers.push(fn);return timers.length;}, clearTimeout:()=>{}, setInterval: fn=>{callbacks.push(fn)}, addEventListener:()=>{}, MutationObserver: class {constructor(fn){callbacks.push(fn)} observe(){}}, browser:{runtime:{sendMessage: async m => {messages.push(m);}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/content.js'),'utf8'),context);
  assert.equal(messages[0].record.id,'1'); assert.equal(messages[0].record.text,undefined);
  timers.shift()(); assert.equal(messages[1].record.text,'post 1'); assert.equal(messages[1].record.title,'Page title');
  activeId='2'; location.pathname='/alice/status/2'; location.href='https://x.com/alice/status/2'; callbacks[0]();
  assert.equal(messages.at(-1).record.id,'2'); timers.shift()(); assert.equal(messages.at(-1).record.text,'post 2');
  const count=messages.length; location.pathname='/home'; callbacks[0](); assert.equal(messages.length,count);
});
