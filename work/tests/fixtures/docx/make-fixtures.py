"""Regenerates the Word (.docx) test fixture: original synthetic content only.

Requires python-docx (pip install python-docx). Writes sample.docx next to this file with core
properties (title, author), two Heading 1 chapters, a Heading 2, bold/italic text, accents and
non-Latin scripts, a bulleted list, a table, an embedded PNG and an external hyperlink.
"""
import datetime, struct, zlib
from io import BytesIO
from pathlib import Path

import docx
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.shared import Inches

HERE = Path(__file__).resolve().parent


def png(width, height, rgb):
    row = b'\x00' + bytes(rgb) * width
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(row * height, 9)) + chunk(b'IEND', b'')


def hyperlink(paragraph, url, text):
    rel = paragraph.part.relate_to(url, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    link = OxmlElement('w:hyperlink'); link.set(qn('r:id'), rel)
    run = OxmlElement('w:r'); t = OxmlElement('w:t'); t.text = text; run.append(t); link.append(run)
    paragraph._p.append(link)


def main():
    document = docx.Document()
    props = document.core_properties
    props.title, props.author, props.created = 'The Harbour Notebook', 'Fixture Writer', datetime.datetime(2026, 1, 1)
    document.add_heading('First Chapter: Arrival', level=1)
    p = document.add_paragraph('The ferry reached the harbour at dawn. ')
    p.add_run('Bold words stay bold').bold = True
    p.add_run(' and ')
    p.add_run('italic words stay italic').italic = True
    p.add_run('.')
    document.add_paragraph('Accents survive conversion: café, naïve, façade. Other scripts too: Ελληνικά, Русский, 日本語.')
    for item in ('Rope', 'Lantern', 'Ledger'):
        document.add_paragraph(item, style='List Bullet')
    document.add_picture(BytesIO(png(80, 40, (49, 83, 74))), width=Inches(1.5))
    document.add_heading('Second Chapter: The Tide Table', level=1)
    document.add_heading('Morning', level=2)
    table = document.add_table(rows=3, cols=2)
    for row, (when, height) in enumerate([('Time', 'Height'), ('06:10', '4.2 m'), ('18:40', '4.5 m')]):
        table.cell(row, 0).text, table.cell(row, 1).text = when, height
    p = document.add_paragraph('Tide tables are published by the ')
    hyperlink(p, 'https://example.org/tides', 'harbour office')
    p.add_run('. The notebook ends here.')
    target = HERE / 'sample.docx'
    document.save(target)
    print(target.name, target.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
