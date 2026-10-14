"""Writes a small multi-page PDF (text, outline/ToC, a figure) for testing."""
import sys
import textwrap

out_path = sys.argv[1]

chapters = [
    ("1. The Cell", [
        "The cell is the smallest unit of life that can replicate independently. Every living organism is built from one or more cells, and every cell arises from a pre-existing cell by division.",
        "Cells come in two broad designs. Prokaryotic cells, such as bacteria, lack a nucleus and most membrane-bound organelles. Eukaryotic cells keep their DNA inside a nucleus and divide their interior into specialised compartments.",
        "The plasma membrane is a phospholipid bilayer studded with proteins. It is selectively permeable: small non-polar molecules diffuse across it freely, while ions and large polar molecules need transport proteins.",
    ]),
    ("2. Organelles", [
        "Mitochondria convert the chemical energy of glucose into ATP through cellular respiration. They have their own circular DNA, which supports the endosymbiotic theory of their origin.",
        "The endoplasmic reticulum is a network of membranes. Rough ER is covered in ribosomes and folds secreted proteins; smooth ER synthesises lipids and detoxifies drugs.",
        "The Golgi apparatus modifies, sorts and packages proteins into vesicles. Lysosomes contain hydrolytic enzymes that digest worn-out organelles and engulfed particles.",
        "Chloroplasts, found in plants and algae, capture light energy and fix carbon dioxide into sugars during photosynthesis.",
    ]),
    ("3. Energy and Metabolism", [
        "Metabolism is the sum of all chemical reactions in a cell. Catabolic pathways break molecules down and release energy; anabolic pathways consume energy to build complex molecules.",
        "Enzymes are biological catalysts. They lower the activation energy of a reaction without being consumed, and their activity depends on temperature, pH and the concentration of substrate.",
        "ATP is the energy currency of the cell. Hydrolysing its terminal phosphate bond releases energy that drives transport, movement and biosynthesis.",
    ]),
    ("4. Cell Division", [
        "Mitosis produces two genetically identical daughter cells. Its phases are prophase, metaphase, anaphase and telophase, followed by cytokinesis.",
        "Meiosis produces four haploid gametes. Crossing over during prophase I and independent assortment during metaphase I generate genetic diversity.",
        "Checkpoints in the cell cycle verify DNA integrity before the cell commits to division. Failures of these controls can lead to uncontrolled growth and cancer.",
    ]),
]


def esc(s):
    return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


pages = []  # list of content-stream strings
for i, (title, paras) in enumerate(chapters):
    ops = ["BT", "/F2 20 Tf", "72 720 Td", f"({esc(title)}) Tj", "ET"]
    y = 680
    for p in paras:
        lines = textwrap.wrap(p, 84)
        ops += ["BT", "/F1 11 Tf", "15 TL", f"72 {y} Td"]
        for j, line in enumerate(lines):
            ops.append(f"({esc(line)}) Tj" if j == 0 else f"T* ({esc(line)}) Tj")
        ops.append("ET")
        y -= 15 * len(lines) + 14
    if i == 1:
        # A simple labelled diagram for testing area excerpts.
        y -= 10
        ops += [
            "0.85 0.9 1 rg", f"120 {y - 150} 360 150 re f",
            "0.3 0.45 0.8 RG 2 w", f"120 {y - 150} 360 150 re S",
            "1 0.85 0.5 rg", f"170 {y - 110} 90 60 re f",
            "0.6 0.85 0.6 rg", f"330 {y - 120} 110 80 re f",
            "0 0 0 rg",
            "BT /F1 10 Tf", f"185 {y - 85} Td (Nucleus) Tj ET",
            "BT /F1 10 Tf", f"345 {y - 85} Td (Mitochondrion) Tj ET",
            "BT /F2 11 Tf", f"230 {y - 140} Td (Figure 1. A eukaryotic cell) Tj ET",
        ]
    ops += ["BT", "/F1 9 Tf", "300 40 Td", f"({i + 1}) Tj", "ET"]
    pages.append("\n".join(ops))

objs = {}
n_pages = len(pages)
# 1 catalog, 2 pages, 3 F1, 4 F2, 5 outlines, then per page: page obj, content obj, then outline items
first_page = 6
page_ids = [first_page + 2 * i for i in range(n_pages)]
content_ids = [first_page + 2 * i + 1 for i in range(n_pages)]
outline_ids = [first_page + 2 * n_pages + i for i in range(n_pages)]

objs[1] = "<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R /PageMode /UseOutlines >>"
objs[2] = f"<< /Type /Pages /Kids [{' '.join(f'{p} 0 R' for p in page_ids)}] /Count {n_pages} >>"
objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
objs[5] = f"<< /Type /Outlines /First {outline_ids[0]} 0 R /Last {outline_ids[-1]} 0 R /Count {n_pages} >>"
for i in range(n_pages):
    objs[page_ids[i]] = (
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_ids[i]} 0 R >>"
    )
    data = pages[i].encode('latin-1')
    objs[content_ids[i]] = f"<< /Length {len(data)} >>\nstream\n{pages[i]}\nendstream"
    links = []
    if i > 0:
        links.append(f"/Prev {outline_ids[i - 1]} 0 R")
    if i < n_pages - 1:
        links.append(f"/Next {outline_ids[i + 1]} 0 R")
    objs[outline_ids[i]] = (
        f"<< /Title ({esc(chapters[i][0])}) /Parent 5 0 R {' '.join(links)} "
        f"/Dest [{page_ids[i]} 0 R /XYZ 0 792 0] >>"
    )

out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
offsets = {}
for num in sorted(objs):
    offsets[num] = len(out)
    out += f"{num} 0 obj\n{objs[num]}\nendobj\n".encode('latin-1')
xref = len(out)
count = max(objs) + 1
out += f"xref\n0 {count}\n0000000000 65535 f \n".encode()
for num in range(1, count):
    out += f"{offsets[num]:010d} 00000 n \n".encode()
out += f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
with open(out_path, 'wb') as f:
    f.write(out)
print('wrote', out_path, len(out), 'bytes')
