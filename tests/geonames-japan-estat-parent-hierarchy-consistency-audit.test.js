import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyParentHierarchyConsistency,
  exactJapaneseMatchFields,
} from "../scripts/geonames-japan-estat-parent-hierarchy-consistency-audit.mjs";

const shigaAdmin1 = {
  geonames_id: "1852553",
  name: "Shiga",
  ascii_name: "Shiga",
  admin1_code: "35",
  exact_match_fields: ["exact_alternate_name_entry"],
};
const hiroshimaAdmin1 = {
  geonames_id: "1862413",
  name: "Hiroshima-ken",
  ascii_name: "Hiroshima-ken",
  admin1_code: "11",
  exact_match_fields: ["exact_alternate_name_entry"],
};
const kochiAdmin1 = {
  geonames_id: "1859133",
  name: "Kochi Prefecture",
  ascii_name: "Kochi Prefecture",
  admin1_code: "20",
  exact_match_fields: ["exact_alternate_name_entry"],
};

test("Japanese-label candidate discovery uses exact NFC-normalized whole fields only", () => {
  const record = {
    name: "Shiga",
    ascii_name: "Shiga",
    alternate_names: ["滋賀県", "滋賀"],
  };
  assert.deepEqual(exactJapaneseMatchFields(record, "滋賀県"), ["exact_alternate_name_entry"]);
  assert.deepEqual(exactJapaneseMatchFields(record, " 滋賀 "), ["exact_alternate_name_entry"]);
  assert.deepEqual(exactJapaneseMatchFields(record, "滋賀県知事"), []);
  assert.deepEqual(
    exactJapaneseMatchFields({ name: "県", ascii_name: "prefecture", alternate_names: [] }, "滋賀県"),
    [],
  );
});

test("Echi-gun candidate in GeoNames admin1 code 35 is coherent with a Shiga e-Stat grandparent candidate", () => {
  const result = classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "35",
    grandparentReferences: [{ area_code: "25000", uri: "urn:shiga", label_en: "Shiga-ken", label_ja: "滋賀県" }],
    adm1Matches: [shigaAdmin1],
  });
  assert.equal(result.status, "ADMIN1_CODE_COHERENT_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE");
  assert.deepEqual(result.coherentIds, ["1852553"]);
});

test("the Aichi-gun namesake candidate conflicts with the same Shiga e-Stat grandparent context", () => {
  const result = classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "01",
    grandparentReferences: [{ area_code: "25000", uri: "urn:shiga", label_en: "Shiga-ken", label_ja: "滋賀県" }],
    adm1Matches: [shigaAdmin1],
  });
  assert.equal(result.status, "ADMIN1_CODE_CONFLICTS_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE");
  assert.deepEqual(result.coherentIds, []);
});

test("Hiroshima Aki-gun is code-coherent with Hiroshima and not with Kochi", () => {
  const coherent = classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "11",
    grandparentReferences: [{ area_code: "34000", uri: "urn:hiroshima", label_en: "Hiroshima-ken", label_ja: "広島県" }],
    adm1Matches: [hiroshimaAdmin1],
  });
  const conflicting = classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "20",
    grandparentReferences: [{ area_code: "34000", uri: "urn:hiroshima", label_en: "Hiroshima-ken", label_ja: "広島県" }],
    adm1Matches: [hiroshimaAdmin1],
  });
  assert.equal(coherent.status, "ADMIN1_CODE_COHERENT_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE");
  assert.equal(conflicting.status, "ADMIN1_CODE_CONFLICTS_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE");
});

test("Kochi Aki-gun is code-coherent with Kochi, not with Hiroshima", () => {
  const coherent = classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "20",
    grandparentReferences: [{ area_code: "39000", uri: "urn:kochi", label_en: "Kochi-ken", label_ja: "高知県" }],
    adm1Matches: [kochiAdmin1],
  });
  const conflicting = classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "11",
    grandparentReferences: [{ area_code: "39000", uri: "urn:kochi", label_en: "Kochi-ken", label_ja: "高知県" }],
    adm1Matches: [kochiAdmin1],
  });
  assert.equal(coherent.status, "ADMIN1_CODE_COHERENT_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE");
  assert.equal(conflicting.status, "ADMIN1_CODE_CONFLICTS_WITH_UNIQUE_ESTAT_GRANDPARENT_LABEL_CANDIDATE");
});

test("multiple official grandparent references remain unresolved", () => {
  const result = classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "35",
    grandparentReferences: [
      { area_code: "25000", uri: "urn:shiga", label_en: "Shiga-ken", label_ja: "滋賀県" },
      { area_code: "23000", uri: "urn:aichi", label_en: "Aichi-ken", label_ja: "愛知県" },
    ],
    adm1Matches: [shigaAdmin1],
  });
  assert.equal(result.status, "MULTIPLE_ESTAT_GRANDPARENT_REFERENCES_REQUIRE_REVIEW");
  assert.deepEqual(result.coherentIds, []);
});

test("a matching code among multiple ADM1 label candidates is a non-exclusive consistency signal", () => {
  const result = classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "35",
    grandparentReferences: [{ area_code: "25000", uri: "urn:shiga", label_en: "Shiga-ken", label_ja: "滋賀県" }],
    adm1Matches: [shigaAdmin1, { ...shigaAdmin1, geonames_id: "9999999", admin1_code: "99" }],
  });
  assert.equal(result.status, "ADMIN1_CODE_COHERENT_WITH_ONE_OF_MULTIPLE_ESTAT_GRANDPARENT_LABEL_CANDIDATES");
  assert.deepEqual(result.coherentIds, ["1852553"]);
});

test("missing matches and non-ADM2 candidates cannot be promoted by this audit", () => {
  assert.equal(classifyParentHierarchyConsistency({
    featureCode: "ADM2",
    admin1Code: "35",
    grandparentReferences: [{ area_code: "25000", uri: "urn:shiga", label_en: "Shiga-ken", label_ja: "滋賀県" }],
    adm1Matches: [],
  }).status, "NO_EXACT_GEONAMES_ADM1_CANDIDATE_FOR_ESTAT_GRANDPARENT_LABEL");
  assert.equal(classifyParentHierarchyConsistency({
    featureCode: "ADM1",
    admin1Code: "35",
    grandparentReferences: [],
    adm1Matches: [],
  }).status, "NOT_APPLICABLE_ADM1_CANDIDATE_NO_PARENT_NAMESPACE_CHECK");
});
