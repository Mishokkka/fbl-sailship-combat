import test from "node:test";
import assert from "node:assert/strict";
import "./test-env.js";
import { attackGeometry, captureAttackVisual, normalizeAttackVisual } from "../scripts/visuals/attack-visuals.js";
import { cellToPixel } from "../scripts/board/board-geometry.js";
import { BattleReportService } from "../scripts/services/battle-report-service.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, a+" != "+b);
test("Gun and creature origins preserve bow/stern/port/starboard across all headings", () => {
  for (const heading of [0,60,120,180,240,300]) for (const unitType of ["ship","creature"]) {
    const source={id:"a",x:5,y:5,heading,unitType,stats:{sm:6}}, target={id:"b",x:8,y:8,heading:180};
    const battle={board:{cellSize:48},ships:[source,target]};
    const a=cellToPixel(battle.board,5,5), before=structuredClone(battle);
    for(const [arc,angle] of [["bow",heading-90],["stern",heading+90],["port",heading-180],["starboard",heading]]) {
      const visual=captureAttackVisual(source,target,{arc,type:unitType==="ship"?"cannon":"breath"});
      const geometry=attackGeometry(battle,{visual,sourceId:"a",targetId:"b",outcome:"hit"});
      const dx=geometry.start.x-a.cx,dy=geometry.start.y-a.cy,distance=Math.hypot(dx,dy);
      near(dx/distance,Math.cos(angle*Math.PI/180)); near(dy/distance,Math.sin(angle*Math.PI/180));
    }
    assert.deepEqual(battle,before);
  }
});
test("Hit section follows target direction; misses end clear of target and have no hit cue", () => {
  const a={id:"a",x:4,y:4,heading:60},b={id:"b",x:8,y:4,heading:180,stats:{sm:9}};
  const battle={board:{cellSize:48},ships:[a,b]},center=cellToPixel(battle.board,b.x,b.y);
  const visual={...captureAttackVisual(a,b),section:"bow"};
  const report={sourceId:"a",targetId:"b",outcome:"hit",visual};
  const hit=attackGeometry(battle,report);
  near(hit.end.x,center.cx); assert.ok(hit.end.y>center.cy);
  const miss=attackGeometry(battle,{...report,outcome:"miss"});
  assert.equal(miss.hit,false);
  assert.ok(Math.hypot(miss.end.x-center.cx,miss.end.y-center.cy)>50);
  assert.equal(attackGeometry(battle,{...report,outcome:"prepared"}),null);
  b.contactState="lost"; assert.equal(attackGeometry(battle,report),null);
});
test("Visuals survive normalization but hidden and lost participants cannot leak through report projection", () => {
  const battle=BattleNormalizer.normalize(createDefaultBattle()),[a,b]=battle.ships;
  const report=BattleReportService.record(battle,BattleReportService.capture(battle),{
    sourceId:a.id,targetId:b.id,outcome:"hit",visual:{...captureAttackVisual(a,b),section:"stern"} });
  assert.deepEqual(BattleNormalizer.normalize(battle).lastReport.visual,report.visual);
  assert.equal(BattleReportService.project(report,new Set([a.id]),[a]).visual,null);
  assert.equal(BattleReportService.project(report,new Set([a.id]),[a,{...b,contactState:"lost"}]).visual,null);
  const projected=BattleReportService.project(report,new Set([a.id]),[a,{...b,x:99,heading:240,contactState:"detected"}]);
  assert.equal(projected.visual.section,"");
  assert.equal(projected.visual.target.x,99);
  assert.equal(projected.visual.target.heading,240);
  assert.equal(BattleReportService.project(report,new Set([b.id]),[a,b]).visual.section,"stern");
  assert.equal(BattleReportService.normalize({...report,outcome:"prepared"},battle).visual,undefined);
  assert.equal(normalizeAttackVisual({...report.visual,source:{x:NaN,y:0,heading:0}}),null);
  assert.equal(normalizeAttackVisual({...report.visual,type:"<script>"}),null);
});

test("Co-located all-around misses still end beside the target", () => {
  const a={id:"a",x:4,y:4,heading:60},b={id:"b",x:4,y:4,heading:0};
  const battle={board:{cellSize:48},ships:[a,b]},center=cellToPixel(battle.board,4,4);
  const visual=captureAttackVisual(a,b,{arc:"all",type:"natural"});
  const result=attackGeometry(battle,{sourceId:"a",targetId:"b",outcome:"miss",visual});
  assert.ok(Math.hypot(result.end.x-center.cx,result.end.y-center.cy)>40);
});
