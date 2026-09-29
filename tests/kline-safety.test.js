import assert from "node:assert/strict";
import {visibleKLine, hasFutureKLine, enrichDailyKLine} from "../kline.js";

const rows=[
  {date:"2020-01-01",open:10,high:11,low:9,close:10.5,volume:100},
  {date:"2021-01-01",open:20,high:21,low:19,close:20.5,volume:200}
];

assert.equal(visibleKLine(rows,"2020-01-01").length,1);
assert.equal(hasFutureKLine(rows,"2020-01-01"),true);
assert.equal(enrichDailyKLine(rows)[1].close,20.5);

console.log("kline safety tests passed");
