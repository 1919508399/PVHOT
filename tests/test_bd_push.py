import io
import json
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path

import bd_push


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self, _limit):
        return self.payload


class BaiduPushTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def write_data(self, items):
        (self.root / "data.json").write_text(
            json.dumps({"items": items}, ensure_ascii=False),
            encoding="utf-8",
        )

    def test_build_submission_urls_selects_latest_nine_unique_site_urls(self):
        items = [
            {
                "pubDate": "2026-07-{:02d}T00:00:00Z".format(day),
                "id": "news/{}".format(day),
            }
            for day in range(1, 12)
        ]
        items.extend(
            [
                {"pubDate": "2026-07-30T00:00:00Z", "id": ""},
                {"pubDate": "2026-07-29T00:00:00Z", "id": "news/11"},
            ]
        )

        urls = bd_push.build_submission_urls({"items": items})

        self.assertEqual(urls[0], bd_push.SITE_URL)
        self.assertEqual(len(urls), 10)
        self.assertEqual(urls[1], "https://pvhot.bbroot.com/?id=news%2F11")
        self.assertEqual(urls[-1], "https://pvhot.bbroot.com/?id=news%2F3")
        self.assertTrue(
            all(
                urllib.parse.urlsplit(url).netloc == "pvhot.bbroot.com"
                for url in urls
            )
        )

    def test_missing_token_fails_clearly_without_opening_network(self):
        self.write_data([])
        stdout = io.StringIO()
        stderr = io.StringIO()

        status = bd_push.run(
            environ={"PVHOT_ROOT": str(self.root)},
            stdout=stdout,
            stderr=stderr,
            opener=lambda *_args, **_kwargs: self.fail("network must not be used"),
        )

        self.assertEqual(status, 2)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("PVHOT_BAIDU_TOKEN is not configured", stderr.getvalue())

    def test_dry_run_never_opens_network_or_prints_token(self):
        token = "test_dry_run_token_value"
        self.write_data(
            [
                {
                    "pubDate": "2026-07-29T00:00:00Z",
                    "id": "latest item",
                }
            ]
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        status = bd_push.run(
            environ={
                "PVHOT_ROOT": str(self.root),
                "PVHOT_BAIDU_TOKEN": token,
                "PVHOT_BAIDU_DRY_RUN": "1",
            },
            stdout=stdout,
            stderr=stderr,
            opener=lambda *_args, **_kwargs: self.fail("network must not be used"),
        )

        self.assertEqual(status, 0)
        self.assertIn("network disabled", stdout.getvalue())
        self.assertNotIn(token, stdout.getvalue() + stderr.getvalue())

    def test_submit_posts_plain_text_and_logs_only_counts(self):
        token = "test_live_token_value"
        self.write_data(
            [
                {
                    "pubDate": "2026-07-29T00:00:00Z",
                    "id": "latest item",
                }
            ]
        )
        captured = {}

        def opener(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse(
                {
                    "success": 2,
                    "remain": 98,
                    "not_same_site": [],
                    "not_valid": [],
                }
            )

        stdout = io.StringIO()
        stderr = io.StringIO()
        status = bd_push.run(
            environ={
                "PVHOT_ROOT": str(self.root),
                "PVHOT_BAIDU_TOKEN": token,
            },
            stdout=stdout,
            stderr=stderr,
            opener=opener,
        )

        self.assertEqual(status, 0)
        self.assertEqual(captured["request"].method, "POST")
        query = urllib.parse.parse_qs(
            urllib.parse.urlsplit(captured["request"].full_url).query
        )
        self.assertEqual(query["site"], [bd_push.BAIDU_SITE])
        self.assertEqual(query["token"], [token])
        self.assertEqual(
            captured["request"].data.decode("utf-8").splitlines(),
            [bd_push.SITE_URL, "https://pvhot.bbroot.com/?id=latest%20item"],
        )
        self.assertEqual(captured["timeout"], bd_push.REQUEST_TIMEOUT_SECONDS)
        self.assertIn("accepted=2", stdout.getvalue())
        self.assertNotIn(token, stdout.getvalue() + stderr.getvalue())

    def test_upstream_exception_cannot_leak_token(self):
        token = "test_exception_token_value"
        self.write_data([])

        def failing_opener(_request, timeout):
            raise RuntimeError(
                "request failed at ?token={}&timeout={}".format(token, timeout)
            )

        stdout = io.StringIO()
        stderr = io.StringIO()
        status = bd_push.run(
            environ={
                "PVHOT_ROOT": str(self.root),
                "PVHOT_BAIDU_TOKEN": token,
            },
            stdout=stdout,
            stderr=stderr,
            opener=failing_opener,
        )

        self.assertEqual(status, 1)
        self.assertIn("request failed unexpectedly", stderr.getvalue())
        self.assertNotIn(token, stdout.getvalue() + stderr.getvalue())

    def test_over_quota_is_a_successful_sanitized_no_op(self):
        token = "test_over_quota_token_value"
        self.write_data([])

        def quota_exhausted(request, timeout):
            self.assertEqual(timeout, bd_push.REQUEST_TIMEOUT_SECONDS)
            response = io.BytesIO(
                json.dumps({"error": 400, "message": "over quota"}).encode("utf-8")
            )
            raise urllib.error.HTTPError(
                request.full_url,
                400,
                "Bad Request",
                {},
                response,
            )

        stdout = io.StringIO()
        stderr = io.StringIO()
        status = bd_push.run(
            environ={
                "PVHOT_ROOT": str(self.root),
                "PVHOT_BAIDU_TOKEN": token,
            },
            stdout=stdout,
            stderr=stderr,
            opener=quota_exhausted,
        )

        self.assertEqual(status, 0)
        self.assertIn("quota already exhausted", stdout.getvalue())
        self.assertEqual(stderr.getvalue(), "")
        self.assertNotIn(token, stdout.getvalue() + stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
