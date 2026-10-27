"""Regenerates the RTF test fixtures: original synthetic content only.

pandoc.rtf is written by pandoc (pip install pypandoc_binary), a converter independent of ThingsBook's:
headings as \\outlinelevel, \\uN Unicode, bullet and number lists, a table, a HYPERLINK field.
word.rtf is written here in the shape Word and WordPad produce: \\ansicpg1252 with a Cyrillic font
(\\fcharset204) using \\'hh bytes, a stylesheet whose "heading 1"/"heading 2" styles mark headings,
\\info title and author, {\\listtext} bullets, a \\trowd table, a PNG picture inside \\*\\shppict with
\\*\\picprop and \\*\\blipuid groups (and a WMF \\nonshppict fallback that must be ignored), a footnote, a
page header that must be left out, and \\'e9 accents.
"""
import struct, zlib
from pathlib import Path

import pypandoc

HERE = Path(__file__).resolve().parent

MARKDOWN = """# First watch

The lamp was **bright** and the sea *calm*. Café, Ελληνικά, 日本語.

- one
- two

1. trim
2. polish

## Supplies

| Item | Count |
|---|---|
| Oil | 12 |

See [the society](https://example.org/).

# Second watch

End of the pandoc log.
"""


def png(width, height, rgb):
    row = b'\x00' + bytes(rgb) * width
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(row * height, 9)) + chunk(b'IEND', b'')


def word_rtf():
    picture = png(8, 4, (200, 160, 40)).hex()
    cyrillic = ''.join(f"\\'{b:02x}" for b in 'Привет, маяк'.encode('cp1251'))
    return ('{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat\\deflang1033'
            '{\\fonttbl{\\f0\\fswiss\\fcharset0 Calibri;}{\\f1\\froman\\fcharset204 Times New Roman Cyr;}{\\f2\\fnil\\fcharset2 Symbol;}}'
            '{\\colortbl ;\\red0\\green0\\blue255;}'
            '{\\*\\generator Riched20 10.0.19041}'
            '{\\stylesheet{\\s0 Normal;}{\\s1\\b\\fs32 heading 1;}{\\s2\\b\\fs28 heading 2;}{\\*\\cs10 Default Paragraph Font;}}'
            '{\\info{\\title The Lighthouse Ledger}{\\author Wren Fixture}{\\keywords LEAKED-KEYWORDS}{\\creatim\\yr2026\\mo10\\dy27}}'
            '{\\header \\pard\\plain PAGE-HEADER-TEXT\\par}'
            '\\viewkind4\\uc1\n'
            '\\pard\\plain\\s1\\b\\f0\\fs32 First watch\\par\n'
            "\\pard\\plain\\f0\\fs22 The lamp was {\\b bright} and the sea {\\i calm}; caf\\'e9 au lait. "
            "Water is H{\\sub 2}O and x{\\super 2}.{\\super\\chftn{\\footnote\\pard\\plain{\\super\\chftn} A footnote about the lamp oil.\\par}}\\par\n"
            f'\\pard\\plain\\f1\\fs22 {cyrillic}\\f0 .\\par\n'
            # WordPad writes \\pntext before each item; Word writes \\listtext.
            '\\pard{\\pntext\\f2\\\'B7\\tab}{\\*\\pn\\pnlvlblt\\pnf2\\pnindent0{\\pntxtb\\\'B7}}\\fi-360\\li720 Fog horn\\par\n'
            '{\\listtext\\f2\\u8226?\\tab}Spare glass\\par\n'
            '\\pard\\plain\\s2\\b\\f0\\fs28 Supplies\\par\n'
            '\\trowd\\trgaph108\\cellx3000\\cellx6000\\pard\\plain\\intbl Item\\cell Count\\cell\\row\n'
            '\\trowd\\trgaph108\\cellx3000\\cellx6000\\pard\\plain\\intbl Oil\\cell 12\\cell\\row\n'
            '\\pard\\plain\\s1\\b\\f0\\fs32 Second watch\\par\n'
            '\\pard\\plain\\f0 Picture: {\\*\\shppict{\\pict{\\*\\picprop{\\sp{\\sn wzDescription}{\\sv PICPROP-TEXT}}}'
            f'\\picw8\\pich4\\pngblip\\bliptag-1{{\\*\\blipuid 0123456789abcdef0123456789abcdef}}{picture}}}}}'
            '{\\nonshppict{\\pict\\wmetafile8\\picw8\\pich4 0100090000}}'
            ' and {\\field{\\*\\fldinst{HYPERLINK "https://example.org/lighthouses"}}{\\fldrslt{\\ul\\cf1 the society}}}.\\par\n'
            '}\n')


def main():
    pypandoc.convert_text(MARKDOWN, 'rtf', format='md', outputfile=str(HERE / 'pandoc.rtf'), extra_args=['-s', '--metadata', 'title=The Keeper'])
    (HERE / 'word.rtf').write_text(word_rtf(), encoding='ascii')
    print('wrote', HERE / 'pandoc.rtf', HERE / 'word.rtf')


if __name__ == '__main__':
    main()
