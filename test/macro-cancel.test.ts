import assert from "node:assert/strict";
import test from "node:test";
import { AppEvents } from "../src/events.js";
import { MacroBase, MacroCancelledError } from "../src/macro-base.js";

class TestMacro extends MacroBase {
  constructor() { super("test", new AppEvents(false)); }
  async run(): Promise<void> { this.begin("WAIT"); await this.wait(30); }
}

test("Take over bricht einen laufenden Makro-Wait sicher ab", async () => {
  const macro = new TestMacro();
  macro.setEnabled(true);
  const running = macro.run();
  assert.equal(macro.cancel(), true);
  await assert.rejects(running, MacroCancelledError);
  assert.equal(macro.snapshot().phase, "TAKEN_OVER");
  assert.equal(macro.snapshot().status, "waiting");
  assert.equal(macro.cancel(), false);
});
