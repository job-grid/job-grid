import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseValidationArgs, validateOverrideManifest } from "../scripts/geonames-japan-parent-override-validation.mjs";
const manifest=JSON.parse(await readFile(new URL("../docs/geonames-japan-parent-overrides-2026-10-12.json",import.meta.url),"utf8"));
test("the manifest contains exactly two source-backed Japan parent paths and zero operational links",()=>{
 const rows=validateOverrideManifest(manifest);
 assert.deepEqual(rows.map(x=>x.geonames_id).sort(),["1850471","1850496"]);
 assert.equal(rows.every(x=>x.raw_admin1_code_preserved==="00"&&x.operational_parent_link_created===false),true);
 assert.equal(manifest.decision_boundary.operational_parent_links_created,0);
});
test("a changed parent ID fails closed",()=>{
 const copy=structuredClone(manifest);copy.approved_records[0].parent_geonames_id="12345";
 assert.throws(()=>validateOverrideManifest(copy),/Pinned target-parent-grandparent tuple changed/);
});
test("a rewritten raw administrative code fails closed",()=>{
 const copy=structuredClone(manifest);copy.approved_records[0].raw_admin1_code_preserved="29";
 assert.throws(()=>validateOverrideManifest(copy),/identity\/raw-code invariant failed/);
});

test("CLI parser preserves the required output prefix argument",()=>{
 const args=["JP.txt","source.json","targets.json","spatial.json","details.json","expansion.json","hierarchy.json","mlit.json","overrides.json","output-prefix"];
 const parsed=parseValidationArgs(args);
 assert.equal(parsed.jpPath,"JP.txt");
 assert.deepEqual(parsed.jsonPaths,args.slice(1,9));
 assert.equal(parsed.outputPrefix,"output-prefix");
 assert.throws(()=>parseValidationArgs(args.slice(0,9)),/Expected nine source paths and output prefix/);
});
