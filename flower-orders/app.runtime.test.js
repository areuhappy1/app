const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const parser = require('./parser');
const tools = require('./order-tools');
const source = fs.readFileSync(require.resolve('./app.js'), 'utf8');
const flush = async () => { for (let i=0;i<8;i++) await new Promise(setImmediate); };
function harness({ remote=false, permission='granted', support=true }={}) {
  const nodes = new Map(), notices=[], intervals=[], storage=new Map();
  let permissionCalls=0, focused=false;
  class Element {
    constructor(){this.listeners={};this.dataset={};this.children=[];this.value='';this.open=false;this.classList={toggle(){}};}
    addEventListener(type, fn){this.listeners[type]=fn;}
    querySelector(){return new Element();}
    querySelectorAll(){return [];}
    appendChild(e){this.children.push(e);}
    remove(){}
    scrollIntoView(){focused=true;}
    focus(){focused=true;}
    showModal(){this.open=true;}
    close(){this.open=false;this.listeners.close?.();}
  }
  const get=(key)=>{if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
  const d=new Date(Date.now()+86400000), date=parser.ymd(d);
  const order={id:'order-1',customer:'검수',region:'서울 강남구',date,time:'15:00',product:'꽃다발',status:'new'};
  storage.set('flower-orders.v1',JSON.stringify([order]));
  storage.set('flower-orders.settings.v1',JSON.stringify({notifications:true}));
  if(remote)storage.set('flower-orders.server-key',JSON.stringify('test-only-key'));
  const document={title:'꽃 주문함',visibilityState:'visible',querySelector:get,querySelectorAll:()=>[],addEventListener(){},createElement:()=>new Element()};
  const Notification={permission,requestPermission:async()=>{permissionCalls++;return permission;}};
  const window={addEventListener(){},scrollTo(){},...(support?{Notification}:{})};
  const registration={active:true,showNotification:async(...args)=>{notices.push(args);}};
  const context={document,window,Notification,FlowerParser:parser,FlowerOrderTools:tools,Date,URL,URLSearchParams,Map,Set,console,
    localStorage:{getItem:(k)=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    location:{href:'https://example.test/flower-orders/',pathname:'/flower-orders/',search:'',hash:'',protocol:'https:'},
    history:{replaceState(){}},navigator:{serviceWorker:{getRegistration:async()=>registration,register:async()=>registration}},
    setInterval:(f)=>intervals.push(f),setTimeout:()=>0,clearTimeout(){},
    fetch:async(url)=>({ok:true,status:200,json:async()=>url.endsWith('/orders')?{orders:[]}:{messages:[{id:1,sender:'검수고객',source:'sms',body:'내일 오후 3시 꽃다발 5만원 배송 주소: 서울 강남구 역삼동 123',received_at:new Date().toISOString()}]}}),
  };
  vm.runInNewContext(source,context);
  return {nodes,get,notices,intervals,storage,context,permissionCalls:()=>permissionCalls,focused:()=>focused,
    clickAlert:(action)=>get('.reminder-panel').listeners.click({target:{closest:()=>({dataset:{alert:'0',action}})}})};
}
test('notifications send once, contain no customer details, and target the saved order',async()=>{
  const h=harness();await flush();
  assert.equal(h.notices.length,1);
  assert.equal(h.permissionCalls(),0);
  assert.ok(h.notices[0][1].data.url.endsWith('#order=order-1'));
  assert.ok(!h.notices[0][1].body.includes('검수'));
  h.intervals[0]();await flush();assert.equal(h.notices.length,1);
});
test('denied and unsupported notifications retain in-app reminders without prompting',async()=>{
  for(const config of [{permission:'denied'},{support:false}]){
    const h=harness(config);await flush();
    assert.equal(h.notices.length,0);assert.equal(h.permissionCalls(),0);
    assert.ok(h.get('#reminder-list').innerHTML.includes('검수'));
  }
});
test('incoming message alert opens the matching inbox form',async()=>{
  const h=harness({remote:true});await flush();
  assert.ok(h.get('#reminder-list').innerHTML.includes('새 주문 메시지'));
  const forms=h.get('#inbox-list').children;
  assert.equal(forms.length,1);
  h.context.document.querySelectorAll=(s)=>s==='#inbox-list form'?forms:[];
  h.clickAlert('open');assert.equal(h.focused(),true);
  assert.ok(h.notices.some(([,o])=>o.data.url.endsWith('#inbox')));
});
test('acknowledge preserves the order and snooze stores a future deadline',async()=>{
  const h=harness();await flush();
  h.clickAlert('snooze');
  assert.ok(h.get('#reminder-list').innerHTML.includes('새로 확인할 알림이 없어요'));
  assert.equal(JSON.parse(h.storage.get('flower-orders.v1')).length,1);
  const states=JSON.parse(h.storage.get('flower-orders.alerts.v1.local'));
  assert.ok(Object.values(states)[0].until>Date.now());
  h.clickAlert('restore');h.clickAlert('ack');
  assert.ok(h.get('#reminder-history').innerHTML.includes('주문은 아직 미완료'));
});
