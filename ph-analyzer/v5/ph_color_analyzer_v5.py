#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
import time
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

import cv2
import numpy as np

APP_NAME = "pH Color Analyzer v5"
DATA_DIR = Path.home() / "pH_Analyzer_Data"
TRAIN_FILE = DATA_DIR / "ph_training.csv"
RESULT_FILE = DATA_DIR / "ph_results.csv"
SITES_FILE = DATA_DIR / "site_profiles.json"
CONFIG_FILE = DATA_DIR / "config.json"

IMAGE_TYPES = [("Image files", "*.jpg *.jpeg *.png *.bmp")]
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}


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


def migrate_old_data():
    """V3의 기존 학습데이터가 있으면 V4 폴더로 한 번 복사."""
    if TRAIN_FILE.exists():
        return

    old_candidates = [
        Path.home() / "ph_color_analyzer_v3" / "ph_training.csv",
        Path.home() / "ph_color_analyzer_v2" / "ph_training.csv",
        Path.home() / "ph_color_analyzer" / "ph_training.csv",
    ]

    for old in old_candidates:
        if old.exists():
            try:
                TRAIN_FILE.write_bytes(old.read_bytes())
                return
            except Exception:
                pass


def load_sites():
    sites = read_json(SITES_FILE, {})
    if not sites:
        sites = {
            "기본 현장": {
                "offset": 0.0,
                "note": ""
            }
        }
        write_json(SITES_FILE, sites)
    return sites


def save_sites(sites):
    write_json(SITES_FILE, sites)


def select_roi(image_path, title):
    img = cv2.imread(str(image_path))
    if img is None:
        raise RuntimeError(f"사진을 읽을 수 없습니다:\n{image_path}")

    h, w = img.shape[:2]
    max_w, max_h = 1200, 760
    scale = min(max_w / w, max_h / h, 1.0)

    if scale < 1.0:
        disp = cv2.resize(
            img,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_AREA
        )
    else:
        disp = img.copy()

    cv2.namedWindow(title, cv2.WINDOW_NORMAL)
    r = cv2.selectROI(
        title, disp,
        showCrosshair=True,
        fromCenter=False
    )
    cv2.destroyWindow(title)

    x, y, rw, rh = [int(v) for v in r]
    if rw < 4 or rh < 4:
        return None

    if scale != 1.0:
        x = int(round(x / scale))
        y = int(round(y / scale))
        rw = int(round(rw / scale))
        rh = int(round(rh / scale))

    x = max(0, min(w - 1, x))
    y = max(0, min(h - 1, y))
    rw = max(1, min(w - x, rw))
    rh = max(1, min(h - y, rh))

    return [x, y, rw, rh]


def roi_to_normalized(image_path, roi):
    img = cv2.imread(str(image_path))
    if img is None:
        raise RuntimeError("사진을 읽을 수 없습니다.")
    h, w = img.shape[:2]
    x, y, rw, rh = roi
    return [x / w, y / h, rw / w, rh / h]


def normalized_to_roi(image_path, norm):
    img = cv2.imread(str(image_path))
    if img is None:
        raise RuntimeError("사진을 읽을 수 없습니다.")
    h, w = img.shape[:2]
    rx, ry, rw, rh = norm
    x = max(0, min(w - 1, int(w * rx)))
    y = max(0, min(h - 1, int(h * ry)))
    ww = max(1, min(w - x, int(w * rw)))
    hh = max(1, min(h - y, int(h * rh)))
    return [x, y, ww, hh]


def extract_lab_from_roi(image_path, roi):
    img = cv2.imread(str(image_path))
    if img is None:
        raise RuntimeError(f"사진을 읽을 수 없습니다:\n{image_path}")

    x, y, w, h = roi
    H, W = img.shape[:2]

    x = max(0, min(W - 1, x))
    y = max(0, min(H - 1, y))
    w = max(1, min(W - x, w))
    h = max(1, min(H - y, h))

    crop = img[y:y+h, x:x+w]
    if crop.size == 0:
        raise RuntimeError("선택한 영역이 비어 있습니다.")

    ch, cw = crop.shape[:2]
    px = max(1, int(cw * 0.08))
    py = max(1, int(ch * 0.08))

    if cw > px * 2 + 4 and ch > py * 2 + 4:
        crop2 = crop[py:ch-py, px:cw-px]
    else:
        crop2 = crop

    lab = cv2.cvtColor(crop2, cv2.COLOR_BGR2LAB)

    L = float(np.median(lab[:, :, 0]))
    a = float(np.median(lab[:, :, 1]))
    b = float(np.median(lab[:, :, 2]))

    Bc = int(np.median(crop2[:, :, 0]))
    Gc = int(np.median(crop2[:, :, 1]))
    Rc = int(np.median(crop2[:, :, 2]))
    hex_color = f"#{Rc:02x}{Gc:02x}{Bc:02x}"

    flat = lab.reshape(-1, 3).astype(float)
    center = np.array([L, a, b], dtype=float)
    uniformity = float(
        np.median(
            np.sqrt(np.sum((flat - center) ** 2, axis=1))
        )
    )

    return L, a, b, hex_color, uniformity


def load_training_rows():
    rows = []
    if not TRAIN_FILE.exists():
        return rows

    with open(TRAIN_FILE, "r", encoding="utf-8-sig", newline="") as f:
        rd = csv.DictReader(f)
        for r in rd:
            try:
                rows.append({
                    "ph": float(r["ph"]),
                    "image_path": r["image_path"],
                    "L": float(r["L"]),
                    "a": float(r["a"]),
                    "b": float(r["b"]),
                    "hex": r.get("hex", "#dddddd"),
                })
            except Exception:
                continue

    return rows


def append_training(ph, image_path, roi, L, a, b, hex_color, uniformity):
    new_file = not TRAIN_FILE.exists()

    with open(TRAIN_FILE, "a", encoding="utf-8-sig", newline="") as f:
        wr = csv.writer(f)

        if new_file:
            wr.writerow([
                "timestamp", "ph", "image_path",
                "roi_x", "roi_y", "roi_w", "roi_h",
                "L", "a", "b", "hex", "uniformity"
            ])

        wr.writerow([
            time.strftime("%Y-%m-%d %H:%M:%S"),
            f"{ph:.4f}",
            str(image_path),
            roi[0], roi[1], roi[2], roi[3],
            f"{L:.4f}", f"{a:.4f}", f"{b:.4f}",
            hex_color,
            f"{uniformity:.4f}"
        ])


def append_result(row):
    new_file = not RESULT_FILE.exists()

    with open(RESULT_FILE, "a", encoding="utf-8-sig", newline="") as f:
        wr = csv.writer(f)

        if new_file:
            wr.writerow([
                "timestamp", "site", "image_path",
                "raw_ph", "site_offset", "site_corrected_ph",
                "manual_adjustment", "final_ph",
                "nearest_ph", "confidence", "color_distance",
                "L", "a", "b", "uniformity"
            ])

        wr.writerow([
            time.strftime("%Y-%m-%d %H:%M:%S"),
            row["site"],
            row["image_path"],
            f'{row["raw_ph"]:.4f}',
            f'{row["site_offset"]:.4f}',
            f'{row["site_corrected_ph"]:.4f}',
            f'{row["manual_adjustment"]:.4f}',
            f'{row["final_ph"]:.4f}',
            f'{row["nearest_ph"]:.4f}',
            row["confidence"],
            f'{row["distance"]:.4f}',
            f'{row["L"]:.4f}',
            f'{row["a"]:.4f}',
            f'{row["b"]:.4f}',
            f'{row["uniformity"]:.4f}',
        ])


def class_stats(rows):
    grouped = {}

    for r in rows:
        grouped.setdefault(r["ph"], []).append(r)

    stats = {}

    for ph, items in grouped.items():
        X = np.array(
            [[r["L"], r["a"], r["b"]] for r in items],
            dtype=float
        )

        center = np.median(X, axis=0)
        dist = np.sqrt(np.sum((X - center) ** 2, axis=1))
        spread = float(np.median(dist)) if len(dist) else 0.0

        stats[ph] = {
            "center": center,
            "spread": spread,
            "count": len(items),
        }

    return stats


def predict_ph(L, a, b, rows):
    stats = class_stats(rows)

    if len(stats) < 2:
        raise RuntimeError(
            "서로 다른 pH 기준값이 최소 2개 이상 필요합니다."
        )

    q = np.array([L, a, b], dtype=float)
    ds = []

    for ph, st in stats.items():
        d = float(
            np.sqrt(np.sum((st["center"] - q) ** 2))
        )
        ds.append((d, ph, st))

    ds.sort(key=lambda x: x[0])
    top = ds[:min(3, len(ds))]

    if top[0][0] < 1e-9:
        pred = float(top[0][1])
    else:
        weights = [
            1.0 / ((d + 1e-6) ** 1.5)
            for d, ph, st in top
        ]

        pred = sum(
            w * ph
            for w, (d, ph, st) in zip(weights, top)
        ) / sum(weights)

    nearest_d, nearest_ph, nearest_st = top[0]
    second_d = (
        top[1][0]
        if len(top) > 1
        else nearest_d + 999.0
    )

    base = max(4.0, nearest_st["spread"] * 2.0)
    separation = second_d / max(nearest_d, 0.5)

    if nearest_d <= base and separation >= 1.35:
        conf = "높음"
    elif nearest_d <= base * 2.5 and separation >= 1.08:
        conf = "보통"
    else:
        conf = "낮음"

    return (
        float(pred),
        float(nearest_ph),
        conf,
        float(nearest_d)
    )


class PHApp:
    def __init__(self, root):
        ensure_dir()
        migrate_old_data()

        self.root = root
        self.root.title(APP_NAME)
        self.root.geometry("1360x920")
        self.root.minsize(1100, 760)

        cfg = read_json(CONFIG_FILE, {})

        self.auto_roi_norm = cfg.get("auto_roi_norm")
        self.watch_folder = Path(
            cfg.get(
                "watch_folder",
                str(Path.home() / "camera_images")
            )
        )

        self.sites = load_sites()
        self.current_site = cfg.get(
            "current_site",
            next(iter(self.sites.keys()))
        )

        if self.current_site not in self.sites:
            self.current_site = next(iter(self.sites.keys()))

        self.current_measurement = None
        self.manual_adjustment = 0.0

        self.monitoring = False
        self.monitor_job = None
        self.processed = set()

        self.site_var = tk.StringVar(value=self.current_site)
        self.site_offset_var = tk.StringVar()
        self.watch_var = tk.StringVar(value=str(self.watch_folder))
        self.auto_roi_var = tk.StringVar(
            value="설정됨"
            if self.auto_roi_norm
            else "아직 설정 안 됨"
        )

        self.raw_ph_var = tk.StringVar(value="--")
        self.site_ph_var = tk.StringVar(value="--")
        self.final_ph_var = tk.StringVar(value="--")
        self.result_info_var = tk.StringVar(
            value="사진을 측정하면 여기에 결과가 표시됩니다."
        )
        self.manual_var = tk.StringVar(value="현재 결과 보정: +0.00")
        self.final_input_var = tk.StringVar(value="")
        self.status_var = tk.StringVar(value="준비됨")

        self.ph_count_vars = {}
        self.ph_swatch_frames = {}

        self.build_ui()
        self.refresh_boxes()
        self.refresh_site_ui()

    def save_cfg(self):
        write_json(
            CONFIG_FILE,
            {
                "auto_roi_norm": self.auto_roi_norm,
                "watch_folder": str(self.watch_folder),
                "current_site": self.current_site,
            }
        )

    def build_ui(self):
        outer = ttk.Frame(self.root, padding=12)
        outer.pack(fill="both", expand=True)

        ttk.Label(
            outer,
            text="pH 현장 보정형 색상 분석기 V5",
            font=("TkDefaultFont", 20, "bold")
        ).pack(anchor="w")

        ttk.Label(
            outer,
            text=(
                "기준색은 계속 저장됩니다. "
                "현장별 보정값은 별도로 저장되고, "
                "측정 직후 결과도 ± 버튼으로 즉시 조정할 수 있습니다."
            )
        ).pack(anchor="w", pady=(2, 10))

        # ---------------------------
        # 현장 프로파일
        # ---------------------------
        site_box = ttk.LabelFrame(
            outer,
            text="0. 현장 프로파일",
            padding=9
        )
        site_box.pack(fill="x")

        ttk.Label(site_box, text="현장:").pack(side="left")

        self.site_combo = ttk.Combobox(
            site_box,
            textvariable=self.site_var,
            values=list(self.sites.keys()),
            state="readonly",
            width=22
        )
        self.site_combo.pack(side="left", padx=5)
        self.site_combo.bind(
            "<<ComboboxSelected>>",
            self.on_site_change
        )

        ttk.Button(
            site_box,
            text="새 현장 등록",
            command=self.add_site
        ).pack(side="left", padx=4)

        ttk.Label(
            site_box,
            textvariable=self.site_offset_var,
            font=("TkDefaultFont", 10, "bold")
        ).pack(side="left", padx=18)

        ttk.Button(
            site_box,
            text="현장 보정값 직접 입력",
            command=self.set_site_offset_direct
        ).pack(side="right", padx=4)

        ttk.Button(
            site_box,
            text="현장 보정값 0으로 초기화",
            command=self.reset_site_offset
        ).pack(side="right", padx=4)

        # ---------------------------
        # 기준색
        # ---------------------------
        train_box = ttk.LabelFrame(
            outer,
            text="1. pH 기준색 학습 - 영구 저장 / 계속 누적",
            padding=9
        )
        train_box.pack(fill="x", pady=(10, 0))

        grid = ttk.Frame(train_box)
        grid.pack(fill="x")

        for ph in range(1, 15):
            col = (ph - 1) % 7
            row = (ph - 1) // 7

            card = tk.Frame(
                grid, bd=1, relief="solid",
                padx=5, pady=5
            )
            card.grid(
                row=row, column=col,
                padx=3, pady=3,
                sticky="nsew"
            )

            tk.Label(
                card,
                text=f"pH {ph}",
                font=("TkDefaultFont", 12, "bold")
            ).pack()

            swatch = tk.Frame(
                card,
                width=88,
                height=22,
                bg="#e5e7eb",
                bd=1,
                relief="sunken"
            )
            swatch.pack(pady=3)
            swatch.pack_propagate(False)

            self.ph_swatch_frames[ph] = swatch

            count_var = tk.StringVar(value="0장")
            self.ph_count_vars[ph] = count_var

            tk.Label(
                card,
                textvariable=count_var
            ).pack()

            tk.Button(
                card,
                text="사진+영역 선택",
                command=lambda p=ph: self.add_reference_images(
                    float(p)
                )
            ).pack(fill="x", pady=(3, 0))

        for c in range(7):
            grid.columnconfigure(c, weight=1)

        train_bottom = ttk.Frame(train_box)
        train_bottom.pack(fill="x", pady=(7, 0))

        ttk.Button(
            train_bottom,
            text="소수점 기준 추가 (예: 7.5)",
            command=self.add_decimal_reference
        ).pack(side="left")

        ttk.Label(
            train_bottom,
            text=(
                "  기준색 데이터는 "
                f"{DATA_DIR} 에 계속 저장됩니다."
            )
        ).pack(side="left")

        ttk.Button(
            train_bottom,
            text="학습 데이터 전체 초기화",
            command=self.clear_training
        ).pack(side="right")

        # ---------------------------
        # 측정 + 즉시 보정
        # ---------------------------
        measure_box = ttk.LabelFrame(
            outer,
            text="2. 사진 측정 + 즉시 보정",
            padding=10
        )
        measure_box.pack(fill="x", pady=10)

        left = ttk.Frame(measure_box)
        left.pack(side="left", fill="y")

        ttk.Button(
            left,
            text="사진 선택하고 바로 측정",
            command=self.measure_manual,
            width=26
        ).pack(pady=(4, 6))

        ttk.Label(
            left,
            text=(
                "측정사진에서 시험지 색 영역을\n"
                "마우스로 선택하면 바로 계산됩니다."
            ),
            justify="left"
        ).pack(anchor="w")

        result = tk.Frame(
            measure_box,
            bd=2,
            relief="groove",
            padx=16,
            pady=9
        )
        result.pack(
            side="left",
            fill="x",
            expand=True,
            padx=(18, 0)
        )

        numbers = ttk.Frame(result)
        numbers.pack(fill="x")

        raw_panel = ttk.Frame(numbers)
        raw_panel.pack(side="left", expand=True, fill="x")

        ttk.Label(
            raw_panel,
            text="기본 예측값"
        ).pack()

        ttk.Label(
            raw_panel,
            textvariable=self.raw_ph_var,
            font=("TkDefaultFont", 22, "bold")
        ).pack()

        site_panel = ttk.Frame(numbers)
        site_panel.pack(side="left", expand=True, fill="x")

        ttk.Label(
            site_panel,
            text="현장보정 적용"
        ).pack()

        ttk.Label(
            site_panel,
            textvariable=self.site_ph_var,
            font=("TkDefaultFont", 22, "bold")
        ).pack()

        final_panel = ttk.Frame(numbers)
        final_panel.pack(side="left", expand=True, fill="x")

        ttk.Label(
            final_panel,
            text="최종 표시값",
            font=("TkDefaultFont", 11, "bold")
        ).pack()

        ttk.Label(
            final_panel,
            textvariable=self.final_ph_var,
            font=("TkDefaultFont", 34, "bold")
        ).pack()

        ttk.Separator(
            result,
            orient="horizontal"
        ).pack(fill="x", pady=7)

        ttk.Label(
            result,
            textvariable=self.manual_var,
            font=("TkDefaultFont", 10, "bold")
        ).pack()

        adjust = ttk.Frame(result)
        adjust.pack(pady=5)

        for label, delta in [
            ("-0.5", -0.5),
            ("-0.1", -0.1),
            ("원복", 0.0),
            ("+0.1", 0.1),
            ("+0.5", 0.5),
        ]:
            if label == "원복":
                cmd = self.reset_manual_adjustment
            else:
                cmd = lambda d=delta: self.adjust_current(d)

            ttk.Button(
                adjust,
                text=label,
                command=cmd,
                width=8
            ).pack(side="left", padx=3)

        direct = ttk.Frame(result)
        direct.pack(pady=(4, 2))

        ttk.Label(
            direct,
            text="최종 표시값 직접 입력:"
        ).pack(side="left", padx=(0, 5))

        final_entry = ttk.Entry(
            direct,
            textvariable=self.final_input_var,
            width=10
        )
        final_entry.pack(side="left", padx=3)
        final_entry.bind(
            "<Return>",
            lambda event: self.apply_direct_final_value()
        )

        ttk.Button(
            direct,
            text="입력값 적용",
            command=self.apply_direct_final_value
        ).pack(side="left", padx=4)

        ttk.Label(
            direct,
            text="예: 7.20"
        ).pack(side="left", padx=4)

        action = ttk.Frame(result)
        action.pack(pady=(4, 0))

        ttk.Button(
            action,
            text="이 조정값을 현장보정으로 저장",
            command=self.save_manual_as_site_offset
        ).pack(side="left", padx=4)

        ttk.Button(
            action,
            text="현재 결과만 저장",
            command=self.save_current_result
        ).pack(side="left", padx=4)

        ttk.Label(
            result,
            textvariable=self.result_info_var
        ).pack(pady=(6, 0))

        # ---------------------------
        # 자동 폴더
        # ---------------------------
        auto_box = ttk.LabelFrame(
            outer,
            text="3. 자동 폴더 측정",
            padding=9
        )
        auto_box.pack(fill="x")

        auto_top = ttk.Frame(auto_box)
        auto_top.pack(fill="x")

        ttk.Label(
            auto_top,
            text="자동 측정영역:"
        ).pack(side="left")

        ttk.Label(
            auto_top,
            textvariable=self.auto_roi_var,
            font=("TkDefaultFont", 10, "bold")
        ).pack(side="left", padx=5)

        ttk.Button(
            auto_top,
            text="자동 측정영역 설정",
            command=self.set_auto_roi
        ).pack(side="left", padx=8)

        folder_row = ttk.Frame(auto_box)
        folder_row.pack(fill="x", pady=(7, 0))

        ttk.Entry(
            folder_row,
            textvariable=self.watch_var
        ).pack(side="left", fill="x", expand=True)

        ttk.Button(
            folder_row,
            text="폴더 선택",
            command=self.choose_folder
        ).pack(side="left", padx=5)

        ttk.Button(
            folder_row,
            text="새 사진 1회 측정",
            command=self.measure_folder_once
        ).pack(side="left", padx=5)

        self.monitor_btn = ttk.Button(
            folder_row,
            text="자동 감시 시작",
            command=self.toggle_monitor
        )
        self.monitor_btn.pack(side="left")

        # ---------------------------
        # 측정 기록
        # ---------------------------
        history = ttk.LabelFrame(
            outer,
            text="측정 기록",
            padding=8
        )
        history.pack(
            fill="both",
            expand=True,
            pady=10
        )

        cols = (
            "site", "file",
            "raw", "site_ph",
            "final", "conf"
        )

        self.tree = ttk.Treeview(
            history,
            columns=cols,
            show="headings",
            height=9
        )

        labels = {
            "site": "현장",
            "file": "사진 파일명",
            "raw": "기본 예측",
            "site_ph": "현장보정",
            "final": "최종값",
            "conf": "신뢰도",
        }

        widths = {
            "site": 140,
            "file": 380,
            "raw": 100,
            "site_ph": 100,
            "final": 100,
            "conf": 90,
        }

        for c in cols:
            self.tree.heading(c, text=labels[c])
            self.tree.column(
                c,
                width=widths[c],
                anchor="center"
            )

        self.tree.column("file", anchor="w")

        self.tree.pack(
            side="left",
            fill="both",
            expand=True
        )

        scroll = ttk.Scrollbar(
            history,
            orient="vertical",
            command=self.tree.yview
        )
        scroll.pack(side="right", fill="y")
        self.tree.configure(
            yscrollcommand=scroll.set
        )

        bottom = ttk.Frame(outer)
        bottom.pack(fill="x")

        ttk.Label(
            bottom,
            textvariable=self.status_var
        ).pack(side="left")

        ttk.Button(
            bottom,
            text="데이터 저장 폴더 보기",
            command=self.show_paths
        ).pack(side="right")

    # ---------------------------
    # 현장
    # ---------------------------
    def refresh_site_ui(self):
        offset = float(
            self.sites[self.current_site].get(
                "offset", 0.0
            )
        )

        self.site_offset_var.set(
            f"현재 현장 보정값: {offset:+.2f} pH"
        )

        self.site_combo["values"] = list(
            self.sites.keys()
        )
        self.site_var.set(self.current_site)

        self.update_current_display()

    def on_site_change(self, event=None):
        name = self.site_var.get()

        if name in self.sites:
            self.current_site = name
            self.manual_adjustment = 0.0
            self.save_cfg()
            self.refresh_site_ui()
            self.status_var.set(
                f"현장 변경: {name}"
            )

    def add_site(self):
        name = simpledialog.askstring(
            "새 현장 등록",
            "현장 이름을 입력하세요.\n예: 터널 A현장",
            parent=self.root
        )

        if not name:
            return

        name = name.strip()

        if not name:
            return

        if name in self.sites:
            messagebox.showwarning(
                "중복",
                "이미 같은 이름의 현장이 있습니다."
            )
            return

        self.sites[name] = {
            "offset": 0.0,
            "note": ""
        }

        save_sites(self.sites)

        self.current_site = name
        self.manual_adjustment = 0.0
        self.save_cfg()
        self.refresh_site_ui()

    def set_site_offset_direct(self):
        current = float(
            self.sites[self.current_site].get(
                "offset", 0.0
            )
        )

        value = simpledialog.askfloat(
            "현장 보정값",
            (
                "모든 측정값에 더할 보정값을 입력하세요.\n"
                "예: 기본값이 0.20 높게 나오면 -0.20 입력"
            ),
            initialvalue=current,
            minvalue=-3.0,
            maxvalue=3.0,
            parent=self.root
        )

        if value is None:
            return

        self.sites[self.current_site]["offset"] = float(
            value
        )

        save_sites(self.sites)
        self.manual_adjustment = 0.0
        self.refresh_site_ui()

    def reset_site_offset(self):
        self.sites[self.current_site]["offset"] = 0.0
        save_sites(self.sites)

        self.manual_adjustment = 0.0
        self.refresh_site_ui()

    # ---------------------------
    # 기준색
    # ---------------------------
    def refresh_boxes(self):
        rows = load_training_rows()

        grouped = {}

        for r in rows:
            rounded = int(round(r["ph"]))

            if 1 <= rounded <= 14:
                grouped.setdefault(
                    rounded, []
                ).append(r)

        for ph in range(1, 15):
            items = grouped.get(ph, [])

            self.ph_count_vars[ph].set(
                f"{len(items)}장"
            )

            if not items:
                self.ph_swatch_frames[ph].configure(
                    bg="#e5e7eb"
                )
                continue

            rgbs = []

            for r in items:
                hx = r.get("hex", "")

                try:
                    rgbs.append([
                        int(hx[1:3], 16),
                        int(hx[3:5], 16),
                        int(hx[5:7], 16)
                    ])
                except Exception:
                    pass

            if rgbs:
                med = np.median(
                    np.array(rgbs),
                    axis=0
                ).astype(int)

                hx = (
                    f"#{med[0]:02x}"
                    f"{med[1]:02x}"
                    f"{med[2]:02x}"
                )

                self.ph_swatch_frames[ph].configure(
                    bg=hx
                )

    def add_reference_images(self, ph_value):
        paths = filedialog.askopenfilenames(
            title=f"pH {ph_value:g} 기준사진 선택",
            filetypes=IMAGE_TYPES
        )

        if not paths:
            return

        ok = 0

        for p in paths:
            try:
                self.status_var.set(
                    (
                        f"pH {ph_value:g} / "
                        f"{Path(p).name}: "
                        "색 영역을 선택하세요."
                    )
                )

                self.root.update_idletasks()

                roi = select_roi(
                    p,
                    (
                        f"pH {ph_value:g} "
                        "- SELECT COLOR AREA "
                        "- Enter to confirm"
                    )
                )

                if roi is None:
                    continue

                L, a, b, hx, uniformity = (
                    extract_lab_from_roi(
                        p, roi
                    )
                )

                append_training(
                    ph_value,
                    p,
                    roi,
                    L, a, b,
                    hx,
                    uniformity
                )

                ok += 1

            except Exception as e:
                messagebox.showwarning(
                    "사진 처리 오류",
                    f"{Path(p).name}\n{e}"
                )

        self.refresh_boxes()

        self.status_var.set(
            (
                f"pH {ph_value:g} 기준사진 "
                f"{ok}장 저장 완료"
            )
        )

    def add_decimal_reference(self):
        ph_value = simpledialog.askfloat(
            "소수점 pH 기준 추가",
            (
                "실제 기준 pH를 입력하세요.\n"
                "예: 7.5"
            ),
            minvalue=0.0,
            maxvalue=14.0,
            parent=self.root
        )

        if ph_value is None:
            return

        self.add_reference_images(
            float(ph_value)
        )

    def clear_training(self):
        if not messagebox.askyesno(
            "초기화",
            (
                "저장된 모든 pH 기준색 데이터를 "
                "정말 삭제할까요?"
            )
        ):
            return

        if TRAIN_FILE.exists():
            TRAIN_FILE.unlink()

        self.refresh_boxes()
        self.status_var.set(
            "기준색 데이터 초기화 완료"
        )

    # ---------------------------
    # 측정
    # ---------------------------
    def calculate_measurement(self, image_path, roi):
        rows = load_training_rows()

        if len({r["ph"] for r in rows}) < 2:
            raise RuntimeError(
                (
                    "먼저 서로 다른 pH 기준값을 "
                    "최소 2개 이상 저장하세요."
                )
            )

        L, a, b, hx, uniformity = (
            extract_lab_from_roi(
                image_path, roi
            )
        )

        raw, nearest, conf, dist = predict_ph(
            L, a, b, rows
        )

        if uniformity > 25 and conf == "높음":
            conf = "보통"
        elif uniformity > 40:
            conf = "낮음"

        site_offset = float(
            self.sites[self.current_site].get(
                "offset", 0.0
            )
        )

        self.manual_adjustment = 0.0
        self.final_input_var.set("")

        self.current_measurement = {
            "site": self.current_site,
            "image_path": str(image_path),
            "raw_ph": raw,
            "site_offset": site_offset,
            "site_corrected_ph": raw + site_offset,
            "manual_adjustment": 0.0,
            "final_ph": raw + site_offset,
            "nearest_ph": nearest,
            "confidence": conf,
            "distance": dist,
            "L": L,
            "a": a,
            "b": b,
            "uniformity": uniformity,
        }

        self.update_current_display()
        self.status_var.set(
            (
                f"{Path(image_path).name} → "
                f"pH {self.current_measurement['final_ph']:.2f}"
            )
        )

        return self.current_measurement

    def update_current_display(self):
        if not self.current_measurement:
            self.raw_ph_var.set("--")
            self.site_ph_var.set("--")
            self.final_ph_var.set("--")
            self.manual_var.set(
                "현재 결과 보정: +0.00"
            )
            return

        site_offset = float(
            self.sites[self.current_site].get(
                "offset", 0.0
            )
        )

        raw = self.current_measurement["raw_ph"]
        site_ph = raw + site_offset
        final = site_ph + self.manual_adjustment

        self.current_measurement["site"] = (
            self.current_site
        )
        self.current_measurement["site_offset"] = (
            site_offset
        )
        self.current_measurement[
            "site_corrected_ph"
        ] = site_ph
        self.current_measurement[
            "manual_adjustment"
        ] = self.manual_adjustment
        self.current_measurement["final_ph"] = final

        self.raw_ph_var.set(
            f"{raw:.2f}"
        )
        self.site_ph_var.set(
            f"{site_ph:.2f}"
        )
        self.final_ph_var.set(
            f"{final:.2f}"
        )

        self.manual_var.set(
            (
                "현재 결과 보정: "
                f"{self.manual_adjustment:+.2f}"
            )
        )

        self.result_info_var.set(
            (
                f"신뢰도 {self.current_measurement['confidence']}  |  "
                f"가장 가까운 기준 "
                f"pH {self.current_measurement['nearest_ph']:.2f}  |  "
                f"색거리 {self.current_measurement['distance']:.2f}"
            )
        )

    def measure_manual(self):
        paths = filedialog.askopenfilenames(
            title="측정할 사진 선택",
            filetypes=IMAGE_TYPES
        )

        if not paths:
            return

        for p in paths:
            try:
                self.status_var.set(
                    (
                        f"{Path(p).name}: "
                        "시험지 색 영역을 선택하세요."
                    )
                )

                self.root.update_idletasks()

                roi = select_roi(
                    p,
                    (
                        "MEASUREMENT "
                        "- SELECT COLOR AREA "
                        "- Enter to confirm"
                    )
                )

                if roi is None:
                    continue

                self.calculate_measurement(
                    p, roi
                )

            except Exception as e:
                messagebox.showerror(
                    "측정 오류",
                    f"{Path(p).name}\n{e}"
                )

    def apply_direct_final_value(self):
        if not self.current_measurement:
            messagebox.showinfo(
                "측정값 없음",
                "먼저 사진을 측정하세요."
            )
            return

        raw_text = self.final_input_var.get().strip()

        try:
            target = float(raw_text)
        except Exception:
            messagebox.showwarning(
                "입력 확인",
                "최종 표시값을 숫자로 입력하세요.\n예: 7.20"
            )
            return

        if target < 0.0 or target > 14.0:
            messagebox.showwarning(
                "입력 확인",
                "pH 값은 0~14 범위로 입력하세요."
            )
            return

        site_offset = float(
            self.sites[self.current_site].get(
                "offset", 0.0
            )
        )

        site_value = (
            self.current_measurement["raw_ph"]
            + site_offset
        )

        self.manual_adjustment = round(
            target - site_value,
            3
        )

        self.update_current_display()
        self.status_var.set(
            f"최종 표시값을 pH {target:.2f}로 맞췄습니다."
        )

    def adjust_current(self, delta):
        if not self.current_measurement:
            messagebox.showinfo(
                "측정값 없음",
                "먼저 사진을 측정하세요."
            )
            return

        self.manual_adjustment += float(delta)
        self.manual_adjustment = round(
            self.manual_adjustment, 2
        )

        self.update_current_display()

    def reset_manual_adjustment(self):
        self.manual_adjustment = 0.0
        self.final_input_var.set("")
        self.update_current_display()

    def save_manual_as_site_offset(self):
        if not self.current_measurement:
            messagebox.showinfo(
                "측정값 없음",
                "먼저 사진을 측정하세요."
            )
            return

        if abs(self.manual_adjustment) < 1e-9:
            messagebox.showinfo(
                "조정값 없음",
                (
                    "먼저 ±0.1 / ±0.5 버튼으로 "
                    "현재 결과를 조정하세요."
                )
            )
            return

        old_offset = float(
            self.sites[self.current_site].get(
                "offset", 0.0
            )
        )

        new_offset = (
            old_offset
            + self.manual_adjustment
        )

        if not messagebox.askyesno(
            "현장 보정값 저장",
            (
                f"현장: {self.current_site}\n\n"
                f"기존 보정: {old_offset:+.2f}\n"
                f"추가 보정: {self.manual_adjustment:+.2f}\n"
                f"새 보정값: {new_offset:+.2f}\n\n"
                "앞으로 이 현장의 모든 측정값에 "
                "이 보정값을 적용할까요?"
            )
        ):
            return

        self.sites[self.current_site]["offset"] = (
            new_offset
        )

        save_sites(self.sites)

        self.manual_adjustment = 0.0

        self.refresh_site_ui()

        self.status_var.set(
            (
                f"{self.current_site} 보정값 "
                f"{new_offset:+.2f} 저장 완료"
            )
        )

    def save_current_result(self):
        if not self.current_measurement:
            messagebox.showinfo(
                "측정값 없음",
                "먼저 사진을 측정하세요."
            )
            return

        self.update_current_display()
        append_result(
            self.current_measurement
        )

        row = self.current_measurement

        self.tree.insert(
            "", 0,
            values=(
                row["site"],
                Path(row["image_path"]).name,
                f'{row["raw_ph"]:.2f}',
                f'{row["site_corrected_ph"]:.2f}',
                f'{row["final_ph"]:.2f}',
                row["confidence"],
            )
        )

        self.status_var.set(
            (
                f"최종 결과 저장: "
                f"pH {row['final_ph']:.2f}"
            )
        )

    # ---------------------------
    # 자동 측정
    # ---------------------------
    def set_auto_roi(self):
        path = filedialog.askopenfilename(
            title="자동 측정영역 설정용 사진 선택",
            filetypes=IMAGE_TYPES
        )

        if not path:
            return

        try:
            roi = select_roi(
                path,
                (
                    "AUTO MODE "
                    "- SELECT FIXED COLOR AREA "
                    "- Enter to confirm"
                )
            )

            if roi is None:
                return

            self.auto_roi_norm = roi_to_normalized(
                path, roi
            )

            self.auto_roi_var.set("설정됨")
            self.save_cfg()

            messagebox.showinfo(
                "자동 측정영역 저장",
                (
                    "자동 측정에서는 모든 사진의 "
                    "같은 위치를 읽습니다.\n"
                    "카메라와 시험지 위치를 고정하세요."
                )
            )

        except Exception as e:
            messagebox.showerror(
                "오류", str(e)
            )

    def choose_folder(self):
        d = filedialog.askdirectory(
            title="카메라 사진 저장 폴더 선택"
        )

        if not d:
            return

        self.watch_folder = Path(d)
        self.watch_var.set(
            str(self.watch_folder)
        )
        self.save_cfg()

    def folder_files(self):
        typed = self.watch_var.get().strip()

        if typed:
            self.watch_folder = Path(typed)
            self.save_cfg()

        if not self.watch_folder.exists():
            raise RuntimeError(
                f"폴더가 없습니다:\n{self.watch_folder}"
            )

        files = [
            p
            for p in self.watch_folder.iterdir()
            if (
                p.is_file()
                and p.suffix.lower() in IMAGE_EXTS
            )
        ]

        return sorted(
            files,
            key=lambda p: p.stat().st_mtime
        )

    def analyze_auto_file(self, p):
        if not self.auto_roi_norm:
            raise RuntimeError(
                (
                    "먼저 자동 측정영역을 "
                    "설정하세요."
                )
            )

        roi = normalized_to_roi(
            p,
            self.auto_roi_norm
        )

        row = self.calculate_measurement(
            p, roi
        )

        # 자동모드에서는 수동 보정 0 상태로 자동 저장
        append_result(row)

        self.tree.insert(
            "", 0,
            values=(
                row["site"],
                Path(row["image_path"]).name,
                f'{row["raw_ph"]:.2f}',
                f'{row["site_corrected_ph"]:.2f}',
                f'{row["final_ph"]:.2f}',
                row["confidence"],
            )
        )

        self.processed.add(str(p))
        return row

    def measure_folder_once(self):
        try:
            files = self.folder_files()

            if not self.auto_roi_norm:
                raise RuntimeError(
                    (
                        "먼저 자동 측정영역을 "
                        "설정하세요."
                    )
                )

            ok = 0

            for p in files:
                if str(p) in self.processed:
                    continue

                self.analyze_auto_file(p)
                ok += 1

            self.status_var.set(
                f"새 사진 {ok}장 측정 완료"
            )

        except Exception as e:
            messagebox.showerror(
                "자동 측정 오류",
                str(e)
            )

    def toggle_monitor(self):
        if self.monitoring:
            self.stop_monitor()
        else:
            self.start_monitor()

    def start_monitor(self):
        try:
            self.folder_files()

            if not self.auto_roi_norm:
                raise RuntimeError(
                    (
                        "먼저 자동 측정영역을 "
                        "설정하세요."
                    )
                )

            rows = load_training_rows()

            if len({r["ph"] for r in rows}) < 2:
                raise RuntimeError(
                    "먼저 pH 기준색을 저장하세요."
                )

        except Exception as e:
            messagebox.showerror(
                "시작 불가",
                str(e)
            )
            return

        self.monitoring = True

        self.monitor_btn.configure(
            text="자동 감시 중지"
        )

        self.status_var.set(
            "자동 감시 중 - 10초마다 새 사진 확인"
        )

        self.monitor_tick()

    def stop_monitor(self):
        self.monitoring = False

        if self.monitor_job:
            try:
                self.root.after_cancel(
                    self.monitor_job
                )
            except Exception:
                pass

            self.monitor_job = None

        self.monitor_btn.configure(
            text="자동 감시 시작"
        )

    def monitor_tick(self):
        if not self.monitoring:
            return

        try:
            for p in self.folder_files():
                if str(p) in self.processed:
                    continue

                if (
                    time.time()
                    - p.stat().st_mtime
                    < 2
                ):
                    continue

                try:
                    self.analyze_auto_file(p)

                except Exception as e:
                    self.status_var.set(
                        (
                            f"자동 분석 오류: "
                            f"{p.name} / {e}"
                        )
                    )

        except Exception as e:
            self.status_var.set(
                f"폴더 감시 오류: {e}"
            )

        if self.monitoring:
            self.monitor_job = self.root.after(
                10000,
                self.monitor_tick
            )

    def show_paths(self):
        messagebox.showinfo(
            "데이터 저장 위치",
            (
                f"데이터 폴더:\n{DATA_DIR}\n\n"
                f"기준색:\n{TRAIN_FILE}\n\n"
                f"현장 프로파일:\n{SITES_FILE}\n\n"
                f"측정결과:\n{RESULT_FILE}"
            )
        )


def main():
    root = tk.Tk()
    app = PHApp(root)

    def close_app():
        app.stop_monitor()
        root.destroy()

    root.protocol(
        "WM_DELETE_WINDOW",
        close_app
    )

    root.mainloop()


if __name__ == "__main__":
    main()
