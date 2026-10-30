/* pH 색상 분석기 - 웹 화면. 계산은 ph-core.js(PhCore) */
(function () {
  "use strict";

  var core = window.PhCore;
  var MAX_SIDE = 1600;   // 계산용 사진 최대 크기 (긴 변)

  // 예시 사진(sample-chart.jpg, 1200x800)의 색표/시험지 위치
  var SAMPLE_CHART = {
    patches: [4, 5, 6, 7, 8, 9, 10].map(function (ph, i) {
      return { ph: ph, roi_norm: [(140 + i * 135) / 1200, 180 / 800, 100 / 1200, 100 / 800] };
    }),
    strip_norm: [560 / 1200, 520 / 800, 80 / 1200, 120 / 800],
    aspect: 1.5
  };

  // ---------------------------
  // 저장 (이 브라우저에만)
  // ---------------------------
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem("ph." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem("ph." + k, JSON.stringify(v)); return true; } catch (e) { return false; }
    }
  };

  var S = {
    tab: "chart",
    photo: null,          // {img:{width,height,data}, canvas, name}
    sel: null,            // {kind, max, boxes:[], prompt, onDone}
    overlay: [],          // [{roi, kind, label}]
    result: null,
    error: null,
    demo: false,
    draft: null,          // 색표 설정 중: {patches:[{roi, ph}]}
    accuracy: null,
    confirmClear: false,
    memo: "",
    chart: store.get("chart", null),
    refs: store.get("refs", []),
    history: store.get("history", []),
    settings: Object.assign({ method: "curve", offset: 0, wb: true, nextPh: 7 }, store.get("settings", {}))
  };

  var $ = function (id) { return document.getElementById(id); };
  var view = $("view"), ctx = view.getContext("2d");

  function saveSettings() { store.set("settings", S.settings); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmt(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n); }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------------------------
  // 사진 불러오기
  // ---------------------------
  var pendingPick = null;

  function pickPhoto(cb) {
    pendingPick = cb;
    var f = $("file");
    f.value = "";
    f.click();
  }

  $("file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    if (!file || !pendingPick) return;
    var cb = pendingPick;
    pendingPick = null;
    loadImage(file, file.name).then(cb).catch(function () {
      showError("사진을 열 수 없습니다. JPG나 PNG 사진을 골라 주세요. (아이폰은 설정 → 카메라 → 포맷 → 높은 호환성)");
    });
  });

  function loadImage(src, name) {
    return new Promise(function (resolve, reject) {
      var url = typeof src === "string" ? src : URL.createObjectURL(src);
      var im = new Image();
      im.onload = function () {
        var scale = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
        var w = Math.round(im.naturalWidth * scale), h = Math.round(im.naturalHeight * scale);
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        var cx = c.getContext("2d", { willReadFrequently: true });
        cx.drawImage(im, 0, 0, w, h);
        if (typeof src !== "string") URL.revokeObjectURL(url);
        var d = cx.getImageData(0, 0, w, h);
        resolve({ img: { width: w, height: h, data: d.data }, canvas: c, name: name });
      };
      im.onerror = reject;
      im.src = url;
    });
  }

  function setPhoto(p) {
    S.photo = p;
    S.result = null;
    S.error = null;
    S.overlay = [];
    S.memo = "";
  }

  // ---------------------------
  // 영역 선택
  // ---------------------------
  function startSelect(kind, prompt, max, onDone) {
    S.sel = { kind: kind, prompt: prompt, max: max, boxes: [], onDone: onDone };
    render();
  }

  function finishSelect() {
    var sel = S.sel;
    S.sel = null;
    sel.onDone(sel.boxes);
  }

  var drag = null;

  function toImage(ev) {
    var r = view.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(view.width, (ev.clientX - r.left) * view.width / r.width)),
      y: Math.max(0, Math.min(view.height, (ev.clientY - r.top) * view.height / r.height))
    };
  }

  view.addEventListener("pointerdown", function (ev) {
    if (!S.sel) return;
    ev.preventDefault();
    view.setPointerCapture(ev.pointerId);
    var p = toImage(ev);
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  });
  view.addEventListener("pointermove", function (ev) {
    if (!drag) return;
    var p = toImage(ev);
    drag.x1 = p.x; drag.y1 = p.y;
    draw();
  });
  view.addEventListener("pointerup", function () {
    if (!drag || !S.sel) { drag = null; return; }
    var x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    var w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    drag = null;
    var minSide = Math.max(4, view.width / 150);
    if (w < minSide || h < minSide) { draw(); return; }
    S.sel.boxes.push(core.clampRoi([x, y, w, h], view.width, view.height));
    if (S.sel.kind === "patches") S.draft.patches = S.sel.boxes.map(function (b, i) {
      var old = S.draft.patches[i];
      return { roi: b, ph: old ? old.ph : (S.draft.patches.length ? S.draft.patches[S.draft.patches.length - 1].ph + 1 : 4) };
    });
    if (S.sel.boxes.length >= S.sel.max) finishSelect();
    else render();
  });
  view.addEventListener("pointercancel", function () { drag = null; draw(); });

  // ---------------------------
  // 그리기
  // ---------------------------
  var COLORS = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["strip", "patch", "card"].forEach(function (k) { COLORS[k] = cs.getPropertyValue("--" + k).trim(); });
  }

  function draw() {
    if (!S.photo) return;
    var p = S.photo;
    if (view.width !== p.img.width || view.height !== p.img.height) {
      view.width = p.img.width; view.height = p.img.height;
    }
    ctx.drawImage(p.canvas, 0, 0);
    var lw = Math.max(2, p.img.width / 400);
    var font = Math.round(Math.max(12, p.img.width / 55));

    function box(roi, kind, label, dashed) {
      ctx.save();
      ctx.lineWidth = lw;
      ctx.strokeStyle = COLORS[kind];
      if (dashed) ctx.setLineDash([lw * 3, lw * 2]);
      ctx.strokeRect(roi[0], roi[1], roi[2], roi[3]);
      if (label !== undefined && label !== "") {
        ctx.setLineDash([]);
        ctx.font = "700 " + font + "px " + getComputedStyle(document.body).fontFamily;
        var tw = ctx.measureText(label).width + font * 0.6;
        var ty = Math.max(0, roi[1] - font * 1.3);
        ctx.fillStyle = COLORS[kind];
        ctx.fillRect(roi[0], ty, tw, font * 1.3);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, roi[0] + font * 0.3, ty + font * 1.02);
      }
      ctx.restore();
    }

    S.overlay.forEach(function (o) { box(o.roi, o.kind, o.label, false); });
    if (S.sel) {
      S.sel.boxes.forEach(function (b, i) {
        var label = S.sel.kind === "patches" ? (S.draft.patches[i] ? "pH " + S.draft.patches[i].ph : "") : "";
        box(b, S.sel.kind === "patches" ? "patch" : S.sel.kind, label, false);
      });
    }
    if (drag) {
      var kind = S.sel.kind === "patches" ? "patch" : S.sel.kind;
      box([Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1),
        Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)], kind, "", true);
    }
  }

  // ---------------------------
  // 측정
  // ---------------------------
  function finishResult(pred, color, mode, warnings, scaleRows, extra) {
    var conf = core.adjustConfidence(pred.confidence, color.uniformity, color.glare_ratio);
    if (warnings.length && conf === "높음") conf = "보통";
    var notes = warnings.slice();
    if (pred.out_of_range) notes.push(mode === "chart" ? "색표 범위 밖의 색입니다" : "기준색 범위 밖입니다. 더 낮거나 높은 pH 기준이 필요합니다");
    if (color.glare_ratio > 0.3) notes.push("반사광 " + Math.round(color.glare_ratio * 100) + "%를 빼고 계산했습니다");
    if (color.uniformity > 8) notes.push("시험지 영역의 색이 고르지 않습니다");
    S.result = Object.assign({
      raw: pred.ph, nearest: pred.nearest_ph, distance: pred.distance, conf: conf,
      color: color, mode: mode, warnings: notes, scale: scaleRows, name: S.photo.name
    }, extra || {});
    S.error = null;
    render();
  }

  function showError(msg) {
    S.error = msg;
    render();
  }

  function measureChart(chart, stripRoi) {
    try {
      var img = S.photo.img;
      var m = core.measureWithChart(img, chart, S.settings.method, stripRoi);
      var warnings = m.warnings.slice();
      var aspect = img.width / img.height;
      if (chart.aspect && Math.abs(aspect - chart.aspect) / chart.aspect > 0.02) {
        warnings.push("사진 비율이 색표 설정 때와 다릅니다. 위치가 어긋났을 수 있습니다");
      }
      S.overlay = chart.patches.map(function (p) {
        return { roi: core.normToRoi(img, p.roi_norm), kind: "patch", label: String(p.ph) };
      });
      S.overlay.push({ roi: stripRoi || core.normToRoi(img, chart.strip_norm), kind: "strip", label: "시험지" });
      finishResult(m.pred, m.color, "chart", warnings, m.rows);
    } catch (e) {
      showError(e.message);
    }
  }

  function refRowsForMode() {
    var mode = S.settings.wb ? "wb" : "raw";
    return S.refs.filter(function (r) { return r.mode === mode; });
  }

  function scaleRowsFromRefs(rows) {
    var by = {};
    rows.forEach(function (r) { if (!by[r.ph]) by[r.ph] = r; });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  // 시험지 → (카드) 영역을 고른 뒤 cb(stripRoi, cardRoi)
  function selectStripAndCard(promptStrip, cb) {
    startSelect("strip", promptStrip, 1, function (b) {
      var strip = b[0];
      if (!S.settings.wb) { cb(strip, null); return; }
      S.overlay = [{ roi: strip, kind: "strip", label: "시험지" }];
      startSelect("card", "<b>흰색/회색 카드</b> 부분을 드래그하세요", 1, function (c) {
        cb(strip, c[0]);
      });
    });
  }

  // ---------------------------
  // 동작
  // ---------------------------
  var actions = {
    "try-sample": function () {
      loadImage("sample-chart.jpg", "예시 사진 (노란 조명)").then(function (p) {
        setPhoto(p);
        S.demo = true;
        S.tab = "chart";
        measureChart(SAMPLE_CHART);
      });
    },
    "chart-setup": function () {
      pickPhoto(function (p) {
        setPhoto(p);
        S.demo = false;
        S.draft = { patches: [] };
        startSelect("patches", "", 99, function () {});
      });
    },
    "chart-measure": function () {
      pickPhoto(function (p) {
        setPhoto(p);
        S.demo = false;
        measureChart(S.chart);
      });
    },
    "chart-restrip": function () {
      var chart = S.demo ? SAMPLE_CHART : S.chart;
      S.overlay = S.overlay.filter(function (o) { return o.kind !== "strip"; });
      startSelect("strip", "이 사진의 <b>시험지 색 부분</b>을 드래그하세요", 1, function (b) {
        measureChart(chart, b[0]);
      });
    },
    "draft-undo": function () {
      if (!S.sel || !S.sel.boxes.length) return;
      S.sel.boxes.pop();
      S.draft.patches.pop();
      render();
    },
    "draft-next": function () {
      if (S.draft.patches.length < 2) return;
      var phs = S.draft.patches.map(function (p) { return p.ph; });
      if (phs.some(isNaN)) { toast("모든 칸에 pH 값을 입력하세요"); return; }
      if (new Set(phs).size !== phs.length) { toast("같은 pH 값이 두 번 들어 있습니다"); return; }
      S.sel = null;
      S.overlay = S.draft.patches.map(function (p) { return { roi: p.roi, kind: "patch", label: String(p.ph) }; });
      startSelect("strip", "<b>시험지 색 부분</b>을 드래그하세요", 1, function (b) {
        var img = S.photo.img;
        S.chart = {
          patches: S.draft.patches.map(function (p) { return { ph: p.ph, roi_norm: core.roiToNorm(img, p.roi) }; }),
          strip_norm: core.roiToNorm(img, b[0]),
          aspect: img.width / img.height,
          created: new Date().toISOString()
        };
        S.draft = null;
        if (!store.set("chart", S.chart)) toast("이 브라우저에 저장하지 못했습니다. 새로 고치면 설정이 사라집니다");
        else toast("색표 설정을 저장했습니다");
        var check = core.crossValidate(core.readChartRows(img, S.chart).rows, S.settings.method, "ph");
        measureChart(S.chart);
        S.result.chartCheck = check;
        render();
      });
    },
    "cancel-select": function () {
      S.sel = null;
      S.draft = null;
      render();
    },
    "ref-add": function () {
      var ph = parseFloat($("ref-ph").value);
      if (isNaN(ph) || ph < 0 || ph > 14) { toast("기준 pH를 0~14 사이로 입력하세요"); return; }
      S.settings.nextPh = ph;
      saveSettings();
      pickPhoto(function (p) {
        setPhoto(p);
        selectStripAndCard("pH " + ph + " 기준 사진: <b>시험지 색 부분</b>을 드래그하세요", function (strip, card) {
          try {
            var c = core.extractColor(S.photo.img, strip, card);
            S.refs.push({
              id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              ph: ph, L: c.L, a: c.a, b: c.b, hex: c.hex,
              mode: S.settings.wb ? "wb" : "raw", name: p.name, t: new Date().toISOString()
            });
            store.set("refs", S.refs);
            S.overlay = [{ roi: strip, kind: "strip", label: "pH " + ph }];
            if (card) S.overlay.push({ roi: card, kind: "card", label: "카드" });
            S.accuracy = null;
            toast("pH " + ph + " 기준을 추가했습니다");
            render();
          } catch (e) { showError(e.message); }
        });
      });
    },
    "ref-measure": function () {
      var rows = refRowsForMode();
      var n = new Set(rows.map(function (r) { return r.ph; })).size;
      if (n < 2) { showError("먼저 서로 다른 pH 기준을 2개 이상 등록하세요."); return; }
      pickPhoto(function (p) {
        setPhoto(p);
        S.demo = false;
        selectStripAndCard("<b>시험지 색 부분</b>을 드래그하세요", function (strip, card) {
          try {
            var c = core.extractColor(S.photo.img, strip, card);
            var pred = core.predictPh(c.L, c.a, c.b, rows, S.settings.method);
            S.overlay = [{ roi: strip, kind: "strip", label: "시험지" }];
            if (card) S.overlay.push({ roi: card, kind: "card", label: "카드" });
            finishResult(pred, c, S.settings.wb ? "wb" : "raw", [], scaleRowsFromRefs(rows));
          } catch (e) { showError(e.message); }
        });
      });
    },
    "ref-accuracy": function () {
      var rows = refRowsForMode();
      if (new Set(rows.map(function (r) { return r.ph; })).size < 3) {
        toast("서로 다른 pH 기준이 3개 이상 있어야 검사할 수 있습니다");
        return;
      }
      S.accuracy = {};
      ["curve", "knn"].forEach(function (m) {
        S.accuracy[m] = { ph: core.crossValidate(rows, m, "ph"), image: core.crossValidate(rows, m, "image") };
      });
      render();
    },
    "save-result": function () {
      var r = S.result;
      if (!r) return;
      var off = Number(S.settings.offset) || 0;
      S.history.unshift({
        t: new Date().toISOString(), mode: r.mode, memo: S.memo.trim(), name: r.name,
        raw: r.raw, offset: off, final: r.raw + off, conf: r.conf, nearest: r.nearest, distance: r.distance,
        hex: r.color.hex, demo: S.demo
      });
      store.set("history", S.history);
      toast("기록에 저장했습니다 (pH " + fmt(r.raw + off, 2) + ")");
      render();
    },
    "export-csv": function () {
      var head = ["시간", "방식", "메모", "사진", "기본값", "보정값", "최종값", "신뢰도", "가까운 기준", "색차", "색"];
      var lines = [head].concat(S.history.map(function (h) {
        return [h.t, modeName(h.mode), h.memo, h.name, fmt(h.raw, 3), fmt(h.offset, 2), fmt(h.final, 3),
          h.conf, h.nearest, fmt(h.distance, 2), h.hex];
      })).map(function (row) {
        return row.map(function (v) { return '"' + String(v === undefined ? "" : v).replace(/"/g, '""') + '"'; }).join(",");
      });
      var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ph_records_" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    "clear-history": function () { S.confirmClear = true; render(); },
    "clear-history-yes": function () {
      S.history = []; store.set("history", S.history); S.confirmClear = false; render();
    },
    "clear-history-no": function () { S.confirmClear = false; render(); }
  };

  function modeName(m) {
    return { chart: "색표", wb: "기준색(카드 보정)", raw: "기준색" }[m] || m;
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-act]");
    if (t && actions[t.dataset.act]) { actions[t.dataset.act](t); return; }
    var del = ev.target.closest("[data-del-ref]");
    if (del) {
      S.refs = S.refs.filter(function (r) { return r.id !== del.dataset.delRef; });
      store.set("refs", S.refs);
      S.accuracy = null;
      render();
      return;
    }
    var delh = ev.target.closest("[data-del-hist]");
    if (delh) {
      S.history.splice(Number(delh.dataset.delHist), 1);
      store.set("history", S.history);
      render();
      return;
    }
    var tab = ev.target.closest("[data-tab]");
    if (tab) {
      if (S.sel) { S.sel = null; S.draft = null; }
      S.tab = tab.dataset.tab;
      S.result = null; S.error = null; S.overlay = [];
      render();
    }
  });

  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t.dataset.patch !== undefined) {
      S.draft.patches[Number(t.dataset.patch)].ph = parseFloat(t.value);
      draw();
    } else if (t.id === "offset") {
      S.settings.offset = parseFloat(t.value) || 0;
      saveSettings();
      updateFinal();
    } else if (t.id === "memo") {
      S.memo = t.value;
    }
  });

  document.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.id === "method") {
      S.settings.method = t.value;
      saveSettings();
      S.result = null; S.accuracy = null;
      toast("예측 방식을 바꿨습니다. 다시 측정하세요");
      render();
    } else if (t.id === "wb") {
      S.settings.wb = t.checked;
      saveSettings();
      S.accuracy = null; S.result = null;
      render();
    }
  });

  function updateFinal() {
    var el = $("final-num");
    if (el && S.result) el.textContent = fmt(S.result.raw + (Number(S.settings.offset) || 0), 2);
  }

  // ---------------------------
  // 화면 구성
  // ---------------------------
  function render() {
    readColors();
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.tab === S.tab));
    });
    $("hist-count").textContent = S.history.length ? "(" + S.history.length + ")" : "";

    var isHist = S.tab === "history";
    $("work").hidden = isHist;
    $("history").hidden = !isHist;
    if (isHist) { renderHistory(); return; }

    // 사진 영역
    var has = !!S.photo;
    view.hidden = !has;
    $("empty").hidden = has;
    view.classList.toggle("selecting", !!S.sel);
    $("empty").querySelector("p").innerHTML = S.tab === "chart"
      ? "<b>시험지와 상자 색표를 한 사진에 찍어 주세요.</b>"
      : "<b>pH를 아는 완충액으로 기준색을 먼저 등록하세요.</b>";
    $("try-sample").hidden = S.tab !== "chart";
    draw();

    var prompt = $("prompt"), btns = $("stagebtns");
    btns.innerHTML = "";
    prompt.classList.toggle("idle", !S.sel);
    if (S.sel) {
      if (S.sel.kind === "patches") {
        prompt.innerHTML = "<b>색표 칸</b>을 낮은 pH부터 하나씩 드래그하세요 · " + S.sel.boxes.length + "칸 선택됨";
        btns.innerHTML = '<button class="btn" data-act="draft-undo" type="button"' + (S.sel.boxes.length ? "" : " disabled") + '>마지막 칸 지우기</button>';
      } else {
        prompt.innerHTML = S.sel.prompt;
      }
      btns.innerHTML += '<button class="btn" data-act="cancel-select" type="button">취소</button>';
    } else {
      prompt.textContent = has ? S.photo.name : "사진을 고르면 여기에 표시됩니다.";
    }

    $("panel").innerHTML = (S.tab === "chart" ? chartPanel() : refPanel()) + settingsBox();
  }

  function errBox() {
    return S.error ? '<div class="err" role="alert">' + esc(S.error) + "</div>" : "";
  }

  function chartPanel() {
    var h = "";
    if (S.draft) {
      h += '<div class="box"><h2>색표 설정 · 1단계 칸 선택</h2>';
      h += '<p class="small muted">사진에서 색표 칸을 드래그할 때마다 아래에 추가됩니다. 칸마다 pH 값을 확인하세요.</p>';
      if (S.draft.patches.length) {
        h += '<div class="patchlist">' + S.draft.patches.map(function (p, i) {
          return '<div class="patchrow"><span class="idx">' + (i + 1) + '</span><label class="field" style="display:flex;align-items:center;gap:8px">pH <input type="number" step="0.01" min="0" max="14" data-patch="' + i + '" value="' + p.ph + '" aria-label="' + (i + 1) + '번 칸 pH"></label></div>';
        }).join("") + "</div>";
      } else {
        h += '<p class="small">아직 고른 칸이 없습니다.</p>';
      }
      h += '<button class="btn primary block" data-act="draft-next" type="button"' + (S.draft.patches.length >= 2 ? "" : " disabled") + '>다음: 시험지 위치 지정</button>';
      h += "</div>";
      return h + errBox();
    }

    if (S.chart || S.demo) {
      var chart = S.demo ? SAMPLE_CHART : S.chart;
      var phs = chart.patches.map(function (p) { return p.ph; }).sort(function (a, b) { return a - b; });
      h += '<div class="box">';
      if (S.demo) h += '<p class="small"><b>예시 사진</b>으로 보는 중입니다. 내 시험지는 아래에서 색표를 설정하세요.</p>';
      if (S.chart) {
        var cp = S.chart.patches.map(function (p) { return p.ph; }).sort(function (a, b) { return a - b; });
        h += '<h2>내 색표 · ' + cp.length + '칸 (pH ' + cp[0] + '~' + cp[cp.length - 1] + ')</h2>';
        h += '<button class="btn primary block" data-act="chart-measure" type="button">사진 찍기 / 고르기 → 측정</button>';
        h += '<p class="small muted">색표와 시험지를 설정 때와 같은 자리에 두고 찍어 주세요.</p>';
        h += '<div class="row">';
        if (S.photo && S.result) h += '<button class="linkbtn" data-act="chart-restrip" type="button">이 사진에서 시험지 위치만 다시</button>';
        h += '<button class="linkbtn" data-act="chart-setup" type="button">색표 다시 설정</button></div>';
      } else {
        h += '<button class="btn primary block" data-act="chart-setup" type="button">내 색표 설정 시작</button>';
        if (S.photo && S.result) h += '<button class="linkbtn" data-act="chart-restrip" type="button">이 사진에서 시험지 위치만 다시</button>';
      }
      h += "</div>";
    } else {
      h += '<div class="box"><h2>처음 한 번: 색표 설정</h2>';
      h += '<ol class="small" style="margin:0;padding-left:1.2em;display:grid;gap:2px">' +
        "<li>시험지 상자 색표와 시험지를 한 사진에 찍습니다.</li>" +
        "<li>색표 칸을 낮은 pH부터 차례로 드래그합니다.</li>" +
        "<li>칸마다 pH를 확인하고, 시험지 위치를 드래그합니다.</li></ol>";
      h += '<button class="btn primary block" data-act="chart-setup" type="button">색표 설정 시작</button>';
      h += '<p class="small muted">거치대를 쓰고 바닥에 자리를 표시해 두면, 다음부터는 사진만 고르면 됩니다.</p></div>';
    }
    return h + errBox() + resultBox();
  }

  function refPanel() {
    var h = "";
    var mode = S.settings.wb ? "wb" : "raw";
    var rows = refRowsForMode();
    var other = S.refs.length - rows.length;

    h += '<div class="box"><h2>기준색 등록</h2>';
    h += '<label class="check"><input type="checkbox" id="wb"' + (S.settings.wb ? " checked" : "") + '> 흰색/회색 카드로 조명 보정 (권장)</label>';
    h += '<div class="row"><label class="field">기준 pH<input type="number" id="ref-ph" step="0.01" min="0" max="14" value="' + S.settings.nextPh + '"></label>';
    h += '<button class="btn" data-act="ref-add" type="button" style="align-self:end">기준 사진 추가</button></div>';
    h += '<p class="small muted">pH를 아는 완충액에 담근 시험지 사진을 pH마다 3~5장씩 추가하세요.' +
      (S.settings.wb ? " 사진마다 시험지 → 카드 순서로 드래그합니다." : "") + "</p>";

    if (rows.length) {
      var by = {};
      rows.forEach(function (r) { (by[r.ph] = by[r.ph] || []).push(r); });
      h += '<div>' + Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).map(function (ph) {
        return '<div class="refgroup"><span class="ph">pH ' + ph + '</span>' + by[ph].map(function (r) {
          return '<span class="refchip" title="' + esc(r.name) + '"><i style="background:' + r.hex + '"></i><button type="button" data-del-ref="' + r.id + '" aria-label="pH ' + ph + ' 기준 ' + esc(r.name) + ' 삭제">×</button></span>';
        }).join("") + "</div>";
      }).join("") + "</div>";
    } else {
      h += '<p class="small">아직 등록한 기준이 없습니다.</p>';
    }
    if (other) h += '<p class="small muted">' + (mode === "wb" ? "보정 없이" : "카드 보정으로") + " 등록한 기준 " + other + "개는 이 설정에서 쓰지 않습니다.</p>";
    h += "</div>";

    h += '<div class="box"><h2>측정</h2>';
    h += '<button class="btn primary block" data-act="ref-measure" type="button">사진 찍기 / 고르기 → 측정</button>';
    h += '<button class="linkbtn" data-act="ref-accuracy" type="button">정확도 검사 (교차검증)</button>';
    if (S.accuracy) h += accuracyTable();
    h += "</div>";
    return h + errBox() + resultBox();
  }

  function accuracyTable() {
    var names = { curve: "pH 곡선 투영", knn: "가까운 기준 3개 평균" };
    var best = null;
    ["curve", "knn"].forEach(function (m) {
      var r = S.accuracy[m].ph || S.accuracy[m].image;
      if (r && (!best || r.mae < best.mae)) best = { m: m, mae: r.mae };
    });
    var cell = function (r) {
      return r ? "±" + fmt(r.mae, 2) + " <span class=\"muted\">(최대 ±" + fmt(r.max_err, 2) + ")</span>" : '<span class="muted">데이터 부족</span>';
    };
    var h = '<div class="table-wrap"><table><thead><tr><th>방식</th><th>보간 검사</th><th>사진 검사</th></tr></thead><tbody>';
    ["curve", "knn"].forEach(function (m) {
      h += "<tr><td>" + names[m] + "</td><td class=\"num\">" + cell(S.accuracy[m].ph) + "</td><td class=\"num\">" + cell(S.accuracy[m].image) + "</td></tr>";
    });
    h += "</tbody></table></div>";
    h += '<p class="small muted">보간 검사는 pH 기준 하나를 통째로 빼고 맞혀 본 평균 오차로, 실제 사용 정확도에 가깝습니다.</p>';
    if (best) h += '<p class="small">권장 방식: <b>' + names[best.m] + "</b>" + (best.m !== S.settings.method ? " (아래 예측 방식에서 바꿀 수 있습니다)" : "") + "</p>";
    return h;
  }

  function scaleBar(rows, value) {
    if (!rows || rows.length < 2) return "";
    var list = rows.slice().sort(function (a, b) { return a.ph - b.ph; });
    var lo = list[0].ph, hi = list[list.length - 1].ph;
    var pos = Math.max(0, Math.min(1, (value - lo) / (hi - lo))) * 100;
    return '<div class="scale-wrap" aria-hidden="true"><div class="scale">' +
      list.map(function (r) { return '<i style="background:' + r.hex + '"></i>'; }).join("") +
      '<span class="scale-marker" style="left:' + pos + '%"></span></div>' +
      '<div class="scale-labels"><span>pH ' + lo + "</span><span>pH " + hi + "</span></div></div>";
  }

  function resultBox() {
    var r = S.result;
    if (!r) return "";
    var off = Number(S.settings.offset) || 0;
    var h = '<div class="box result" aria-live="polite">';
    h += '<div class="bigph"><span class="swatch" style="background:' + r.color.hex + '" title="읽은 시험지 색"></span>' +
      '<span class="unit">pH</span><span class="num" id="final-num">' + fmt(r.raw + off, 2) + "</span>" +
      '<span class="chip c-' + r.conf + '">신뢰도 ' + r.conf + "</span></div>";
    h += scaleBar(r.scale, r.raw);
    h += '<dl class="kv"><dt>기본 예측값</dt><dd>' + fmt(r.raw, 2) + "</dd>" +
      "<dt>가장 비슷한 기준</dt><dd>pH " + r.nearest + "</dd>" +
      "<dt>색차 ΔE</dt><dd>" + fmt(r.distance, 1) + "</dd></dl>";
    if (r.warnings.length) h += '<ul class="warns">' + r.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>";
    if (r.chartCheck) {
      h += '<p class="small muted">색표 자체 검사 (칸 하나씩 빼고 예측): 평균 ±' + fmt(r.chartCheck.mae, 2) + ", 최대 ±" + fmt(r.chartCheck.max_err, 2) + " pH</p>";
    }
    h += '<label class="field">메모 (시료 이름 등)<input type="text" id="memo" maxlength="60" value="' + esc(S.memo) + '"></label>';
    h += '<button class="btn primary block" data-act="save-result" type="button">기록에 저장</button>';
    h += "</div>";
    return h;
  }

  function settingsBox() {
    return '<div class="box"><h2>설정</h2><div class="row">' +
      '<label class="field">예측 방식<select id="method">' +
      '<option value="curve"' + (S.settings.method === "curve" ? " selected" : "") + ">pH 곡선 투영 (권장)</option>" +
      '<option value="knn"' + (S.settings.method === "knn" ? " selected" : "") + ">가까운 기준 3개 평균</option></select></label>" +
      '<label class="field">보정값 (±pH)<input type="number" id="offset" step="0.05" min="-3" max="3" value="' + (Number(S.settings.offset) || 0) + '"></label>' +
      '</div><p class="small muted">보정값은 pH 미터와 비교해 항상 같은 만큼 차이 날 때만 쓰세요. 모든 결과에 더해집니다.</p></div>';
  }

  function renderHistory() {
    var h = '<div class="box"><div class="row" style="justify-content:space-between"><h2>측정 기록 · ' + S.history.length + "건</h2>";
    if (S.history.length) {
      h += '<div class="row"><button class="btn" data-act="export-csv" type="button">엑셀용 CSV 내려받기</button>';
      h += S.confirmClear
        ? '<span class="small">모두 삭제할까요?</span><button class="btn" data-act="clear-history-yes" type="button">삭제</button><button class="btn" data-act="clear-history-no" type="button">취소</button>'
        : '<button class="btn" data-act="clear-history" type="button">모두 삭제</button>';
      h += "</div>";
    }
    h += "</div>";
    if (!S.history.length) {
      h += '<p class="muted">아직 저장한 기록이 없습니다. 측정 후 <b>기록에 저장</b>을 누르면 여기에 쌓입니다.</p>';
    } else {
      h += '<div class="table-wrap"><table><thead><tr><th>시간</th><th>방식</th><th>메모</th><th>최종 pH</th><th>기본값</th><th>보정</th><th>신뢰도</th><th>사진</th><th></th></tr></thead><tbody>';
      h += S.history.map(function (x, i) {
        var d = new Date(x.t);
        var when = (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        return "<tr><td class=\"num\">" + when + "</td><td>" + modeName(x.mode) + (x.demo ? " <span class=\"muted\">(예시)</span>" : "") + "</td><td>" + esc(x.memo || "") +
          '</td><td class="num"><span class="swatch" style="display:inline-block;width:12px;height:12px;vertical-align:-1px;background:' + x.hex + '"></span> <b>' + fmt(x.final, 2) + "</b></td><td class=\"num\">" + fmt(x.raw, 2) +
          '</td><td class="num">' + (x.offset ? (x.offset > 0 ? "+" : "") + fmt(x.offset, 2) : "") + '</td><td><span class="chip c-' + x.conf + '">' + x.conf + "</span></td><td>" + esc(x.name || "") +
          '</td><td><button class="linkbtn" data-del-hist="' + i + '" type="button" aria-label="이 기록 삭제">삭제</button></td></tr>';
      }).join("");
      h += "</tbody></table></div>";
    }
    h += '<p class="note">기록은 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 사라지니 주기적으로 CSV로 내려받아 두세요.</p></div>';
    $("history").innerHTML = h;
  }

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  }
  render();
})();
