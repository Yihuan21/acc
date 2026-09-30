import test from "node:test";
import assert from "node:assert/strict";
import {DataAPI} from "../data.js";

test("Yahoo history keeps raw OHLC and adjusted close separate", async ()=>{
  const api=new DataAPI();
  api.request=async()=>({chart:{result:[{
    timestamp:[1704067200,1704153600],
    indicators:{
      quote:[{open:[100,50],high:[110,55],low:[90,45],close:[100,50],volume:[1000,900]}],
      adjclose:[{adjclose:[80,40]}]
    }
  }]}});
  const rows=await api.history("TEST","2024-01-01","2024-01-02");
  assert.equal(rows[0].close,100);
  assert.equal(rows[0].adjClose,80);
  assert.equal(rows[0].adjOpen,80);
  assert.equal(rows[0].adjHigh,88);
  assert.equal(rows[0].adjLow,72);
});

test("fund history remains NAV data without fake OHLC variation", async ()=>{
  const api=new DataAPI();
  api.request=async()=>({Data:{LSJZList:[
    {FSRQ:"2024-01-02",DWJZ:"1.01"},
    {FSRQ:"2024-01-01",DWJZ:"1.00"}
  ]}});
  const rows=await api.fundHistory("000001","2024-01-01","2024-01-02");
  assert.equal(rows.length,2);
  assert.equal(rows[0].open,rows[0].close);
  assert.equal(rows[0].high,rows[0].close);
  assert.equal(rows[0].low,rows[0].close);
});

test("Yahoo history repairs missing OHLC fields without creating impossible candles", async ()=>{
  const api=new DataAPI();
  api.request=async()=>({chart:{result:[{
    timestamp:[1704067200,1704153600],
    indicators:{quote:[{open:[null,null],high:[null,null],low:[null,null],close:[100,101],volume:[100,100]}]}
  }]}});
  const rows=await api.history("TEST","2024-01-01","2024-01-02");
  assert.equal(rows[0].open,100);
  assert.equal(rows[0].high,100);
  assert.equal(rows[0].low,100);
});
