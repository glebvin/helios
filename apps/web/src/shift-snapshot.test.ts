import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readShiftSnapshot, saveShiftSnapshot, clearShiftSnapshot} from './shift-snapshot.ts';

test('denied snapshot storage never prevents reading a live server day or local logout', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{setItem(){throw new DOMException('full','QuotaExceededError');},getItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}}});
  try {
    assert.equal(saveShiftSnapshot({tenantId:'t',userId:'u'} as never), false);
    assert.equal(readShiftSnapshot('t','u'), null);
    assert.doesNotThrow(()=>clearShiftSnapshot('t','u'));
  } finally {if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('malformed or foreign snapshot is ignored instead of crashing a cold start', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let raw='';Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>raw}});
  try {
    for(const value of [{tenantId:'t',userId:'u'}, {tenantId:'foreign',userId:'u'}, {tenantId:'t',userId:'u',projectId:'p',projectName:'P',employeeId:'e',day:'2026-11-13',fetchedAt:new Date().toISOString(),reading:{},shifts:{kind:'one'},tasks:[]}]) {
      raw=JSON.stringify(value);assert.equal(readShiftSnapshot('t','u'),null);
    }
    raw='broken JSON';assert.equal(readShiftSnapshot('t','u'),null);
  } finally {if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');}
});
