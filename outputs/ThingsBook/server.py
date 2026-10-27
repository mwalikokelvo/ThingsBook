"""Serve only ThingsBook's static UI on a fixed loopback origin."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
import webbrowser
import sys

ROOT = Path(__file__).resolve().parent
HOST, PORT = '127.0.0.1', 8765
URL = f'http://{HOST}:{PORT}'

class Handler(SimpleHTTPRequestHandler):
    # Fixed types for everything the app serves. Python otherwise asks the operating system, and on
    # Windows the registry often maps .js/.mjs to text/plain or nothing; with nosniff the browser then
    # refuses the pdf.js worker and scripts, so PDFs never open.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
        '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
        '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png',
        '.jpg':'image/jpeg', '.ico':'image/x-icon', '.ttf':'font/ttf', '.otf':'font/otf', '.woff':'font/woff',
        '.woff2':'font/woff2', '.txt':'text/plain', '.md':'text/plain', '.bcmap':'application/octet-stream',
        '.pfb':'application/octet-stream', '.gz':'application/gzip', '.traineddata':'application/octet-stream'}
    def allowed(self):
        route = urlsplit(self.path).path
        target = (ROOT / route.lstrip('/')).resolve()
        return route == '/' or (ROOT in target.parents and (route in ('/index.html','/app.js','/style.css','/reader.js','/reader.css','/pdf.worker.mjs') or route.startswith(('/vendor/','/cmaps/','/wasm/','/standard_fonts/'))))
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if not self.allowed():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if not self.allowed():
            self.send_error(404)
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        super().end_headers()

if __name__ == '__main__':
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f'Port {PORT} is already in use. If ThingsBook is running, open {URL}.')
        print('Otherwise, close the program using this port and try again.')
        sys.exit(1)
    print(f'ThingsBook is ready at {URL}\nKeep this window open while reading. Press Ctrl+C to stop.')
    if '--no-browser' not in sys.argv:
        webbrowser.open(URL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
