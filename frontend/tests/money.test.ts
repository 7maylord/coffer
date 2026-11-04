import assert from "node:assert/strict";
import { test } from "node:test";
import { money, parseMoney, splitAllocation } from "../src/lib/demo.ts";

test("demo money never uses floating point or accepts ambiguous input", () => {
  assert.equal(parseMoney("100.01"), "10001");
  assert.equal(parseMoney("0.01"), "1");
  assert.equal(parseMoney("999999999.99"), "99999999999");
  assert.equal(money("10001"), "$100.01");
  assert.equal(money("999999999999999999"), "$9,999,999,999,999,999.99");
  for (const value of [
    "0",
    "-1",
    "1e3",
    "1.001",
    "NaN",
    "1,000",
    "",
    "1000000000",
    " 2",
  ])
    assert.throws(() => parseMoney(value));
  for (const value of ["-1", "1.5", "Infinity", "0000000000000000000"])
    assert.throws(() => money(value));
});
test("split preserves every cent and assigns remainder to reserves", () => {
  for (const cents of ["1", "7", "10001", "6428000", "99999999999"]) {
    const parts = splitAllocation(cents);
    assert.equal(
      parts.reduce((sum, amount) => sum + BigInt(amount), 0n),
      BigInt(cents),
    );
  }
  assert.deepEqual(splitAllocation("101"), ["50", "30", "21"]);
});
