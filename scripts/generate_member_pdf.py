import requests
import qrcode
import io
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image as RLImage
import os

# ── Supabase から会員取得 ──────────────────────────────────────
def load_service_key():
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                if line.startswith("SUPABASE_SERVICE_KEY="):
                    return line.split("=", 1)[1].strip()
    return os.environ.get("SUPABASE_SERVICE_KEY")

SUPABASE_URL = "https://ggedrhvdqpaorkklpdcw.supabase.co"
SERVICE_KEY  = load_service_key()
if not SERVICE_KEY:
    raise SystemExit(".env.local に SUPABASE_SERVICE_KEY を設定してください")

resp = requests.get(
    f"{SUPABASE_URL}/rest/v1/members",
    headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    },
    params={"select": "member_number,name,customer_type", "order": "member_number.asc"},
)
resp.raise_for_status()
members = resp.json()
print(f"会員数: {len(members)} 名")

# ── 日本語フォント登録 ─────────────────────────────────────────
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msgothic.ttc",
    r"C:\Windows\Fonts\meiryo.ttc",
    r"C:\Windows\Fonts\YuGothM.ttc",
]
font_name = "JpFont"
for path in FONT_CANDIDATES:
    if os.path.exists(path):
        pdfmetrics.registerFont(TTFont(font_name, path))
        print(f"フォント: {path}")
        break
else:
    raise FileNotFoundError("日本語フォントが見つかりません")

# ── QRコード生成ヘルパー ──────────────────────────────────────
def make_qr(text, size_mm=18):
    qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_M,
                        box_size=4, border=1)
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return RLImage(buf, width=size_mm * mm, height=size_mm * mm)

# ── customer_type → 日本語 ─────────────────────────────────────
TYPE_LABEL = {
    "general": "一般",
    "female": "女性",
    "university": "大学生",
    "high_school": "高校生",
}

# ── PDF 生成 ──────────────────────────────────────────────────
OUTPUT = r"C:\claude-cowork\pool_register_system\会員一覧.pdf"
doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=10*mm, rightMargin=10*mm,
    topMargin=12*mm, bottomMargin=12*mm,
)

styles = getSampleStyleSheet()
jp_normal = ParagraphStyle("JpNormal", fontName=font_name, fontSize=9, leading=12)
jp_small  = ParagraphStyle("JpSmall",  fontName=font_name, fontSize=8, leading=10)
jp_title  = ParagraphStyle("JpTitle",  fontName=font_name, fontSize=14, leading=18)

# ヘッダー行
header = [
    Paragraph("会員番号", jp_small),
    Paragraph("氏名", jp_small),
    Paragraph("区分", jp_small),
    Paragraph("QR", jp_small),
]

col_widths = [28*mm, 55*mm, 22*mm, 22*mm]
rows_per_page = 20  # 1ページあたりの行数

story = []
story.append(Paragraph("会員一覧", jp_title))
story.append(Spacer(1, 4*mm))

# チャンク分割（ページをまたぐ大きなテーブルは avoid → 分割して Table を複数）
chunk_size = rows_per_page
for i in range(0, len(members), chunk_size):
    chunk = members[i:i + chunk_size]

    data = [header]
    for m in chunk:
        num = m["member_number"]
        qr_text = f"C{num}"
        row = [
            Paragraph(f"C{num}", jp_small),
            Paragraph(m.get("name") or "", jp_normal),
            Paragraph(TYPE_LABEL.get(m.get("customer_type", ""), ""), jp_small),
            make_qr(qr_text),
        ]
        data.append(row)

    tbl = Table(data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        # ヘッダー背景
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#4a7c9e")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
        # 交互行
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#eef4f9")]),
        # 枠線
        ("GRID",        (0, 0), (-1, -1), 0.4, colors.HexColor("#aaaaaa")),
        ("BOX",         (0, 0), (-1, -1), 0.8, colors.HexColor("#4a7c9e")),
        # 縦位置
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN",       (0, 0), (0, -1), "CENTER"),
        ("ALIGN",       (2, 0), (3, -1), "CENTER"),
        # 行高さ
        ("ROWHEIGHT",   (0, 1), (-1, -1), 20*mm),
        ("ROWHEIGHT",   (0, 0), (-1, 0), 7*mm),
        # パディング
        ("LEFTPADDING",  (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING",   (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
    ]))
    story.append(tbl)
    if i + chunk_size < len(members):
        from reportlab.platypus import PageBreak
        story.append(PageBreak())

doc.build(story)
print(f"PDF出力: {OUTPUT}")
