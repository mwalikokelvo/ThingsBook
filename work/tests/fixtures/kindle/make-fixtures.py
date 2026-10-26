"""Regenerates the Kindle test fixtures from an original, synthetic EPUB.

Requires Calibre's ebook-convert. Writes, next to this file:
  sample.epub        the source (3 chapters, image, CSS, cross-chapter anchor link, TOC, cover)
  sample.mobi        MOBI 6 ("old" Mobipocket)
  sample.azw3        KF8
  sample-combo.mobi  combined MOBI 6 + KF8, as Amazon distributes
All text and images are original test content.
"""
import struct, subprocess, sys, zipfile, zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent


def png(width, height, rgb):
    """A solid-colour RGB PNG, built without imaging libraries."""
    row = b'\x00' + bytes(rgb) * width
    raw = zlib.compress(row * height, 9)
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')


CHAPTERS = [
    ('One', 'The Lantern Keeper', [
        'Mara kept the lantern on the northern pier for eleven winters.',
        'Every evening she trimmed the wick, wrote the weather in her ledger, and counted the boats home.',
        'Accents survive conversion: café, naïve, façade. So do other scripts: Ελληνικά, Русский, 日本語.',
    ], True),
    ('Two', 'The Ledger', [
        'The ledger recorded wind, tide and the names of every vessel that passed the breakwater.',
        'Its last page was blank except for a single line: see the final chapter.',
    ], False),
    ('Three', 'The Final Chapter', [
        'On the last night of the eleventh winter, every boat came home before dark.',
    ], False),
]


def chapter(number, title, paragraphs, first):
    body = ''.join(f'<p>{text}</p>' for text in paragraphs)
    extra = ''
    if first:
        extra = ('<p class="figure"><img src="images/lantern.png" alt="A lantern"/></p>'
                 '<p>Skip ahead to <a href="chapter3.xhtml#ending">the ending</a>.</p>')
    if number == 3:
        body = f'<p id="ending" class="ending">{paragraphs[0]}</p>'
    return f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h1>Chapter {number}: {title}</h1>{body}{extra}</body></html>'''


def build_epub(target):
    files = {
        'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        'OEBPS/style.css': 'h1 { color: #31534a; } .ending { font-style: italic; } .figure { text-align: center; }',
        'OEBPS/images/lantern.png': png(64, 48, (49, 83, 74)),
        'OEBPS/images/cover.png': png(300, 450, (113, 86, 64)),
        'OEBPS/cover.xhtml': '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><img src="images/cover.png" alt="Cover"/></body></html>',
    }
    for i, (_, title, paragraphs, first) in enumerate(CHAPTERS, 1):
        files[f'OEBPS/chapter{i}.xhtml'] = chapter(i, title, paragraphs, first)
    nav_items = ''.join(f'<li><a href="chapter{i}.xhtml">Chapter {i}: {t}</a></li>' for i, (_, t, _, _) in enumerate(CHAPTERS, 1))
    files['OEBPS/nav.xhtml'] = f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>{nav_items}</ol></nav></body></html>'
    manifest = ''.join(f'<item id="c{i}" href="chapter{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(1, 4))
    spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(1, 4))
    files['OEBPS/content.opf'] = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">thingsbook-kindle-fixture</dc:identifier><dc:title>The Lantern Keeper</dc:title><dc:creator>Test Author</dc:creator>
<dc:language>en</dc:language><dc:publisher>Fixture Press</dc:publisher><meta name="cover" content="cover-image"/><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>
<item id="img" href="images/lantern.png" media-type="image/png"/><item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>{manifest}</manifest><spine><itemref idref="cover" linear="no"/>{spine}</spine></package>'''
    with zipfile.ZipFile(target, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        for name, data in files.items():
            z.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)


def main():
    source = HERE / 'sample.epub'
    build_epub(source)
    for name, kind in [('sample.mobi', 'old'), ('sample.azw3', None), ('sample-combo.mobi', 'both')]:
        command = ['ebook-convert', str(source), str(HERE / name)]
        if kind:
            command += ['--mobi-file-type', kind]
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
        print(name, (HERE / name).stat().st_size, 'bytes')


if __name__ == '__main__':
    sys.exit(main())
