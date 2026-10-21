import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedListItemNumber, orderedListStart } from './list-numbering.js';

test('ordered lists default to one when no start is defined', () => {
  assert.equal(orderedListStart(null), 1);
});

test('ordered lists preserve a start value of zero', () => {
  assert.equal(orderedListStart('0'), 0);
});

test('invalid ordered-list starts fall back to one', () => {
  assert.equal(orderedListStart('not-a-number'), 1);
});

test('ordered list items inherit the next number when no value is set', () => {
  assert.equal(orderedListItemNumber(null, 7), 7);
});

test('ordered list items preserve an explicit value of zero', () => {
  assert.equal(orderedListItemNumber('0', 7), 0);
});

test('invalid ordered list item values fall back to the next number', () => {
  assert.equal(orderedListItemNumber('invalid', 7), 7);
});

test('invalid partially numeric list starts fall back to one', () => {
  assert.equal(orderedListStart('3abc'), 1);
  assert.equal(orderedListStart('2.5'), 1);
});

test('invalid partially numeric item values fall back to the next number', () => {
  assert.equal(orderedListItemNumber('3abc', 7), 7);
  assert.equal(orderedListItemNumber('2.5', 7), 7);
});

test('ordered list numbers allow surrounding whitespace and signed integers', () => {
  assert.equal(orderedListStart('  -2  '), -2);
  assert.equal(orderedListItemNumber(' +4 ', 7), 4);
});

test('unsafe integers fall back instead of losing precision', () => {
  assert.equal(orderedListStart('9007199254740992'), 1);
  assert.equal(orderedListItemNumber('9007199254740992', 7), 7);
});
