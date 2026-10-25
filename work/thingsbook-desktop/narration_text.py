"""Conservative spoken-text cleanup; never rewrite quotations or numeric values."""
import re
import json


def load_voices(path):
    value = json.loads(path.read_text(encoding='utf-8'))
    entries = value.get('voices')
    if value.get('engine') != 'pocket-tts' or value.get('validated') is not True or not isinstance(entries, list) or not 1 <= len(entries) <= 64:
        raise ValueError('Invalid voice catalog')
    names = {}
    for item in entries:
        if not isinstance(item, dict): raise ValueError('Invalid voice entry')
        voice, name = item.get('id'), item.get('name')
        if not isinstance(voice, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', voice) or voice in names or not isinstance(name, str) or not name.strip() or len(name) > 120 or re.search(r'[\x00-\x1f\x7f]', name):
            raise ValueError('Invalid voice entry')
        names[voice] = name.strip()
    return names


def prepare_text(text: str, kind: str = 'prose') -> str:
    if kind not in ('prose', 'heading'):
        raise ValueError('Invalid passage type')
    # Layout artifacts should not be pronounced as words or extra pauses.
    text = text.replace('\u00ad', '').replace('\ufeff', '').replace('\u200b', '')
    text = re.sub(r'\s+', ' ', text).strip()
    if not text:
        raise ValueError('No spoken text')
    # A heading is a complete phrase, even when the book omits punctuation.
    if kind == 'heading' and not re.search(r'[.!?:;\u2026]["\u201d\u2019\')\]]*$', text):
        text += '.'
    return text
