#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成软著/应用商店用前端源代码 PDF（每页 50 行非空行，超 3000 行取前 60 页）。"""

from __future__ import annotations

import sys
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
OUT_DIR = ROOT / "docs"
OUT_PDF = OUT_DIR / "行境-前端源代码文档.pdf"

LINES_PER_PAGE = 50
MAX_PAGES_FULL = 60
MAX_LINES_FULL = LINES_PER_PAGE * MAX_PAGES_FULL  # 3000

SOURCE_ROOTS = [
    APP / "App.uvue",
    APP / "store",
    APP / "utils",
    APP / "pages" / "splash",
    APP / "pages" / "auth",
    APP / "pages" / "run",
]

FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\msyh.ttc"),
    Path(r"C:\Windows\Fonts\msyhbd.ttc"),
    Path(r"C:\Windows\Fonts\simsun.ttc"),
    Path("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
    Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
]


def collect_files() -> list[Path]:
    files: list[Path] = []
    for item in SOURCE_ROOTS:
        if item.is_file():
            files.append(item)
        elif item.is_dir():
            for p in sorted(item.rglob("*")):
                if p.suffix in (".uvue", ".uts") and p.is_file():
                    files.append(p)
    seen: set[Path] = set()
    ordered: list[Path] = []
    for p in files:
        rp = p.resolve()
        if rp not in seen:
            seen.add(rp)
            ordered.append(p)
    return ordered


def count_non_blank(fp: Path) -> int:
    text = fp.read_text(encoding="utf-8", errors="replace")
    return sum(1 for line in text.splitlines() if line.strip())


def sanitize_line(line: str) -> str:
    """去掉 PDF 字体不支持的字符（emoji、制表符等）。"""
    line = line.replace("\t", "    ")
    out: list[str] = []
    for ch in line:
        o = ord(ch)
        if o < 0x20 and ch not in "\n\r":
            continue
        if 0x1F300 <= o <= 0x1FAFF or o in (0xFE0F, 0x2757, 0x26A0):
            continue
        if o < 0x10000:
            out.append(ch)
    return "".join(out)


def load_non_blank_lines(files: list[Path], limit: int) -> list[str]:
    lines: list[str] = []
    for fp in files:
        rel = fp.relative_to(APP).as_posix()
        lines.append(f"// ========== {rel} ==========")
        text = fp.read_text(encoding="utf-8", errors="replace")
        for raw in text.splitlines():
            if raw.strip():
                lines.append(sanitize_line(raw.rstrip("\r")))
            if len(lines) >= limit:
                return lines[:limit]
    return lines[:limit]


def find_font() -> Path:
    for p in FONT_CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError(
        "未找到支持中文的字体，请安装微软雅黑或把 .ttf/.ttc 路径加入 FONT_CANDIDATES"
    )


class SourceDocPDF(FPDF):
    def __init__(self, total_pages: int) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.doc_total_pages = total_pages

    def header(self) -> None:
        self.set_font("CN", "", 9)
        self.cell(0, 6, "行境（uni-app x）前端源代码摘录", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_font("CN", "", 8)
        self.cell(
            0,
            5,
            f"第 {self.page_no()} 页 / 共 {self.doc_total_pages} 页（每页 {LINES_PER_PAGE} 行，不含空行）",
            align="C",
            new_x="LMARGIN",
            new_y="NEXT",
        )
        self.ln(1)

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("CN", "", 7)
        self.cell(0, 8, "软件名称：行境  |  文档类型：前端源代码", align="C")


def build_pdf(lines: list[str], font_path: Path, total_pages: int) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    pdf = SourceDocPDF(total_pages)
    pdf.set_auto_page_break(auto=False)
    pdf.add_font("CN", "", str(font_path))
    pdf.set_font("CN", "", 7)

    top = pdf.t_margin + 14
    bottom = pdf.h - pdf.b_margin - 10
    line_h = (bottom - top) / LINES_PER_PAGE

    for page_idx in range(total_pages):
        pdf.add_page()
        pdf.set_y(top)
        start = page_idx * LINES_PER_PAGE
        chunk = lines[start : start + LINES_PER_PAGE]
        while len(chunk) < LINES_PER_PAGE:
            chunk.append("")

        for i, content in enumerate(chunk):
            global_no = start + i + 1
            display = content if len(content) <= 96 else content[:93] + "..."
            pdf.set_x(pdf.l_margin)
            pdf.cell(0, line_h, f"{global_no:04d} | " + display, new_x="LMARGIN", new_y="NEXT")

    pdf.output(str(OUT_PDF))


def main() -> int:
    files = collect_files()
    total_src = sum(count_non_blank(fp) for fp in files)

    if total_src > MAX_LINES_FULL:
        excerpt_lines = MAX_LINES_FULL
        total_pages = MAX_PAGES_FULL
    else:
        excerpt_lines = total_src
        total_pages = (excerpt_lines + LINES_PER_PAGE - 1) // LINES_PER_PAGE or 1

    lines = load_non_blank_lines(files, excerpt_lines)

    print("收录: App.uvue, store/, utils/, pages/splash, pages/auth, pages/run")
    print(f"源文件数: {len(files)}")
    print(f"非空行总数: {total_src}")
    if total_src > MAX_LINES_FULL:
        print(f"已按规范摘录前 {MAX_LINES_FULL} 行 → {MAX_PAGES_FULL} 页")
    else:
        print(f"全部摘录 {len(lines)} 行 → {total_pages} 页")
    print(f"输出: {OUT_PDF}")

    build_pdf(lines, find_font(), total_pages)
    print("完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
