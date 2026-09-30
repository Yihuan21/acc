import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");

test("all interactive forms have submit handlers",()=>{
  const ids=[...html.matchAll(/<form[^>]+id="([^"]+)"/g)].map(m=>m[1]);
  for(const id of ids) assert.ok(app.includes('$("#'+id+'").onsubmit='),id);
});

test("all interactive control ids have handlers",()=>{
  const ids=["refreshBtn","simPrev","simNext","simStep5","simStep20","simPlay","simJumpBtn","simReset","clearCsvBtn","exportBtn","importAccount","resetBtn"];
  for(const id of ids) assert.ok(app.includes('$("#'+id+'").onclick=')||app.includes('$("#'+id+'").onchange='),id);
});

test("navigation and chart controls are wired",()=>{
  assert.ok(app.includes('$$("[data-go]")'));
  assert.ok(app.includes('$$("[data-range]")'));
  assert.ok(app.includes('$$("[data-kline-mode]")'));
  assert.ok(app.includes('$$("[data-symbol]")'));
});
