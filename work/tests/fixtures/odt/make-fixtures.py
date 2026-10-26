"""Regenerates the OpenDocument text (.odt) test fixture: original synthetic content only.

Requires odfpy (pip install odfpy), an ODF library independent of ThingsBook's converter. Writes
sample.odt next to this file with metadata (title, initial creator, language), a Title paragraph, two
level-1 headings and a level-2 heading, bold/italic/superscript from automatic styles, accents and
non-Latin scripts, a numbered list and a bulleted list, a table with a header row and a spanned cell,
an embedded PNG with a description, an external link, a footnote, and three things the book should
leave out: a generated table of contents, a comment, and a tracked deletion.
"""
import struct, zlib
from pathlib import Path

from odf.opendocument import OpenDocumentText
from odf import dc, meta, office, style, table, text, draw, svg

HERE = Path(__file__).resolve().parent


def png(width, height, rgb):
    row = b'\x00' + bytes(rgb) * width
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(row * height, 9)) + chunk(b'IEND', b'')


def main():
    doc = OpenDocumentText()
    doc.meta.addElement(dc.Title(text='The Lighthouse Keeper’s Ledger'))
    doc.meta.addElement(meta.InitialCreator(text='Odile Fixture'))
    doc.meta.addElement(dc.Language(text='en'))

    title_style = style.Style(name='Title', family='paragraph', displayname='Title')
    doc.styles.addElement(title_style)
    bold = style.Style(name='T1', family='text'); bold.addElement(style.TextProperties(fontweight='bold'))
    italic = style.Style(name='T2', family='text'); italic.addElement(style.TextProperties(fontstyle='italic'))
    superscript = style.Style(name='T3', family='text'); superscript.addElement(style.TextProperties(textposition='super 58%'))
    for s in (bold, italic, superscript):
        doc.automaticstyles.addElement(s)
    numbered = text.ListStyle(name='L1')
    numbered.addElement(text.ListLevelStyleNumber(level='1', numformat='1', numsuffix='.'))
    bullets = text.ListStyle(name='L2')
    bullets.addElement(text.ListLevelStyleBullet(level='1', bulletchar='•'))
    doc.automaticstyles.addElement(numbered); doc.automaticstyles.addElement(bullets)

    body = doc.text
    changes = text.TrackedChanges()
    region = text.ChangedRegion(qattributes={('http://www.w3.org/XML/1998/namespace', 'id'): 'ct1'}); deletion = text.Deletion()
    deletion.addElement(office.ChangeInfo()); deletion.addElement(text.P(text='DELETED-DRAFT-TEXT'))
    region.addElement(deletion); changes.addElement(region); body.addElement(changes)

    body.addElement(text.P(stylename=title_style, text='The Lighthouse Keeper’s Ledger'))
    toc = text.TableOfContent(name='Contents'); toc_body = text.IndexBody()
    toc_body.addElement(text.P(text='GENERATED-TOC-ENTRY 1')); toc.addElement(toc_body); body.addElement(toc)

    body.addElement(text.H(outlinelevel=1, text='First watch'))
    p = text.P(text='The lamp was ')
    p.addElement(text.Span(stylename=bold, text='bright'))
    p.addText(' and the sea was ')
    p.addElement(text.Span(stylename=italic, text='calm'))
    p.addText('. Café, naïve, Ελληνικά, 日本語. Water is H')
    p.addElement(text.Span(stylename=superscript, text='2'))
    p.addText('O, roughly.')
    note = text.Note(id='ftn1', noteclass='footnote')
    note.addElement(text.NoteCitation(text='1'))
    note_body = text.NoteBody(); note_body.addElement(text.P(text='A footnote about the lamp oil.')); note.addElement(note_body)
    p.addElement(note)
    annotation = office.Annotation(); annotation.addElement(text.P(text='PRIVATE-COMMENT')); p.addElement(annotation)
    body.addElement(p)

    steps = text.List(stylename=numbered)
    for item in ('Trim the wick', 'Polish the lens', 'Log the weather'):
        li = text.ListItem(); li.addElement(text.P(text=item)); steps.addElement(li)
    body.addElement(steps)

    body.addElement(text.H(outlinelevel=2, text='Supplies'))
    grid = table.Table(name='Supplies')
    grid.addElement(table.TableColumn(numbercolumnsrepeated=2))
    header = table.TableHeaderRows(); row = table.TableRow()
    for label in ('Item', 'Count'):
        cell = table.TableCell(); cell.addElement(text.P(text=label)); row.addElement(cell)
    header.addElement(row); grid.addElement(header)
    row = table.TableRow()
    for value in ('Oil', '12'):
        cell = table.TableCell(); cell.addElement(text.P(text=value)); row.addElement(cell)
    grid.addElement(row)
    row = table.TableRow(); cell = table.TableCell(numbercolumnsspanned=2); cell.addElement(text.P(text='Spanned total row')); row.addElement(cell)
    row.addElement(table.CoveredTableCell()); grid.addElement(row)
    body.addElement(grid)

    body.addElement(text.H(outlinelevel=1, text='Second watch'))
    href = doc.addPicture('Pictures/lamp.png', 'image/png', png(24, 12, (200, 160, 40)))
    frame = draw.Frame(name='Lamp', width='2cm', height='1cm', anchortype='as-char')
    frame.addElement(draw.Image(href=href)); frame.addElement(svg.Desc(text='the brass lamp'))
    p = text.P(text='Picture: '); p.addElement(frame); body.addElement(p)
    p = text.P(text='See ')
    p.addElement(text.A(href='https://example.org/lighthouses', text='the lighthouse society'))
    p.addText('.')
    body.addElement(p)
    marks = text.List(stylename=bullets)
    for item in ('Fog horn', 'Spare glass'):
        li = text.ListItem(); li.addElement(text.P(text=item)); marks.addElement(li)
    body.addElement(marks)

    doc.save(str(HERE / 'sample.odt'))
    print('wrote', HERE / 'sample.odt')


if __name__ == '__main__':
    main()
