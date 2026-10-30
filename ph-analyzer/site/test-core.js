// ph-core.js 가 Python ph_core.py 와 같은 결과를 내는지 비교. 사용법: node test-core.js fixtures.json
const fs = require("fs");
const core = require("./ph-core.js");
const fx = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let worst = 0, fails = 0;
const close = (a, b, tol, what) => {
  const d = Math.abs(a - b);
  worst = Math.max(worst, d);
  if (!(d <= tol)) { fails++; console.log("FAIL", what, a, b); }
};
fx.pairs.forEach((p, i) => close(core.deltaE2000(p[0], p[1]), fx.de[i], 1e-9, "deltaE2000 " + i));
fx.cases.forEach((c, i) => {
  const data = new Uint8ClampedArray(c.w * c.h * 4);
  for (let k = 0; k < c.w * c.h; k++) {
    data[k * 4] = c.rgb[k * 3]; data[k * 4 + 1] = c.rgb[k * 3 + 1]; data[k * 4 + 2] = c.rgb[k * 3 + 2]; data[k * 4 + 3] = 255;
  }
  const js = core.extractColor({ width: c.w, height: c.h, data }, c.roi, c.ref);
  ["L", "a", "b", "uniformity", "glare_ratio"].forEach(k => close(js[k], c.py[k], 1e-6, `case ${i} ${k}`));
  if (js.hex !== c.py.hex) { fails++; console.log("FAIL hex", i, js.hex, c.py.hex); }
});
const rows = fx.rows.map(r => ({ ...r, name: r.image_path }));
["curve", "knn"].forEach(m => fx.queries.forEach((q, i) => {
  const js = core.predictPh(q[0], q[1], q[2], rows, m), py = fx.preds[m][i];
  close(js.ph, py.ph, 1e-9, `${m} pred ${i}`);
  close(js.distance, py.distance, 1e-9, `${m} dist ${i}`);
  close(js.nearest_ph, py.nearest_ph, 0, `${m} nearest ${i}`);
  if (js.confidence !== py.confidence || js.out_of_range !== py.out_of_range) { fails++; console.log("FAIL conf/range", m, i); }
}));
Object.entries(fx.cv).forEach(([k, py]) => {
  const [m, l] = k.split("_");
  const js = core.crossValidate(rows, m, l);
  close(js.mae, py.mae, 1e-9, k + " mae");
  close(js.max_err, py.max_err, 1e-9, k + " max");
  close(js.n, py.n, 0, k + " n");
});
console.log(fails ? `${fails} FAIL` : `JS = Python 일치 (최대 차이 ${worst.toExponential(2)})`);
process.exit(fails ? 1 : 0);
