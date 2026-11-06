import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiptElapsedMs} from '../src/execution-timing.js';
test('actual host elapsed time takes precedence including genuine zero',()=>{assert.equal(receiptElapsedMs({host:{elapsed_ms:0}}),0);assert.equal(receiptElapsedMs({host:{elapsed_ms:2300},started_at:'invalid'}),2300);});
test('Linux receipts use their actual canonical run timestamps when host timing is absent',()=>{assert.equal(receiptElapsedMs({host:{},started_at:'2026-11-06T00:00:00.000Z',finished_at:'2026-11-06T00:00:01.500Z'}),1500);});
test('missing, reversed, invalid or noncanonical timestamps remain unknown',()=>{for(const receipt of [{},{host:{elapsed_ms:NaN}},{host:{elapsed_ms:-1}},{started_at:'5',finished_at:'6'},{started_at:'2026-11-06T00:00:00.000Z',finished_at:'2026-11-05T00:00:00.000Z'},{started_at:'2026-02-30T00:00:00.000Z',finished_at:'2026-03-03T00:00:00.000Z'}])assert.equal(receiptElapsedMs(receipt),null);});
