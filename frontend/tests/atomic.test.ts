import assert from "node:assert/strict";
import test from "node:test";
import { formatAtomic, parseAtomic } from "../src/lib/atomic.ts";

test("parses decimal token input without floating point", () => {
  assert.equal(parseAtomic("12.500001", 6), "12500001");
  assert.equal(parseAtomic("0.000001", 6), "1");
  assert.throws(() => parseAtomic("1.0000001", 6));
  assert.throws(() => parseAtomic("0", 6));
});

test("formats atomic token amounts exactly", () => {
  assert.equal(formatAtomic("12500001", 6), "12.500001");
  assert.equal(formatAtomic("1000000", 6), "1");
  assert.equal(formatAtomic("1234567890000000000000000", 24), "1.23456789");
});
