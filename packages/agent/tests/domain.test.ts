import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hostOf,
  isIpHost,
  registrableDomain,
  registrableDomainFromHost,
} from '../src/util/domain.js';

test('a bare domain is its own registrable domain', () => {
  assert.equal(registrableDomain('https://veloura-outdoor.example'), 'veloura-outdoor.example');
  assert.equal(registrableDomain('https://example.com'), 'example.com');
});

test('subdomains collapse to the registrable domain', () => {
  assert.equal(registrableDomain('https://shop.veloura-outdoor.example/cart'), 'veloura-outdoor.example');
  assert.equal(registrableDomain('http://a.b.c.example.com'), 'example.com');
});

test('multi-part public suffixes are handled', () => {
  assert.equal(registrableDomain('https://shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('https://www.example.co.in'), 'example.co.in');
  assert.equal(registrableDomain('https://a.example.com.au'), 'example.com.au');
});

test('ports and mixed case are stripped', () => {
  assert.equal(hostOf('https://Shop.Veloura-Outdoor.Example:8443/x'), 'shop.veloura-outdoor.example');
  assert.equal(registrableDomain('HTTPS://SHOP.VELOURA-OUTDOOR.EXAMPLE'), 'veloura-outdoor.example');
});

test('an address without a protocol is still parsed', () => {
  assert.equal(hostOf('no-protocol.example/path'), 'no-protocol.example');
  assert.equal(registrableDomain('no-protocol.example/path'), 'no-protocol.example');
});

test('IP hosts and single labels are left alone', () => {
  assert.equal(isIpHost('127.0.0.1'), true);
  assert.equal(isIpHost('example.com'), false);
  assert.equal(registrableDomainFromHost('127.0.0.1'), '127.0.0.1');
  assert.equal(registrableDomainFromHost('localhost'), 'localhost');
});

test('empty and malformed input returns an empty string instead of throwing', () => {
  assert.equal(hostOf(''), '');
  assert.equal(registrableDomain(''), '');
  assert.equal(registrableDomainFromHost(''), '');
});
