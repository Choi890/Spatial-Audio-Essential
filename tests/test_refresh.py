import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.requests import Request
from starlette.responses import Response
import app as server


class RefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_changed_assets_get_new_urls(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'index.html').write_text('<link href="styles.css?v=old"><script src="app.js?v=old"></script>', encoding='utf-8')
            (root / 'styles.css').write_text('body{}')
            script = root / 'app.js'
            script.write_text('first')
            with patch.object(server, 'STATIC_DIR', root):
                first = (await server.index()).body.decode()
                script.write_text('second')
                second = (await server.index()).body.decode()
            self.assertNotEqual(re.search(r'src="([^"]+)"', first)[1], re.search(r'src="([^"]+)"', second)[1])
            self.assertEqual(re.search(r'href="([^"]+)"', first)[1], re.search(r'href="([^"]+)"', second)[1])

    async def test_frontend_cache_revalidates_even_with_old_version_or_304(self):
        async def respond(request):
            return Response(status_code=304)

        for path, query, expected in [
            ('/', b'', 'no-store, max-age=0'),
            ('/app.js', b'v=old', 'no-cache, must-revalidate'),
            ('/js/transport.js', b'', 'no-cache, must-revalidate'),
            ('/styles.css', b'v=old', 'no-cache, must-revalidate'),
        ]:
            with self.subTest(path=path):
                request = Request({'type': 'http', 'method': 'GET', 'scheme': 'http', 'path': path, 'query_string': query, 'headers': []})
                response = await server.add_operational_headers(request, respond)
                self.assertEqual(response.headers['cache-control'], expected)


if __name__ == '__main__':
    unittest.main()
