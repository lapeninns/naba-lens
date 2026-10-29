import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffMedia, validateMedia } from '../../lib/media/index';
test('rejects disguised and unsupported bytes',()=>{for(const data of ['<html>','<svg/>','MZ executable',''])assert.equal(sniffMedia(Buffer.from(data)),null);});
test('size-only cannot approve content',async()=>{assert.equal((await validateMedia({size:100,declaredMime:'image/jpeg',filename:'x.jpg'})).ok,false);});
test('rejects oversized before decoding',async()=>{assert.deepEqual(await validateMedia({size:201*1024*1024,declaredMime:'video/mp4',filename:'x.mp4'}),{ok:false,error:'file_too_large'});});
