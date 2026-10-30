#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pH Color Analyzer V6 - 색 계산 / 예측 / 검증 로직 (GUI 없음)

V5 대비 변경점
- 한글 경로 사진 읽기 (cv2.imread 대신 np.fromfile + cv2.imdecode)
- 실제 CIE Lab (L 0~100, a/b 실제값) 사용. V5의 OpenCV 8비트 Lab 값은 자동 변환
- 흰색/회색 기준 카드로 화이트밸런스 + 노출 보정 (선택)
- 반사광(하이라이트)·너무 어두운 픽셀·튀는 픽셀 제거
- 색차는 CIEDE2000(ΔE00)
- pH 곡선 투영 예측 (기준색을 pH 순서로 이은 선 위에 투영)
- 교차검증(Leave-one-out)으로 정확도 수치화
- 색표 모드: 같은 사진 속 시험지 상자 색표와 직접 비교 (기준색 등록 불필요)
"""

import csv
import json
import time
from pathlib import Path

import cv2
import numpy as np

DATA_DIR = Path.home() / "pH_Analyzer_Data"
TRAIN_FILE = DATA_DIR / "ph_training_v6.csv"
RESULT_FILE = DATA_DIR / "ph_results_v6.csv"
SITES_FILE = DATA_DIR / "site_profiles.json"
CONFIG_FILE = DATA_DIR / "config_v6.json"
CV_REPORT_FILE = DATA_DIR / "accuracy_report_v6.csv"
CHART_FILE = DATA_DIR / "chart_profile_v6.json"

# V5 이하에서 쓰던 기준색 파일 (OpenCV 8비트 Lab)
LEGACY_TRAIN_FILES = [
    DATA_DIR / "ph_training.csv",
    Path.home() / "ph_color_analyzer_v3" / "ph_training.csv",
    Path.home() / "ph_color_analyzer_v2" / "ph_training.csv",
    Path.home() / "ph_color_analyzer" / "ph_training.csv",
]

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}

MODE_RAW = "raw"   # 색 보정 없음
MODE_WB = "wb"     # 흰색/회색 기준 카드로 보정
MODE_CHART = "chart"  # 같은 사진 속 상자 색표와 비교

METHOD_CURVE = "curve"  # V6: pH 곡선 투영
METHOD_KNN = "knn"      # V5: 가까운 기준 3개 거리가중 평균

# 기준 카드가 보정 후 갖게 될 밝기 (선형 RGB). 매번 같은 카드를 쓰면 값 자체는 중요하지 않음
WB_TARGET = 0.5

TRAIN_HEADER = [
    "timestamp", "ph", "image_path",
    "roi_x", "roi_y", "roi_w", "roi_h",
    "ref_x", "ref_y", "ref_w", "ref_h",
    "mode", "L", "a", "b", "hex",
    "uniformity", "glare_ratio",
]

RESULT_HEADER = [
    "timestamp", "source", "site", "image_path",
    "mode", "method",
    "raw_ph", "site_offset", "site_corrected_ph",
    "manual_adjustment", "final_ph",
    "nearest_ph", "confidence", "color_distance",
    "out_of_range", "L", "a", "b",
    "uniformity", "glare_ratio",
]


# ---------------------------
# 파일 / 설정
# ---------------------------
def ensure_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def read_json(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def write_json(path, data):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def load_sites():
    sites = read_json(SITES_FILE, {})
    if not sites:
        sites = {"기본 현장": {"offset": 0.0, "note": ""}}
        write_json(SITES_FILE, sites)
    return sites


def save_sites(sites):
    write_json(SITES_FILE, sites)


# ---------------------------
# 사진 읽기 (한글 경로 지원)
# ---------------------------
def imread_any(path):
    """cv2.imread는 Windows에서 한글/특수문자 경로를 못 읽으므로 바이트로 읽어서 디코딩."""
    try:
        data = np.fromfile(str(path), dtype=np.uint8)
    except OSError:
        data = None

    img = None
    if data is not None and data.size:
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)

    if img is None:
        raise RuntimeError(f"사진을 읽을 수 없습니다:\n{path}")
    return img


def clamp_roi(roi, w, h):
    x, y, rw, rh = [int(v) for v in roi]
    x = max(0, min(w - 1, x))
    y = max(0, min(h - 1, y))
    rw = max(1, min(w - x, rw))
    rh = max(1, min(h - y, rh))
    return [x, y, rw, rh]


def roi_to_normalized(img, roi):
    h, w = img.shape[:2]
    x, y, rw, rh = roi
    return [x / w, y / h, rw / w, rh / h]


def normalized_to_roi(img, norm):
    h, w = img.shape[:2]
    rx, ry, rw, rh = norm
    return clamp_roi(
        [int(w * rx), int(h * ry), int(w * rw), int(h * rh)],
        w, h
    )


# ---------------------------
# 색 공간 변환
# ---------------------------
_RGB2XYZ = np.array([
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
])
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883])


def srgb_to_linear(rgb01):
    rgb01 = np.asarray(rgb01, dtype=float)
    return np.where(
        rgb01 <= 0.04045,
        rgb01 / 12.92,
        ((rgb01 + 0.055) / 1.055) ** 2.4
    )


def linear_to_srgb(lin):
    lin = np.clip(np.asarray(lin, dtype=float), 0.0, 1.0)
    return np.where(
        lin <= 0.0031308,
        lin * 12.92,
        1.055 * lin ** (1 / 2.4) - 0.055
    )


def linear_rgb_to_lab(lin):
    """선형 RGB (..., 3) → CIE Lab D65. 1을 넘는 값도 그대로 계산 (보정 후 밝아진 경우)."""
    xyz = np.asarray(lin, dtype=float) @ _RGB2XYZ.T
    xyz = xyz / _WHITE_D65

    eps = 216 / 24389
    kappa = 24389 / 27
    f = np.where(
        xyz > eps,
        np.cbrt(xyz),
        (kappa * xyz + 16) / 116
    )

    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def legacy_cv_lab_to_lab(L, a, b):
    """V5 이하의 OpenCV 8비트 Lab(L 0~255, a/b +128) → 실제 Lab."""
    return L * 100.0 / 255.0, a - 128.0, b - 128.0


def delta_e76(lab1, lab2):
    d = np.asarray(lab1, dtype=float) - np.asarray(lab2, dtype=float)
    return np.sqrt(np.sum(d * d, axis=-1))


def delta_e2000(lab1, lab2):
    """CIEDE2000 색차. 입력은 (..., 3) 배열, 브로드캐스팅 지원."""
    lab1 = np.asarray(lab1, dtype=float)
    lab2 = np.asarray(lab2, dtype=float)
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]

    C1 = np.hypot(a1, b1)
    C2 = np.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cm ** 7 / (Cm ** 7 + 25.0 ** 7)))

    a1p = (1 + G) * a1
    a2p = (1 + G) * a2
    C1p = np.hypot(a1p, b1)
    C2p = np.hypot(a2p, b2)

    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360

    dLp = L2 - L1
    dCp = C2p - C1p

    dhp = h2p - h1p
    dhp = np.where(dhp > 180, dhp - 360, dhp)
    dhp = np.where(dhp < -180, dhp + 360, dhp)
    dhp = np.where(C1p * C2p == 0, 0.0, dhp)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp / 2))

    Lpm = (L1 + L2) / 2
    Cpm = (C1p + C2p) / 2

    hsum = h1p + h2p
    hpm = np.where(
        np.abs(h1p - h2p) > 180,
        np.where(hsum < 360, (hsum + 360) / 2, (hsum - 360) / 2),
        hsum / 2
    )
    hpm = np.where(C1p * C2p == 0, hsum, hpm)

    T = (
        1
        - 0.17 * np.cos(np.radians(hpm - 30))
        + 0.24 * np.cos(np.radians(2 * hpm))
        + 0.32 * np.cos(np.radians(3 * hpm + 6))
        - 0.20 * np.cos(np.radians(4 * hpm - 63))
    )

    d_theta = 30 * np.exp(-(((hpm - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cpm ** 7 / (Cpm ** 7 + 25.0 ** 7))
    Sl = 1 + (0.015 * (Lpm - 50) ** 2) / np.sqrt(20 + (Lpm - 50) ** 2)
    Sc = 1 + 0.045 * Cpm
    Sh = 1 + 0.015 * Cpm * T
    Rt = -np.sin(np.radians(2 * d_theta)) * Rc

    return np.sqrt(
        (dLp / Sl) ** 2
        + (dCp / Sc) ** 2
        + (dHp / Sh) ** 2
        + Rt * (dCp / Sc) * (dHp / Sh)
    )


# ---------------------------
# 색 추출
# ---------------------------
def _inner_crop(img, roi):
    h, w = img.shape[:2]
    x, y, rw, rh = clamp_roi(roi, w, h)
    crop = img[y:y + rh, x:x + rw]
    if crop.size == 0:
        raise RuntimeError("선택한 영역이 비어 있습니다.")

    ch, cw = crop.shape[:2]
    px = max(1, int(cw * 0.08))
    py = max(1, int(ch * 0.08))
    if cw > px * 2 + 4 and ch > py * 2 + 4:
        crop = crop[py:ch - py, px:cw - px]
    return crop


def _valid_pixels(crop_bgr):
    """반사광(포화)·너무 어두운 픽셀 제거. 남는 게 너무 적으면 전부 사용."""
    px = crop_bgr.reshape(-1, 3)
    mx = px.max(axis=1)
    mn = px.min(axis=1)
    keep = (mx < 250) & (mx > 15) & ~((mn > 235) & (mx - mn < 12))
    glare_ratio = 1.0 - float(keep.mean())
    if keep.sum() < max(20, 0.2 * len(px)):
        return px, glare_ratio
    return px[keep], glare_ratio


def white_balance_gains(img, ref_roi):
    """기준 카드(흰색/회색) 영역이 WB_TARGET 회색이 되도록 하는 채널별 배율 (선형 RGB, R,G,B 순)."""
    crop = _inner_crop(img, ref_roi)
    px, _ = _valid_pixels(crop)
    rgb = px[:, ::-1].astype(float) / 255.0
    med = np.median(srgb_to_linear(rgb), axis=0)
    if np.any(med < 0.01):
        raise RuntimeError(
            "기준 카드 영역이 너무 어둡습니다.\n"
            "흰색/회색 카드 부분을 다시 선택하세요."
        )
    return WB_TARGET / med


def extract_color(img, roi, ref_roi=None):
    """
    시험지 영역의 대표색 계산.
    ref_roi가 있으면 그 영역(흰색/회색 카드)으로 화이트밸런스 + 노출 보정.
    반환: dict(L, a, b, hex, uniformity, glare_ratio)
    """
    gains = white_balance_gains(img, ref_roi) if ref_roi else np.ones(3)

    crop = _inner_crop(img, roi)
    px, glare_ratio = _valid_pixels(crop)

    lin = srgb_to_linear(px[:, ::-1].astype(float) / 255.0) * gains
    lab = linear_rgb_to_lab(lin)

    # 중앙값에서 크게 벗어난 픽셀(그림자, 이물질 등) 제거
    center = np.median(lab, axis=0)
    d = delta_e76(lab, center)
    mad = float(np.median(np.abs(d - np.median(d))))
    limit = max(3.0, float(np.median(d)) + 3.0 * 1.4826 * mad)
    inliers = d <= limit
    if inliers.sum() >= max(10, 0.3 * len(lab)):
        lab = lab[inliers]
        lin = lin[inliers]

    center = np.median(lab, axis=0)
    uniformity = float(np.median(delta_e2000(lab, center)))

    rgb8 = np.round(
        linear_to_srgb(np.median(lin, axis=0)) * 255
    ).astype(int)
    hex_color = "#{:02x}{:02x}{:02x}".format(*rgb8)

    return {
        "L": float(center[0]),
        "a": float(center[1]),
        "b": float(center[2]),
        "hex": hex_color,
        "uniformity": uniformity,
        "glare_ratio": glare_ratio,
    }


# ---------------------------
# 기준색 데이터
# ---------------------------
def migrate_legacy_training():
    """V6 기준색 파일이 없으면 V5 이하 파일을 실제 Lab으로 변환해서 생성. 원본은 그대로 둠."""
    if TRAIN_FILE.exists():
        return 0

    for old in LEGACY_TRAIN_FILES:
        if not old.exists():
            continue

        rows = []
        try:
            with open(old, "r", encoding="utf-8-sig", newline="") as f:
                for r in csv.DictReader(f):
                    try:
                        L, a, b = legacy_cv_lab_to_lab(
                            float(r["L"]), float(r["a"]), float(r["b"])
                        )
                        rows.append({
                            "timestamp": r.get("timestamp", ""),
                            "ph": float(r["ph"]),
                            "image_path": r.get("image_path", ""),
                            "roi": [
                                r.get("roi_x", ""), r.get("roi_y", ""),
                                r.get("roi_w", ""), r.get("roi_h", ""),
                            ],
                            "L": L, "a": a, "b": b,
                            "hex": r.get("hex", "#dddddd"),
                        })
                    except Exception:
                        continue
        except Exception:
            continue

        if not rows:
            continue

        with open(TRAIN_FILE, "w", encoding="utf-8-sig", newline="") as f:
            wr = csv.writer(f)
            wr.writerow(TRAIN_HEADER)
            for r in rows:
                wr.writerow([
                    r["timestamp"], f'{r["ph"]:.4f}', r["image_path"],
                    *r["roi"], "", "", "", "",
                    MODE_RAW,
                    f'{r["L"]:.4f}', f'{r["a"]:.4f}', f'{r["b"]:.4f}',
                    r["hex"], "", "",
                ])
        return len(rows)

    return 0


def load_training_rows(mode=None):
    rows = []
    if not TRAIN_FILE.exists():
        return rows

    with open(TRAIN_FILE, "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            try:
                row = {
                    "ph": float(r["ph"]),
                    "image_path": r["image_path"],
                    "mode": r.get("mode") or MODE_RAW,
                    "L": float(r["L"]),
                    "a": float(r["a"]),
                    "b": float(r["b"]),
                    "hex": r.get("hex", "#dddddd"),
                }
            except Exception:
                continue
            if mode is None or row["mode"] == mode:
                rows.append(row)
    return rows


def append_training(ph, image_path, roi, ref_roi, mode, color):
    new_file = not TRAIN_FILE.exists()
    with open(TRAIN_FILE, "a", encoding="utf-8-sig", newline="") as f:
        wr = csv.writer(f)
        if new_file:
            wr.writerow(TRAIN_HEADER)
        wr.writerow([
            time.strftime("%Y-%m-%d %H:%M:%S"),
            f"{ph:.4f}",
            str(image_path),
            *roi,
            *(ref_roi if ref_roi else ["", "", "", ""]),
            mode,
            f'{color["L"]:.4f}', f'{color["a"]:.4f}', f'{color["b"]:.4f}',
            color["hex"],
            f'{color["uniformity"]:.4f}',
            f'{color["glare_ratio"]:.4f}',
        ])


def append_result(row):
    new_file = not RESULT_FILE.exists()
    with open(RESULT_FILE, "a", encoding="utf-8-sig", newline="") as f:
        wr = csv.writer(f)
        if new_file:
            wr.writerow(RESULT_HEADER)
        wr.writerow([
            time.strftime("%Y-%m-%d %H:%M:%S"),
            row.get("source", "manual"),
            row["site"],
            row["image_path"],
            row["mode"],
            row["method"],
            f'{row["raw_ph"]:.4f}',
            f'{row["site_offset"]:.4f}',
            f'{row["site_corrected_ph"]:.4f}',
            f'{row["manual_adjustment"]:.4f}',
            f'{row["final_ph"]:.4f}',
            f'{row["nearest_ph"]:.4f}',
            row["confidence"],
            f'{row["distance"]:.4f}',
            "Y" if row["out_of_range"] else "",
            f'{row["L"]:.4f}',
            f'{row["a"]:.4f}',
            f'{row["b"]:.4f}',
            f'{row["uniformity"]:.4f}',
            f'{row["glare_ratio"]:.4f}',
        ])


def load_auto_processed():
    """이전에 자동 측정한 사진 경로 (프로그램 재시작 후 중복 측정 방지)."""
    done = set()
    if not RESULT_FILE.exists():
        return done
    try:
        with open(RESULT_FILE, "r", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                if r.get("source") == "auto":
                    done.add(r.get("image_path", ""))
    except Exception:
        pass
    return done


# ---------------------------
# 예측
# ---------------------------
def class_stats(rows):
    grouped = {}
    for r in rows:
        grouped.setdefault(r["ph"], []).append(r)

    stats = {}
    for ph, items in grouped.items():
        X = np.array([[r["L"], r["a"], r["b"]] for r in items], dtype=float)
        center = np.median(X, axis=0)
        spread = float(np.median(delta_e2000(X, center))) if len(X) > 1 else 0.0
        stats[ph] = {"center": center, "spread": spread, "count": len(items)}
    return stats


def _confidence(dist, spread, separation=None):
    base = max(3.0, spread * 2.0)
    if dist <= base and (separation is None or separation >= 1.35):
        return "높음"
    if dist <= base * 2.5 and (separation is None or separation >= 1.08):
        return "보통"
    return "낮음"


def _predict_knn(q, stats):
    """V5 방식: 색이 가까운 기준 3개를 거리 가중 평균."""
    ds = sorted(
        (float(delta_e2000(st["center"], q)), ph, st)
        for ph, st in stats.items()
    )
    top = ds[:3]

    if top[0][0] < 1e-9:
        pred = float(top[0][1])
    else:
        w = [1.0 / ((d + 1e-6) ** 1.5) for d, _, _ in top]
        pred = sum(wi * ph for wi, (_, ph, _) in zip(w, top)) / sum(w)

    nearest_d, nearest_ph, nearest_st = top[0]
    second_d = top[1][0] if len(top) > 1 else nearest_d + 999.0
    separation = second_d / max(nearest_d, 0.5)

    # 가중 평균이라 항상 기준 범위 안의 값이 나오므로 범위 밖 여부는 판단 불가
    return {
        "ph": float(pred),
        "nearest_ph": float(nearest_ph),
        "distance": nearest_d,
        "confidence": _confidence(nearest_d, nearest_st["spread"], separation),
        "out_of_range": False,
    }


def _predict_curve(q, stats):
    """
    V6 방식: 기준색을 pH 순서대로 이은 꺾은선(pH 색 곡선)에 측정색을 투영.
    가장 가까운 구간에서 위치 비율만큼 pH를 보간하므로
    색이 비슷하지만 pH가 멀리 떨어진 기준이 섞이지 않는다.
    """
    phs = sorted(stats)
    centers = np.array([stats[p]["center"] for p in phs])

    best = None
    for i in range(len(phs) - 1):
        p0, p1 = centers[i], centers[i + 1]
        seg = p1 - p0
        seg_len2 = float(seg @ seg)
        t = 0.0 if seg_len2 < 1e-12 else float((q - p0) @ seg / seg_len2)
        tc = min(1.0, max(0.0, t))
        proj = p0 + tc * seg
        d = float(delta_e2000(proj, q))
        if best is None or d < best[0]:
            best = (d, i, t, tc)

    d, i, t, tc = best
    pred = phs[i] + tc * (phs[i + 1] - phs[i])

    end_low = i == 0 and t < 0
    end_high = i == len(phs) - 2 and t > 1
    out_of_range = end_low or end_high

    dist_each = [float(delta_e2000(c, q)) for c in centers]
    k = int(np.argmin(dist_each))
    nearest_ph = phs[k]

    spread = max(stats[phs[i]]["spread"], stats[phs[i + 1]]["spread"])
    conf = _confidence(d, spread)
    if out_of_range and conf == "높음":
        conf = "보통"

    return {
        "ph": float(pred),
        "nearest_ph": float(nearest_ph),
        "distance": d,
        "confidence": conf,
        "out_of_range": out_of_range,
    }


def predict_ph(L, a, b, rows, method=METHOD_CURVE, stats=None):
    if stats is None:
        stats = class_stats(rows)
    if len(stats) < 2:
        raise RuntimeError("서로 다른 pH 기준값이 최소 2개 이상 필요합니다.")

    q = np.array([L, a, b], dtype=float)
    if method == METHOD_KNN:
        return _predict_knn(q, stats)
    return _predict_curve(q, stats)


def adjust_confidence(conf, uniformity, glare_ratio):
    """영역 색이 고르지 않거나 반사광이 많으면 신뢰도를 낮춤 (ΔE00 기준)."""
    order = ["낮음", "보통", "높음"]
    level = order.index(conf)
    if uniformity > 8 or glare_ratio > 0.3:
        level = min(level, 1)
    if uniformity > 15 or glare_ratio > 0.6:
        level = 0
    return order[level]


# ---------------------------
# 정확도 검사
# ---------------------------
def cross_validate(rows, method, leave="image"):
    """
    leave="image": 기준 사진을 한 장씩 빼고 나머지로 예측 (같은 pH 사진이 남아 있으므로 낙관적)
    leave="ph":    pH 기준값 하나를 통째로 빼고 예측 (기준 사이 값을 얼마나 잘 맞히는지, 양 끝 pH 제외)
    반환: dict(n, mae, rmse, max_err, within_02, within_05, details) 또는 None
    """
    phs = sorted({r["ph"] for r in rows})
    details = []
    for i, r in enumerate(rows):
        if leave == "ph":
            if r["ph"] in (phs[0], phs[-1]):
                continue
            rest = [x for x in rows if x["ph"] != r["ph"]]
        else:
            rest = rows[:i] + rows[i + 1:]
        stats = class_stats(rest)
        if len(stats) < 2:
            continue
        p = predict_ph(r["L"], r["a"], r["b"], rest, method, stats)
        details.append({
            "ph": r["ph"],
            "pred": p["ph"],
            "err": p["ph"] - r["ph"],
            "image_path": r["image_path"],
        })

    if not details:
        return None

    errs = np.array([abs(d["err"]) for d in details])
    return {
        "n": len(details),
        "mae": float(errs.mean()),
        "rmse": float(np.sqrt((errs ** 2).mean())),
        "max_err": float(errs.max()),
        "within_02": float((errs <= 0.2).mean()),
        "within_05": float((errs <= 0.5).mean()),
        "details": details,
    }


def write_cv_report(results):
    """results: {(method, leave): cross_validate 결과}"""
    with open(CV_REPORT_FILE, "w", encoding="utf-8-sig", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["method", "test", "actual_ph", "predicted_ph", "error", "image_path"])
        for (method, leave), res in results.items():
            if not res:
                continue
            for d in res["details"]:
                wr.writerow([
                    method, leave, f'{d["ph"]:.3f}', f'{d["pred"]:.3f}',
                    f'{d["err"]:+.3f}', d["image_path"],
                ])


# ---------------------------
# 색표 모드
# ---------------------------
def load_chart():
    """
    저장된 색표 설정. 색 자체가 아니라 '사진 속 위치(비율)'와 칸별 pH만 저장하고,
    색은 측정할 때마다 그 사진에서 새로 읽는다.
    {"patches": [{"ph": 4.0, "roi_norm": [x, y, w, h]}, ...], "strip_norm": [...], ...}
    """
    chart = read_json(CHART_FILE, None)
    if not chart or len(chart.get("patches", [])) < 2 or not chart.get("strip_norm"):
        return None
    return chart


def save_chart(patches, strip_norm, image_path):
    chart = {
        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        "setup_image": str(image_path),
        "patches": [
            {"ph": float(ph), "roi_norm": [float(v) for v in norm]}
            for ph, norm in patches
        ],
        "strip_norm": [float(v) for v in strip_norm],
    }
    if CHART_FILE.exists():
        backup = CHART_FILE.with_name(
            f"chart_profile_v6_backup_{time.strftime('%Y%m%d_%H%M%S')}.json"
        )
        CHART_FILE.replace(backup)
    write_json(CHART_FILE, chart)
    return chart


def chart_summary(chart):
    if not chart:
        return "색표 미설정"
    phs = sorted(p["ph"] for p in chart["patches"])
    return f"색표 {len(phs)}칸 (pH {phs[0]:g}~{phs[-1]:g})"


def read_chart_rows(img, chart, image_path=""):
    """사진 속 색표 칸들의 색을 읽어 기준색 rows 형태로 반환. 반사광 많은 칸은 경고."""
    rows = []
    warnings = []
    for patch in chart["patches"]:
        color = extract_color(img, normalized_to_roi(img, patch["roi_norm"]))
        if color["glare_ratio"] > 0.3:
            warnings.append(f"색표 pH {patch['ph']:g} 칸 반사광")
        rows.append({
            "ph": patch["ph"],
            "image_path": f"{Path(str(image_path)).name} 색표 pH {patch['ph']:g}",
            "mode": MODE_CHART,
            "L": color["L"], "a": color["a"], "b": color["b"],
            "hex": color["hex"],
        })
    return rows, warnings


def measure_with_chart(img, chart, method=METHOD_CURVE, image_path=""):
    """같은 사진 속 색표와 시험지를 비교해 pH 계산."""
    rows, warnings = read_chart_rows(img, chart, image_path)
    color = extract_color(img, normalized_to_roi(img, chart["strip_norm"]))
    pred = predict_ph(color["L"], color["a"], color["b"], rows, method)
    return pred, color, rows, warnings
