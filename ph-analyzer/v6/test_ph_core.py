#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ph_core 자체 검사. 실행: py test_ph_core.py  (GUI 없이 동작)"""

import tempfile
from pathlib import Path

import cv2
import numpy as np

import ph_core as core


def check(name, cond):
    print(("OK   " if cond else "FAIL ") + name)
    if not cond:
        raise SystemExit(1)


def test_delta_e2000():
    # Sharma et al. (2005) CIEDE2000 검증 데이터 일부
    pairs = [
        ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
        ((50.0, -1.0, 2.0), (50.0, 0.0, 0.0), 2.3669),
        ((50.0, 2.5, 0.0), (73.0, 25.0, -18.0), 27.1492),
        ((50.0, 2.5, 0.0), (50.0, 3.2592, 0.3350), 1.0000),
        ((2.0776, 0.0795, -1.1350), (0.9033, -0.0636, -0.5514), 0.9082),
    ]
    ok = all(
        abs(float(core.delta_e2000(np.array(p), np.array(q))) - e) < 1e-3
        for p, q, e in pairs
    )
    check("CIEDE2000 표준 검증값 일치", ok)


def test_lab_matches_reference():
    # sRGB 순수 빨강 / 흰색의 알려진 Lab 값
    red = core.linear_rgb_to_lab(core.srgb_to_linear([1.0, 0.0, 0.0]))
    white = core.linear_rgb_to_lab(core.srgb_to_linear([1.0, 1.0, 1.0]))
    check(
        "sRGB→Lab 변환 (빨강 53.24/80.09/67.20, 흰색 100/0/0)",
        np.allclose(red, [53.24, 80.09, 67.20], atol=0.05)
        and np.allclose(white, [100, 0, 0], atol=0.05)
    )


def test_legacy_conversion():
    # 같은 색을 OpenCV 8비트 Lab으로 구한 뒤 변환하면 실제 Lab과 거의 같아야 함
    bgr = np.array([[[60, 140, 200]]], dtype=np.uint8)
    cv_lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[0, 0].astype(float)
    conv = np.array(core.legacy_cv_lab_to_lab(*cv_lab))
    true = core.linear_rgb_to_lab(
        core.srgb_to_linear(bgr[0, 0, ::-1] / 255.0)
    )
    check(
        f"V5 데이터 변환 오차 ΔE00 {float(core.delta_e2000(conv, true)):.2f} < 1.5",
        float(core.delta_e2000(conv, true)) < 1.5
    )


def make_scene(strip_rgb, light=(1.0, 1.0, 1.0), exposure=1.0, glare=False):
    """흰 카드 + 시험지를 같은 조명에서 찍은 가상 사진 (BGR uint8)."""
    h, w = 200, 300
    lin = np.zeros((h, w, 3))
    lin[:] = core.srgb_to_linear(np.array([0.35, 0.35, 0.35]))
    lin[40:160, 20:120] = core.srgb_to_linear(np.array([0.92, 0.92, 0.92]))
    lin[40:160, 160:280] = core.srgb_to_linear(np.array(strip_rgb) / 255.0)
    lin = lin * np.array(light) * exposure
    rng = np.random.default_rng(0)
    lin = lin * (1 + rng.normal(0, 0.01, lin.shape))
    srgb = (core.linear_to_srgb(lin) * 255).round().astype(np.uint8)
    if glare:
        srgb[60:80, 180:220] = 255
    return srgb[:, :, ::-1].copy()


STRIP_ROI = [160, 40, 120, 120]
REF_ROI = [20, 40, 100, 120]


def test_white_balance_invariance():
    strip = (200, 120, 60)
    base = core.extract_color(make_scene(strip), STRIP_ROI, REF_ROI)
    warm = core.extract_color(
        make_scene(strip, light=(1.4, 1.0, 0.55), exposure=0.7), STRIP_ROI, REF_ROI
    )
    raw_base = core.extract_color(make_scene(strip), STRIP_ROI)
    raw_warm = core.extract_color(
        make_scene(strip, light=(1.4, 1.0, 0.55), exposure=0.7), STRIP_ROI
    )
    d_wb = float(core.delta_e2000(
        [base["L"], base["a"], base["b"]], [warm["L"], warm["a"], warm["b"]]
    ))
    d_raw = float(core.delta_e2000(
        [raw_base["L"], raw_base["a"], raw_base["b"]],
        [raw_warm["L"], raw_warm["a"], raw_warm["b"]]
    ))
    print(f"     조명 변화 색차: 보정 없음 ΔE00 {d_raw:.1f} → 기준카드 보정 ΔE00 {d_wb:.1f}")
    check("기준 카드 보정으로 조명/노출 변화 흡수", d_wb < 1.0 and d_raw > 5 * d_wb)


def test_glare_removed():
    strip = (200, 120, 60)
    clean = core.extract_color(make_scene(strip), STRIP_ROI)
    glare = core.extract_color(make_scene(strip, glare=True), STRIP_ROI)
    d = float(core.delta_e2000(
        [clean["L"], clean["a"], clean["b"]], [glare["L"], glare["a"], glare["b"]]
    ))
    check(f"반사광 픽셀 제거 (색차 ΔE00 {d:.2f}, 반사 비율 {glare['glare_ratio']:.0%})",
          d < 1.0 and glare["glare_ratio"] > 0.03)


def test_unicode_path():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "한글 폴더" / "시험지 사진.jpg"
        p.parent.mkdir()
        ok, buf = cv2.imencode(".jpg", make_scene((200, 120, 60)))
        buf.tofile(str(p))
        img = core.imread_any(p)
        check("한글 경로 사진 읽기", img.shape == (200, 300, 3))


def synthetic_rows():
    """pH 4~10 지시약을 흉내낸 기준색 (빨강→노랑→초록→파랑) + 약간의 잡음."""
    anchors = {
        4: (60, 55, 40), 5: (65, 35, 60), 6: (75, 5, 70),
        7: (70, -30, 45), 8: (60, -40, 10), 9: (50, -20, -30), 10: (40, 10, -50),
    }
    rng = np.random.default_rng(1)
    rows = []
    for ph, lab in anchors.items():
        for _ in range(4):
            L, a, b = np.array(lab) + rng.normal(0, 1.0, 3)
            rows.append({"ph": float(ph), "image_path": f"ph{ph}.jpg",
                         "L": L, "a": a, "b": b, "mode": "raw"})
    return rows, anchors


def test_curve_prediction():
    rows, anchors = synthetic_rows()
    mid = (np.array(anchors[7]) + np.array(anchors[8])) / 2
    p = core.predict_ph(*mid, rows, core.METHOD_CURVE)
    check(f"곡선 투영: pH7과 8 중간색 → {p['ph']:.2f}", abs(p["ph"] - 7.5) < 0.1)

    beyond = np.array(anchors[10]) + (np.array(anchors[10]) - np.array(anchors[9])) * 0.5
    p = core.predict_ph(*beyond, rows, core.METHOD_CURVE)
    check("기준 범위 밖 색은 '범위 밖' 표시", p["out_of_range"] and p["ph"] == 10.0)


def test_cross_validation():
    rows, _ = synthetic_rows()
    res = {m: core.cross_validate(rows, m) for m in (core.METHOD_CURVE, core.METHOD_KNN)}
    for m, r in res.items():
        print(f"     {m}: 평균오차 {r['mae']:.3f} / 최대 {r['max_err']:.3f} (n={r['n']})")
    check("교차검증 동작", all(r and r["n"] == len(rows) for r in res.values()))


if __name__ == "__main__":
    test_delta_e2000()
    test_lab_matches_reference()
    test_legacy_conversion()
    test_white_balance_invariance()
    test_glare_removed()
    test_unicode_path()
    test_curve_prediction()
    test_cross_validation()
    print("\n모든 검사 통과")
