/*
 * pH 색상 분석기 - 색 계산 / 예측 / 검증 (브라우저·Node 공용)
 * ph-analyzer/v6/ph_core.py 와 같은 계산을 한다. 바꿀 때는 둘 다 바꾸고 test-core.js 로 비교할 것.
 */
(function (root) {
  "use strict";

  var WB_TARGET = 0.5;

  // ---------------------------
  // 색 공간 변환
  // ---------------------------
  var LIN_LUT = new Float64Array(256);
  for (var i = 0; i < 256; i++) LIN_LUT[i] = srgbToLinear01(i / 255);

  function srgbToLinear01(v) {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb01(v) {
    v = Math.min(1, Math.max(0, v));
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  var WX = 0.95047, WY = 1.0, WZ = 1.08883;
  var EPS = 216 / 24389, KAPPA = 24389 / 27;

  function labF(t) {
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  }

  /** 선형 RGB → CIE Lab (D65). 1을 넘는 값도 그대로 계산. */
  function linearToLab(r, g, b) {
    var x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WX;
    var y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / WY;
    var z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / WZ;
    var fx = labF(x), fy = labF(y), fz = labF(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function deltaE76(p, q) {
    var d0 = p[0] - q[0], d1 = p[1] - q[1], d2 = p[2] - q[2];
    return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
  }

  var RAD = Math.PI / 180, P25_7 = Math.pow(25, 7);

  /** CIEDE2000 색차 */
  function deltaE2000(p, q) {
    var L1 = p[0], a1 = p[1], b1 = p[2], L2 = q[0], a2 = q[1], b2 = q[2];
    var C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    var Cm = (C1 + C2) / 2, Cm7 = Math.pow(Cm, 7);
    var G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + P25_7)));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    var h1p = ((Math.atan2(b1, a1p) / RAD) % 360 + 360) % 360;
    var h2p = ((Math.atan2(b2, a2p) / RAD) % 360 + 360) % 360;

    var dLp = L2 - L1, dCp = C2p - C1p;
    var dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    if (dhp < -180) dhp += 360;
    if (C1p * C2p === 0) dhp = 0;
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * RAD / 2);

    var Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
    var hsum = h1p + h2p, hpm;
    if (C1p * C2p === 0) hpm = hsum;
    else if (Math.abs(h1p - h2p) > 180) hpm = hsum < 360 ? (hsum + 360) / 2 : (hsum - 360) / 2;
    else hpm = hsum / 2;

    var T = 1
      - 0.17 * Math.cos((hpm - 30) * RAD)
      + 0.24 * Math.cos(2 * hpm * RAD)
      + 0.32 * Math.cos((3 * hpm + 6) * RAD)
      - 0.20 * Math.cos((4 * hpm - 63) * RAD);
    var dTheta = 30 * Math.exp(-Math.pow((hpm - 275) / 25, 2));
    var Cpm7 = Math.pow(Cpm, 7);
    var Rc = 2 * Math.sqrt(Cpm7 / (Cpm7 + P25_7));
    var Sl = 1 + (0.015 * Math.pow(Lpm - 50, 2)) / Math.sqrt(20 + Math.pow(Lpm - 50, 2));
    var Sc = 1 + 0.045 * Cpm;
    var Sh = 1 + 0.015 * Cpm * T;
    var Rt = -Math.sin(2 * dTheta * RAD) * Rc;
    var tl = dLp / Sl, tc = dCp / Sc, th = dHp / Sh;
    return Math.sqrt(tl * tl + tc * tc + th * th + Rt * tc * th);
  }

  // ---------------------------
  // 통계 도우미 (numpy.median 과 같은 짝수 개 처리)
  // ---------------------------
  function median(arr) {
    var a = Float64Array.from(arr).sort();
    var n = a.length;
    if (!n) return NaN;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  function medianCols(rows) {
    return [0, 1, 2].map(function (k) {
      return median(rows.map(function (r) { return r[k]; }));
    });
  }

  // ---------------------------
  // 색 추출
  // img: {width, height, data: RGBA Uint8ClampedArray}
  // roi: [x, y, w, h] (픽셀) / norm: [x, y, w, h] (비율)
  // ---------------------------
  function clampRoi(roi, w, h) {
    var x = Math.trunc(roi[0]), y = Math.trunc(roi[1]);
    var rw = Math.trunc(roi[2]), rh = Math.trunc(roi[3]);
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    rw = Math.max(1, Math.min(w - x, rw));
    rh = Math.max(1, Math.min(h - y, rh));
    return [x, y, rw, rh];
  }

  function normToRoi(img, norm) {
    var w = img.width, h = img.height;
    return clampRoi([Math.trunc(w * norm[0]), Math.trunc(h * norm[1]),
      Math.trunc(w * norm[2]), Math.trunc(h * norm[3])], w, h);
  }

  function roiToNorm(img, roi) {
    return [roi[0] / img.width, roi[1] / img.height, roi[2] / img.width, roi[3] / img.height];
  }

  /** ROI 안쪽(가장자리 8% 제외) 픽셀을 [[r,g,b], ...] 로 */
  function innerPixels(img, roi) {
    var r = clampRoi(roi, img.width, img.height);
    var x = r[0], y = r[1], cw = r[2], ch = r[3];
    var px = Math.max(1, Math.trunc(cw * 0.08));
    var py = Math.max(1, Math.trunc(ch * 0.08));
    if (cw > px * 2 + 4 && ch > py * 2 + 4) {
      x += px; y += py; cw -= 2 * px; ch -= 2 * py;
    }
    var out = new Array(cw * ch), k = 0, d = img.data, W = img.width;
    for (var yy = y; yy < y + ch; yy++) {
      for (var xx = x; xx < x + cw; xx++) {
        var o = (yy * W + xx) * 4;
        out[k++] = [d[o], d[o + 1], d[o + 2]];
      }
    }
    return out;
  }

  /** 반사광(포화)·너무 어두운 픽셀 제거. 남는 게 너무 적으면 전부 사용. */
  function validPixels(px) {
    var keep = [];
    for (var i = 0; i < px.length; i++) {
      var p = px[i];
      var mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2]);
      if (mx < 250 && mx > 15 && !(mn > 235 && mx - mn < 12)) keep.push(p);
    }
    var glare = 1 - keep.length / px.length;
    if (keep.length < Math.max(20, 0.2 * px.length)) return { px: px, glare: glare };
    return { px: keep, glare: glare };
  }

  function whiteBalanceGains(img, refRoi) {
    var px = validPixels(innerPixels(img, refRoi)).px;
    var lin = px.map(function (p) { return [LIN_LUT[p[0]], LIN_LUT[p[1]], LIN_LUT[p[2]]]; });
    var med = medianCols(lin);
    if (med.some(function (v) { return v < 0.01; })) {
      throw new Error("기준 카드 영역이 너무 어둡습니다. 흰색/회색 카드 부분을 다시 선택하세요.");
    }
    return med.map(function (v) { return WB_TARGET / v; });
  }

  /**
   * 시험지 영역의 대표색. refRoi 가 있으면 그 영역(흰색/회색 카드)으로 화이트밸런스 + 노출 보정.
   * 반환: {L, a, b, hex, uniformity, glare_ratio}
   */
  function extractColor(img, roi, refRoi) {
    var gains = refRoi ? whiteBalanceGains(img, refRoi) : [1, 1, 1];
    var v = validPixels(innerPixels(img, roi));
    var lin = v.px.map(function (p) {
      return [LIN_LUT[p[0]] * gains[0], LIN_LUT[p[1]] * gains[1], LIN_LUT[p[2]] * gains[2]];
    });
    var lab = lin.map(function (q) { return linearToLab(q[0], q[1], q[2]); });

    // 중앙값에서 크게 벗어난 픽셀(그림자, 이물질 등) 제거
    var center = medianCols(lab);
    var d = lab.map(function (q) { return deltaE76(q, center); });
    var dm = median(d);
    var mad = median(d.map(function (x) { return Math.abs(x - dm); }));
    var limit = Math.max(3.0, dm + 3.0 * 1.4826 * mad);
    var inLab = [], inLin = [];
    for (var i = 0; i < lab.length; i++) {
      if (d[i] <= limit) { inLab.push(lab[i]); inLin.push(lin[i]); }
    }
    if (inLab.length >= Math.max(10, 0.3 * lab.length)) { lab = inLab; lin = inLin; }

    center = medianCols(lab);
    var uniformity = median(lab.map(function (q) { return deltaE2000(q, center); }));
    var ml = medianCols(lin);
    var hex = "#" + ml.map(function (c) {
      var s = Math.round(linearToSrgb01(c) * 255).toString(16);
      return s.length < 2 ? "0" + s : s;
    }).join("");

    return {
      L: center[0], a: center[1], b: center[2],
      hex: hex, uniformity: uniformity, glare_ratio: v.glare
    };
  }

  // ---------------------------
  // 예측
  // rows: [{ph, L, a, b, ...}]
  // ---------------------------
  function classStats(rows) {
    var grouped = {};
    rows.forEach(function (r) { (grouped[r.ph] = grouped[r.ph] || []).push(r); });
    var stats = {};
    Object.keys(grouped).forEach(function (k) {
      var X = grouped[k].map(function (r) { return [r.L, r.a, r.b]; });
      var center = medianCols(X);
      var spread = X.length > 1 ? median(X.map(function (x) { return deltaE2000(x, center); })) : 0;
      stats[k] = { ph: grouped[k][0].ph, center: center, spread: spread, count: X.length };
    });
    return stats;
  }

  function confidence(dist, spread, separation) {
    var base = Math.max(3.0, spread * 2.0);
    var sepOk = function (t) { return separation === undefined || separation >= t; };
    if (dist <= base && sepOk(1.35)) return "높음";
    if (dist <= base * 2.5 && sepOk(1.08)) return "보통";
    return "낮음";
  }

  /** V5 방식: 색이 가까운 기준 3개를 거리 가중 평균 */
  function predictKnn(q, stats) {
    var ds = Object.keys(stats).map(function (k) {
      return [deltaE2000(stats[k].center, q), stats[k].ph, stats[k]];
    }).sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
    var top = ds.slice(0, 3), pred;
    if (top[0][0] < 1e-9) {
      pred = top[0][1];
    } else {
      var w = top.map(function (t) { return 1 / Math.pow(t[0] + 1e-6, 1.5); });
      var sw = 0, s = 0;
      top.forEach(function (t, i) { s += w[i] * t[1]; sw += w[i]; });
      pred = s / sw;
    }
    var nd = top[0][0];
    var second = top.length > 1 ? top[1][0] : nd + 999;
    var separation = second / Math.max(nd, 0.5);
    return {
      ph: pred, nearest_ph: top[0][1], distance: nd,
      confidence: confidence(nd, top[0][2].spread, separation),
      out_of_range: false
    };
  }

  /** V6 방식: 기준색을 pH 순서로 이은 꺾은선에 투영 */
  function predictCurve(q, stats) {
    var list = Object.keys(stats).map(function (k) { return stats[k]; })
      .sort(function (x, y) { return x.ph - y.ph; });
    var best = null;
    for (var i = 0; i < list.length - 1; i++) {
      var p0 = list[i].center, p1 = list[i + 1].center;
      var seg = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      var len2 = seg[0] * seg[0] + seg[1] * seg[1] + seg[2] * seg[2];
      var t = len2 < 1e-12 ? 0 :
        ((q[0] - p0[0]) * seg[0] + (q[1] - p0[1]) * seg[1] + (q[2] - p0[2]) * seg[2]) / len2;
      var tc = Math.min(1, Math.max(0, t));
      var proj = [p0[0] + tc * seg[0], p0[1] + tc * seg[1], p0[2] + tc * seg[2]];
      var d = deltaE2000(proj, q);
      if (best === null || d < best.d) best = { d: d, i: i, t: t, tc: tc };
    }
    var a = list[best.i], b = list[best.i + 1];
    var pred = a.ph + best.tc * (b.ph - a.ph);
    var outOfRange = (best.i === 0 && best.t < 0) || (best.i === list.length - 2 && best.t > 1);

    var k = 0, kd = Infinity;
    list.forEach(function (s, j) {
      var dd = deltaE2000(s.center, q);
      if (dd < kd) { kd = dd; k = j; }
    });

    var conf = confidence(best.d, Math.max(a.spread, b.spread));
    if (outOfRange && conf === "높음") conf = "보통";
    return {
      ph: pred, nearest_ph: list[k].ph, distance: best.d,
      confidence: conf, out_of_range: outOfRange
    };
  }

  function predictPh(L, a, b, rows, method, stats) {
    stats = stats || classStats(rows);
    if (Object.keys(stats).length < 2) {
      throw new Error("서로 다른 pH 기준값이 최소 2개 이상 필요합니다.");
    }
    var q = [L, a, b];
    return method === "knn" ? predictKnn(q, stats) : predictCurve(q, stats);
  }

  /** 영역 색이 고르지 않거나 반사광이 많으면 신뢰도를 낮춤 */
  function adjustConfidence(conf, uniformity, glare) {
    var order = ["낮음", "보통", "높음"];
    var level = order.indexOf(conf);
    if (uniformity > 8 || glare > 0.3) level = Math.min(level, 1);
    if (uniformity > 15 || glare > 0.6) level = 0;
    return order[level];
  }

  /**
   * leave="image": 기준을 하나씩 빼고 예측 / leave="ph": pH 기준값 하나를 통째로 빼고 예측(양 끝 제외)
   */
  function crossValidate(rows, method, leave) {
    var phs = rows.map(function (r) { return r.ph; }).sort(function (x, y) { return x - y; });
    var lo = phs[0], hi = phs[phs.length - 1];
    var details = [];
    rows.forEach(function (r, i) {
      var rest;
      if (leave === "ph") {
        if (r.ph === lo || r.ph === hi) return;
        rest = rows.filter(function (x) { return x.ph !== r.ph; });
      } else {
        rest = rows.slice(0, i).concat(rows.slice(i + 1));
      }
      var stats = classStats(rest);
      if (Object.keys(stats).length < 2) return;
      var p = predictPh(r.L, r.a, r.b, rest, method, stats);
      details.push({ ph: r.ph, pred: p.ph, err: p.ph - r.ph, name: r.name || "" });
    });
    if (!details.length) return null;
    var errs = details.map(function (d) { return Math.abs(d.err); });
    var n = errs.length;
    var sum = errs.reduce(function (s, e) { return s + e; }, 0);
    return {
      n: n,
      mae: sum / n,
      max_err: Math.max.apply(null, errs),
      within_02: errs.filter(function (e) { return e <= 0.2; }).length / n,
      within_05: errs.filter(function (e) { return e <= 0.5; }).length / n,
      details: details
    };
  }

  // ---------------------------
  // 색표 모드
  // chart: {patches: [{ph, roi_norm}], strip_norm}
  // ---------------------------
  function readChartRows(img, chart) {
    var warnings = [];
    var rows = chart.patches.map(function (p) {
      var c = extractColor(img, normToRoi(img, p.roi_norm));
      if (c.glare_ratio > 0.3) warnings.push("색표 pH " + p.ph + " 칸 반사광");
      return { ph: p.ph, L: c.L, a: c.a, b: c.b, hex: c.hex, name: "색표 pH " + p.ph };
    });
    return { rows: rows, warnings: warnings };
  }

  function measureWithChart(img, chart, method, stripRoi) {
    var r = readChartRows(img, chart);
    var color = extractColor(img, stripRoi || normToRoi(img, chart.strip_norm));
    var pred = predictPh(color.L, color.a, color.b, r.rows, method);
    return { pred: pred, color: color, rows: r.rows, warnings: r.warnings };
  }

  var api = {
    WB_TARGET: WB_TARGET,
    srgbToLinear01: srgbToLinear01, linearToSrgb01: linearToSrgb01, linearToLab: linearToLab,
    deltaE76: deltaE76, deltaE2000: deltaE2000, median: median,
    clampRoi: clampRoi, normToRoi: normToRoi, roiToNorm: roiToNorm,
    extractColor: extractColor, classStats: classStats, predictPh: predictPh,
    adjustConfidence: adjustConfidence, crossValidate: crossValidate,
    readChartRows: readChartRows, measureWithChart: measureWithChart
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PhCore = api;
})(typeof self !== "undefined" ? self : this);
