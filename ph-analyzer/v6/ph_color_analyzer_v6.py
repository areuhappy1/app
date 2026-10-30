#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import time
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

import cv2
import numpy as np

import ph_core as core
from ph_core import (
    DATA_DIR, TRAIN_FILE, RESULT_FILE, SITES_FILE, CONFIG_FILE, CV_REPORT_FILE,
    IMAGE_EXTS, MODE_RAW, MODE_WB, METHOD_CURVE, METHOD_KNN,
    ensure_dir, read_json, write_json, load_sites, save_sites,
    imread_any, roi_to_normalized, normalized_to_roi,
    extract_color, load_training_rows, append_training, append_result,
    predict_ph, adjust_confidence,
)

APP_NAME = "pH Color Analyzer v6"
IMAGE_TYPES = [("Image files", "*.jpg *.jpeg *.png *.bmp")]

METHOD_LABELS = {
    METHOD_CURVE: "pH 곡선 투영 (V6 권장)",
    METHOD_KNN: "가까운 기준 3개 평균 (V5 방식)",
}


def select_roi(img, title):
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

    return core.clamp_roi([x, y, rw, rh], w, h)


class PHApp:
    def __init__(self, root):
        ensure_dir()
        migrated = core.migrate_legacy_training()

        self.root = root
        self.root.title(APP_NAME)
        self.root.geometry("1360x920")
        self.root.minsize(1100, 760)

        cfg = read_json(CONFIG_FILE, None)
        if cfg is None:
            # V5 설정(자동영역, 폴더, 현장)을 이어받음
            cfg = read_json(DATA_DIR / "config.json", {})

        self.auto_roi_norm = cfg.get("auto_roi_norm")
        self.auto_ref_norm = cfg.get("auto_ref_norm")
        self.method = cfg.get("method", METHOD_CURVE)
        if self.method not in METHOD_LABELS:
            self.method = METHOD_CURVE
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
        # 이전에 자동 측정한 사진은 재시작 후에도 다시 측정하지 않음
        self.processed = core.load_auto_processed()
        # 분석 실패한 사진은 10초마다 같은 오류를 반복하지 않도록 기억
        self.failed = set()

        self.wb_var = tk.BooleanVar(value=bool(cfg.get("wb_enabled", False)))
        self.method_var = tk.StringVar(value=METHOD_LABELS[self.method])
        self.mode_info_var = tk.StringVar()

        self.site_var = tk.StringVar(value=self.current_site)
        self.site_offset_var = tk.StringVar()
        self.watch_var = tk.StringVar(value=str(self.watch_folder))
        self.auto_roi_var = tk.StringVar()
        self.refresh_auto_roi_label()

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

        if migrated:
            self.status_var.set(
                f"V5 기준색 {migrated}개를 V6 형식으로 변환했습니다 (원본 파일은 그대로 유지)."
            )

    @property
    def mode(self):
        return MODE_WB if self.wb_var.get() else MODE_RAW

    def refresh_auto_roi_label(self):
        if not self.auto_roi_norm:
            text = "아직 설정 안 됨"
        elif self.auto_ref_norm:
            text = "설정됨 (시험지 + 기준 카드)"
        else:
            text = "설정됨 (시험지만, 색 보정 없음)"
        self.auto_roi_var.set(text)

    def save_cfg(self):
        write_json(
            CONFIG_FILE,
            {
                "auto_roi_norm": self.auto_roi_norm,
                "watch_folder": str(self.watch_folder),
                "current_site": self.current_site,
                "auto_ref_norm": self.auto_ref_norm,
                "wb_enabled": bool(self.wb_var.get()),
                "method": self.method,
            }
        )

    def build_ui(self):
        outer = ttk.Frame(self.root, padding=12)
        outer.pack(fill="both", expand=True)

        ttk.Label(
            outer,
            text="pH 현장 보정형 색상 분석기 V6",
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
            text="1. pH 기준색 학습 - 영구 저장 / 계속 누적 (색 보정 사용 여부별로 따로 저장)",
            padding=9
        )
        train_box.pack(fill="x", pady=(10, 0))

        opt = ttk.Frame(train_box)
        opt.pack(fill="x", pady=(0, 7))

        ttk.Checkbutton(
            opt,
            text="흰색/회색 기준 카드로 색 보정 (권장)",
            variable=self.wb_var,
            command=self.on_mode_change
        ).pack(side="left")

        ttk.Label(
            opt,
            textvariable=self.mode_info_var
        ).pack(side="left", padx=10)

        ttk.Button(
            opt,
            text="정확도 검사 (교차검증)",
            command=self.run_accuracy_check
        ).pack(side="right", padx=4)

        method_combo = ttk.Combobox(
            opt,
            textvariable=self.method_var,
            values=list(METHOD_LABELS.values()),
            state="readonly",
            width=28
        )
        method_combo.pack(side="right", padx=4)
        method_combo.bind(
            "<<ComboboxSelected>>",
            self.on_method_change
        )

        ttk.Label(opt, text="예측 방식:").pack(side="right")

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
        rows = load_training_rows(self.mode)
        other = len(load_training_rows()) - len(rows)

        self.mode_info_var.set(
            (
                f"현재 모드 기준색 {len(rows)}개"
                + (f" (다른 모드 {other}개는 사용 안 함)" if other else "")
            )
        )

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

                img = imread_any(p)

                roi = select_roi(
                    img,
                    (
                        f"pH {ph_value:g} "
                        "- SELECT COLOR AREA "
                        "- Enter to confirm"
                    )
                )

                if roi is None:
                    continue

                ref_roi = self.select_ref_roi(img)

                if self.wb_var.get() and ref_roi is None:
                    continue

                color = extract_color(img, roi, ref_roi)

                append_training(
                    ph_value,
                    p,
                    roi,
                    ref_roi,
                    self.mode,
                    color
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

    def select_ref_roi(self, img):
        """색 보정 모드일 때 흰색/회색 기준 카드 영역 선택. 보정 안 쓰면 None."""
        if not self.wb_var.get():
            return None

        self.status_var.set(
            "흰색/회색 기준 카드 영역을 선택하세요."
        )
        self.root.update_idletasks()

        return select_roi(
            img,
            (
                "WHITE/GRAY CARD "
                "- SELECT REFERENCE AREA "
                "- Enter to confirm"
            )
        )

    def on_mode_change(self):
        self.save_cfg()
        self.refresh_boxes()
        self.current_measurement = None
        self.update_current_display()

        if self.wb_var.get():
            msg = (
                "색 보정 모드: 사진마다 시험지 영역을 고른 뒤 "
                "흰색/회색 기준 카드 영역을 한 번 더 고릅니다. "
                "기준색도 이 모드로 다시 등록하세요."
            )
        else:
            msg = "색 보정 없이 측정합니다 (V5와 같은 방식)."

        self.status_var.set(msg)

    def on_method_change(self, event=None):
        label = self.method_var.get()

        for key, text in METHOD_LABELS.items():
            if text == label:
                self.method = key

        self.save_cfg()
        self.status_var.set(f"예측 방식 변경: {label}")

    def run_accuracy_check(self):
        rows = load_training_rows(self.mode)

        if len({r["ph"] for r in rows}) < 3:
            messagebox.showinfo(
                "정확도 검사",
                (
                    "서로 다른 pH 기준값이 3개 이상 있어야 "
                    "검사할 수 있습니다.\n"
                    "pH마다 사진을 여러 장 등록할수록 정확합니다."
                )
            )
            return

        tests = [
            ("ph", "보간 검사: pH 기준 하나를 통째로 빼고 예측 (실전에 가까움)"),
            ("image", "사진 검사: 기준 사진을 한 장씩 빼고 예측"),
        ]

        results = {
            (m, leave): core.cross_validate(rows, m, leave)
            for m in METHOD_LABELS
            for leave, _ in tests
        }
        core.write_cv_report(results)

        lines = []

        # 보간 검사 결과가 있으면 그걸로, 없으면 사진 검사로 권장 방식 결정
        best = None
        for leave, _ in tests:
            scored = [
                (results[(m, leave)]["mae"], m)
                for m in METHOD_LABELS
                if results[(m, leave)]
            ]
            if scored:
                best = min(scored)[1]
                break

        for leave, title in tests:
            lines += [f"■ {title}", ""]

            for m in METHOD_LABELS:
                res = results[(m, leave)]

                if not res:
                    lines += [f"[{METHOD_LABELS[m]}] 검사할 데이터 부족", ""]
                    continue

                worst = max(
                    res["details"],
                    key=lambda d: abs(d["err"])
                )

                lines += [
                    f"[{METHOD_LABELS[m]}]",
                    (
                        f"  평균 오차 ±{res['mae']:.2f} / 최대 ±{res['max_err']:.2f} pH  "
                        f"(±0.2 이내 {res['within_02']:.0%}, ±0.5 이내 {res['within_05']:.0%})"
                    ),
                    (
                        f"  가장 틀린 사진: {Path(worst['image_path']).name} "
                        f"(실제 {worst['ph']:.2f} → 예측 {worst['pred']:.2f})"
                    ),
                    "",
                ]

        if best:
            lines.append(
                f"권장: '{METHOD_LABELS[best]}' "
                "(예측 방식 선택에서 바꿀 수 있음)"
            )

        lines.append(f"\n상세 결과: {CV_REPORT_FILE}")

        messagebox.showinfo(
            "정확도 검사 결과",
            "\n".join(lines)
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
                "정말 삭제할까요?\n"
                "(기존 파일은 백업 파일로 이름이 바뀌어 남습니다)"
            )
        ):
            return

        if TRAIN_FILE.exists():
            backup = TRAIN_FILE.with_name(
                f"ph_training_v6_backup_{time.strftime('%Y%m%d_%H%M%S')}.csv"
            )
            TRAIN_FILE.replace(backup)

        self.refresh_boxes()
        self.status_var.set(
            "기준색 데이터 초기화 완료"
        )

    # ---------------------------
    # 측정
    # ---------------------------
    def calculate_measurement(self, image_path, roi, img=None, ref_roi=None):
        rows = load_training_rows(self.mode)

        if len({r["ph"] for r in rows}) < 2:
            raise RuntimeError(
                (
                    "먼저 서로 다른 pH 기준값을 "
                    "최소 2개 이상 저장하세요.\n"
                    + (
                        "(색 보정 모드의 기준색은 따로 저장됩니다)"
                        if self.wb_var.get()
                        else ""
                    )
                )
            )

        if self.wb_var.get() and ref_roi is None:
            raise RuntimeError(
                "색 보정 모드에서는 흰색/회색 기준 카드 영역이 필요합니다."
            )

        if img is None:
            img = imread_any(image_path)

        color = extract_color(img, roi, ref_roi)

        pred = predict_ph(
            color["L"], color["a"], color["b"],
            rows, self.method
        )

        conf = adjust_confidence(
            pred["confidence"],
            color["uniformity"],
            color["glare_ratio"]
        )

        site_offset = float(
            self.sites[self.current_site].get(
                "offset", 0.0
            )
        )

        self.manual_adjustment = 0.0
        self.final_input_var.set("")

        raw = pred["ph"]

        self.current_measurement = {
            "source": "manual",
            "site": self.current_site,
            "image_path": str(image_path),
            "mode": self.mode,
            "method": self.method,
            "raw_ph": raw,
            "site_offset": site_offset,
            "site_corrected_ph": raw + site_offset,
            "manual_adjustment": 0.0,
            "final_ph": raw + site_offset,
            "nearest_ph": pred["nearest_ph"],
            "confidence": conf,
            "distance": pred["distance"],
            "out_of_range": pred["out_of_range"],
            "L": color["L"],
            "a": color["a"],
            "b": color["b"],
            "uniformity": color["uniformity"],
            "glare_ratio": color["glare_ratio"],
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

        m = self.current_measurement
        notes = []

        if m["out_of_range"]:
            notes.append("기준색 범위 밖 - 더 낮은/높은 pH 기준 필요")

        if m["glare_ratio"] > 0.3:
            notes.append(f"반사광 {m['glare_ratio']:.0%} 제외됨")

        if m["uniformity"] > 8:
            notes.append("영역 색이 고르지 않음")

        self.result_info_var.set(
            (
                f"신뢰도 {m['confidence']}  |  "
                f"가장 가까운 기준 "
                f"pH {m['nearest_ph']:.2f}  |  "
                f"색차 ΔE {m['distance']:.1f}"
                + ("  |  " + " / ".join(notes) if notes else "")
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

                img = imread_any(p)

                roi = select_roi(
                    img,
                    (
                        "MEASUREMENT "
                        "- SELECT COLOR AREA "
                        "- Enter to confirm"
                    )
                )

                if roi is None:
                    continue

                ref_roi = self.select_ref_roi(img)

                if self.wb_var.get() and ref_roi is None:
                    continue

                self.calculate_measurement(
                    p, roi, img, ref_roi
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
            img = imread_any(path)

            roi = select_roi(
                img,
                (
                    "AUTO MODE "
                    "- SELECT FIXED COLOR AREA "
                    "- Enter to confirm"
                )
            )

            if roi is None:
                return

            ref_roi = self.select_ref_roi(img)

            if self.wb_var.get() and ref_roi is None:
                return

            self.auto_roi_norm = roi_to_normalized(
                img, roi
            )
            self.auto_ref_norm = (
                roi_to_normalized(img, ref_roi)
                if ref_roi
                else None
            )

            self.refresh_auto_roi_label()
            self.save_cfg()

            messagebox.showinfo(
                "자동 측정영역 저장",
                (
                    "자동 측정에서는 모든 사진의 "
                    "같은 위치를 읽습니다.\n"
                    "카메라와 시험지"
                    + (", 기준 카드" if ref_roi else "")
                    + " 위치를 고정하세요."
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

        if self.wb_var.get() and not self.auto_ref_norm:
            raise RuntimeError(
                (
                    "색 보정 모드입니다. 자동 측정영역을 다시 설정해서 "
                    "기준 카드 영역도 지정하세요."
                )
            )

        img = imread_any(p)

        roi = normalized_to_roi(
            img,
            self.auto_roi_norm
        )

        ref_roi = (
            normalized_to_roi(img, self.auto_ref_norm)
            if self.wb_var.get()
            else None
        )

        row = self.calculate_measurement(
            p, roi, img, ref_roi
        )
        row["source"] = "auto"

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
            errors = []

            for p in files:
                if str(p) in self.processed:
                    continue

                try:
                    self.analyze_auto_file(p)
                    ok += 1
                except Exception as e:
                    errors.append(f"{p.name}: {e}")

            self.status_var.set(
                f"새 사진 {ok}장 측정 완료"
                + (f", 실패 {len(errors)}장" if errors else "")
            )

            if errors:
                messagebox.showwarning(
                    "일부 사진 측정 실패",
                    "\n".join(errors[:10])
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

            if self.wb_var.get() and not self.auto_ref_norm:
                raise RuntimeError(
                    (
                        "색 보정 모드입니다. 자동 측정영역을 다시 설정해서 "
                        "기준 카드 영역도 지정하세요."
                    )
                )

            rows = load_training_rows(self.mode)

            if len({r["ph"] for r in rows}) < 2:
                raise RuntimeError(
                    "먼저 현재 모드의 pH 기준색을 저장하세요."
                )

            existing = [
                p for p in self.folder_files()
                if str(p) not in self.processed
            ]

        except Exception as e:
            messagebox.showerror(
                "시작 불가",
                str(e)
            )
            return

        if existing and not messagebox.askyesno(
            "기존 사진",
            (
                f"폴더에 아직 측정하지 않은 사진이 {len(existing)}장 있습니다.\n"
                "이 사진들도 측정할까요?\n\n"
                "[아니요]를 누르면 지금부터 새로 들어오는 사진만 측정합니다."
            )
        ):
            self.processed.update(str(p) for p in existing)

        self.failed.clear()
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
                if str(p) in self.processed or str(p) in self.failed:
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
                    self.failed.add(str(p))
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
                f"측정결과:\n{RESULT_FILE}\n\n"
                f"정확도 검사 결과:\n{CV_REPORT_FILE}"
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
